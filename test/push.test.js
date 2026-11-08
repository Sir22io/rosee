// Tests des rappels : regroupement des notifications et actions « Arrosée » / « Dans 3 h ».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { startRosee, daysAgo } from './helpers.js';

let app, key;
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, String(v)); return f; };
// Même construction que le serveur : la clé dérive de la clé privée VAPID stockée dans data/
const token = (ids, exp = Date.now() + 86400e3) => {
  const payload = Buffer.from(JSON.stringify({ ids, exp })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', key).update(payload).digest('base64url')}`;
};
const action = (body) => app.api('/push-action', { method: 'POST', json: body });

before(async () => {
  app = await startRosee();
  const vapid = JSON.parse(fs.readFileSync(path.join(app.dataDir, 'vapid.json'), 'utf8'));
  key = crypto.createHash('sha256').update(`rosee-push:${vapid.privateKey}`).digest();
});
after(async () => { await app?.stop(); });

test('jusqu’à 3 plantes : une notification par plante', async () => {
  for (const n of ['Monstera', 'Pothos']) await app.api('/api/plants', { method: 'POST', body: form({ name: n, interval_days: 7 }) });
  const r = await app.api('/api/push/test', { method: 'POST' });
  assert.equal(r.data.notifications, 2);
});

test('au-delà de 3 plantes : une seule notification groupée', async () => {
  for (const n of ['Ficus', 'Aloe', 'Basilic']) await app.api('/api/plants', { method: 'POST', body: form({ name: n, interval_days: 7 }) });
  const r = await app.api('/api/push/test', { method: 'POST' });
  assert.equal(r.data.notifications, 1);
});

test('« Arrosée » depuis la notification enregistre l’arrosage, sans session ni doublon', async () => {
  const plants = (await app.api('/api/plants')).data;
  const p = plants.find((x) => x.name === 'Monstera');
  const r = await action({ token: token([p.id]), action: 'water' });
  assert.equal(r.status, 200);
  assert.equal(r.data.watered, 1);
  assert.equal((await app.api(`/api/plants/${p.id}`)).data.days_left > 0, true);
  const again = await action({ token: token([p.id]), action: 'water' });
  assert.equal(again.data.watered, 0, 'deuxième appui le même jour : pas de doublon');
  assert.equal((await app.api(`/api/plants/${p.id}`)).data.history.length, 1);
});

test('jeton falsifié, modifié ou expiré : refusé', async () => {
  const p = (await app.api('/api/plants')).data.find((x) => x.name === 'Pothos');
  assert.equal((await action({ token: 'abc.def', action: 'water' })).status, 403);
  const good = token([p.id]);
  const [payload, sig] = good.split('.');
  const other = Buffer.from(JSON.stringify({ ids: [1, 2, 3, 4, 5], exp: Date.now() + 1e6 })).toString('base64url');
  assert.equal((await action({ token: `${other}.${sig}`, action: 'water' })).status, 403, 'charge modifiée');
  assert.equal((await action({ token: token([p.id], Date.now() - 1000), action: 'water' })).status, 403, 'expiré');
  assert.equal((await action({ token: good, action: 'supprimer' })).status, 400);
  assert.equal(payload.length > 0, true);
});

test('« Dans 3 h » reporte le rappel', async () => {
  const p = (await app.api('/api/plants')).data.find((x) => x.name === 'Pothos');
  const r = await action({ token: token([p.id]), action: 'later' });
  assert.equal(r.status, 200);
  assert.equal(r.data.snoozed, 1);
});

test('une plante en retard reste groupée et l’action « tout arrosé » couvre tout le groupe', async () => {
  const plants = (await app.api('/api/plants')).data.filter((x) => x.days_left <= 0);
  await app.api(`/api/plants/${plants[0].id}/water`, { method: 'POST', json: { at: daysAgo(10) } });
  const r = await action({ token: token(plants.map((x) => x.id)), action: 'water' });
  assert.equal(r.data.watered, plants.length);
  assert.equal((await app.api('/api/plants')).data.filter((x) => x.days_left <= 0).length, 0);
});
