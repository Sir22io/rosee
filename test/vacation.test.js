// Tests du mode vacances : lien de la personne qui arrose, pause des rappels, révocation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startRosee } from './helpers.js';

let app, link, token;
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, String(v)); return f; };
const key = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const garde = (body) => app.api('/garde-api', { method: 'POST', json: { token, ...body } });

before(async () => {
  app = await startRosee();
  for (const n of ['Monstera', 'Pothos']) await app.api('/api/plants', { method: 'POST', body: form({ name: n, interval_days: 7 }) });
});
after(async () => { await app?.stop(); });

test('dates invalides refusées', async () => {
  assert.equal((await app.api('/api/vacation', { method: 'PUT', json: { from: key(5), to: key(2) } })).status, 400);
  assert.equal((await app.api('/api/vacation', { method: 'PUT', json: { from: key(-10), to: key(-3) } })).status, 400);
  assert.equal((await app.api('/api/vacation', { method: 'PUT', json: { from: 'demain', to: key(3) } })).status, 400);
});

test('absence en cours : lien, page publique, arrosage par la personne qui garde', async () => {
  const r = await app.api('/api/vacation', { method: 'PUT', json: { from: key(0), to: key(7), name: 'Marie', note: 'Clé chez la gardienne' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.active, true);
  link = r.data.link;
  token = link.split('/').pop();
  assert.equal((await app.req(`/garde/${token}`)).status, 200);
  const info = await garde({ action: 'info' });
  assert.equal(info.status, 200);
  assert.equal(info.data.name, 'Marie');
  assert.equal(info.data.plants.length, 2);
  const p = info.data.plants[0];
  const w = await garde({ action: 'water', id: p.id });
  assert.equal(w.data.plants.find((x) => x.id === p.id).watered_today, true);
  await garde({ action: 'water', id: p.id });
  assert.equal((await app.api(`/api/plants/${p.id}`)).data.history.length, 1, 'pas de doublon');
  const ws = (await app.api('/api/waterings')).data;
  assert.equal(ws[0].by_name, 'Marie');
  assert.equal((await app.api('/api/vacation')).data.sitter_waterings, 1);
});

test('la page ne donne accès à rien d’autre', async () => {
  assert.equal((await app.api('/garde-api', { method: 'POST', json: { token: 'faux', action: 'info' } })).status, 403);
  assert.equal((await garde({ action: 'supprimer' })).status, 400);
  assert.equal((await app.req('/garde-photo/x.webp?t=faux')).status, 404);
});

test('nouveau lien puis fin d’absence : l’ancien lien ne marche plus', async () => {
  const old = token;
  const r = await app.api('/api/vacation/rotate', { method: 'POST' });
  token = r.data.link.split('/').pop();
  assert.notEqual(token, old);
  assert.equal((await app.api('/garde-api', { method: 'POST', json: { token: old, action: 'info' } })).status, 403);
  assert.equal((await garde({ action: 'info' })).status, 200);
  await app.api('/api/vacation', { method: 'DELETE' });
  assert.equal((await garde({ action: 'info' })).status, 403);
  assert.equal((await app.api('/api/vacation')).data.vacation, null);
});
