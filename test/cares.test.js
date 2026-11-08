// Tests des autres soins : saisons de l'engrais, rempotage optionnel, routes, agenda.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { careSettings, careStatus } from '../cares.js';
import { startRosee, daysAgo } from './helpers.js';

const status = (opts) => Object.fromEntries(careStatus(opts).map((t) => [t.type, t]));
const profile = { fert: 15, repot: 2 };

test('par défaut : engrais actif, rempotage, taille et rotation désactivés', () => {
  const s = careSettings({}, profile);
  assert.equal(s.engrais.on, true);
  assert.equal(s.engrais.every, 15, 'rythme de l’espèce');
  assert.equal(s.rempotage.on, false);
  assert.equal(s.rempotage.every, 730);
  assert.equal(s.taille.on, false);
  assert.equal(s.rotation.on, false);
  assert.equal(careSettings({ engrais: { every: 30 } }, profile).engrais.every, 30, 'rythme choisi par l’utilisateur');
});

test('engrais : pause d’octobre à février, reprise en mars, sans retard affiché', () => {
  const s = careSettings({}, profile);
  const nov = status({ settings: s, last: { engrais: { key: '2026-09-20' } }, today: '2026-11-08' });
  assert.equal(nov.engrais.next, '2027-03-01');
  assert.equal(nov.engrais.days_left > 0, true);
  assert.equal(nov.engrais.in_season, false);
  const jun = status({ settings: s, last: { engrais: { key: '2026-06-01' } }, today: '2026-06-10' });
  assert.equal(jun.engrais.next, '2026-06-16');
  assert.deepEqual(jun.engrais.dates.slice(0, 3), ['2026-06-16', '2026-07-01', '2026-07-16']);
  const late = status({ settings: s, last: { engrais: { key: '2026-05-01' } }, today: '2026-06-10' });
  assert.equal(late.engrais.days_left < 0, true, 'en saison, un engrais oublié est en retard');
  // Hémisphère sud : la saison est décalée de six mois
  const south = status({ settings: s, last: { engrais: { key: '2026-03-20' } }, today: '2026-05-08', south: true });
  assert.equal(south.engrais.next, '2026-09-01');
});

test('engrais : une nouvelle plante attend un cycle avant le premier engrais', () => {
  const s = careSettings({}, profile);
  const t = status({ settings: s, last: {}, today: '2026-06-10', created: '2026-06-10' });
  assert.equal(t.engrais.next, '2026-06-25');
});

test('rempotage : vérification au printemps, « pas besoin » repousse d’un an', () => {
  const s = careSettings({ rempotage: { on: true } }, profile);
  assert.equal(status({ settings: s, last: {}, today: '2026-11-08' }).rempotage.next, '2027-03-01');
  assert.equal(status({ settings: s, last: {}, today: '2026-04-02' }).rempotage.days_left, 0);
  const skip = status({ settings: s, last: { rempotage: { key: '2026-04-02', note: 'skip' } }, today: '2026-04-03' });
  assert.equal(skip.rempotage.next, '2027-04-02');
  const done = status({ settings: s, last: { rempotage: { key: '2026-04-02', note: '' } }, today: '2026-04-03' });
  assert.equal(done.rempotage.next, '2028-04-01');
  // Désactivé : rien dans l'agenda
  assert.deepEqual(status({ settings: careSettings({}, profile), last: {}, today: '2026-04-02' }).rempotage.dates, []);
});

test('rotation : toute l’année, tous les 14 jours', () => {
  const s = careSettings({ rotation: { on: true } }, profile);
  const t = status({ settings: s, last: { rotation: { key: '2026-12-01' } }, today: '2026-12-10' });
  assert.equal(t.rotation.next, '2026-12-15');
  assert.deepEqual(t.rotation.dates.slice(0, 2), ['2026-12-15', '2026-12-29']);
});

let app;
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, String(v)); return f; };
before(async () => { app = await startRosee(); });
after(async () => { await app?.stop(); });

test('routes : activer, effectuer, passer, annuler un soin', async () => {
  const p = (await app.api('/api/plants', { method: 'POST', body: form({ name: 'Monstera', species: 'Monstera deliciosa', interval_days: 7 }) })).data;
  const types = Object.fromEntries(p.care_tasks.map((t) => [t.type, t]));
  assert.equal(types.engrais.on, true);
  assert.equal(types.rempotage.on, false);

  const on = await app.api(`/api/plants/${p.id}/cares`, { method: 'PUT', json: { rotation: { on: true, every: 10 }, rempotage: { on: true } } });
  assert.equal(on.status, 200);
  const rot = on.data.care_tasks.find((t) => t.type === 'rotation');
  assert.equal(rot.on, true);
  assert.equal(rot.every, 10);
  assert.equal(rot.days_left, 0, 'activée : à faire tout de suite');

  const done = await app.api(`/api/plants/${p.id}/care/rotation`, { method: 'POST', json: { at: daysAgo(3) } });
  assert.equal(done.status, 201);
  assert.equal(done.data.care_tasks.find((t) => t.type === 'rotation').days_left, 7);

  assert.equal((await app.api(`/api/plants/${p.id}/care/rotation`, { method: 'POST', json: { action: 'skip' } })).status, 400, '« pas besoin » réservé au rempotage');
  assert.equal((await app.api(`/api/plants/${p.id}/care/arracher`, { method: 'POST', json: {} })).status, 400);
  const skip = await app.api(`/api/plants/${p.id}/care/rempotage`, { method: 'POST', json: { action: 'skip' } });
  assert.equal(skip.status, 201);
  assert.equal(skip.data.care_tasks.find((t) => t.type === 'rempotage').days_left >= 300, true);

  const detail = (await app.api(`/api/plants/${p.id}`)).data;
  assert.equal(detail.care_history.length, 2);
  const log = (await app.api('/api/care-log')).data;
  assert.equal(log.length, 2);
  assert.equal((await app.api(`/api/care-log/${done.data.care_id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await app.api(`/api/plants/${p.id}`)).data.care_tasks.find((t) => t.type === 'rotation').days_left, 0);

  // Le formulaire peut aussi envoyer les réglages ; un rythme vide revient au repère de l'espèce
  const put = await app.api(`/api/plants/${p.id}`, { method: 'PUT', body: form({ name: 'Monstera', species: 'Monstera deliciosa', interval_days: 7, cares: JSON.stringify({ rotation: { on: false, every: null } }) }) });
  const r2 = put.data.care_tasks.find((t) => t.type === 'rotation');
  assert.equal(r2.on, false);
  assert.equal(r2.every, 14);
});

test('agenda .ics : les soins actifs y figurent, les soins désactivés non', async () => {
  const feed = (await app.api('/api/calendar-feed')).data;
  const ics = async () => (await app.req(feed.path)).text();
  assert.match(await ics(), /Arroser Monstera/);
  assert.doesNotMatch(await ics(), /UID:rosee-rotation-/);
  const p = (await app.api('/api/plants')).data[0];
  await app.api(`/api/plants/${p.id}/cares`, { method: 'PUT', json: { rotation: { on: true } } });
  assert.match(await ics(), /UID:rosee-rotation-\d+-\d{4}-\d{2}-\d{2}@rosee/);
  assert.match(await ics(), /Tourner le pot/);
  await app.api(`/api/plants/${p.id}/cares`, { method: 'PUT', json: { rotation: { on: false } } });
});

test('export puis import conservent les réglages et le journal des soins', async () => {
  const exp = (await app.api('/api/export?photos=0')).data;
  assert.equal(exp.care_log.length, 1);
  const r = await app.api('/api/import', { method: 'POST', json: exp });
  assert.equal(r.status, 200);
  const p = (await app.api('/api/plants')).data[0];
  assert.equal(p.care_tasks.find((t) => t.type === 'rempotage').on, true);
  assert.equal(p.care_tasks.find((t) => t.type === 'rempotage').last_note, 'skip');
});
