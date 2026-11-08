// Tests des comptes Google et de la synchronisation Google Agenda (services Google simulés).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startRosee, mockGoogle, freePort } from './helpers.js';

let app, google;
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, String(v)); return f; };

before(async () => {
  google = await mockGoogle({ email: 'moi@test.fr' });
  // PUBLIC_URL doit pointer vers le serveur lui-même : on réserve le port avant de le lancer
  const port = await freePort();
  app = await startRosee({
    PORT: String(port),
    PUBLIC_URL: `http://127.0.0.1:${port}`,
    GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'secret',
    ALLOWED_EMAILS: 'moi@test.fr',
    GOOGLE_AUTH_URL: `${google.url}/auth`,
    GOOGLE_TOKEN_URL: `${google.url}/token`,
    GOOGLE_REVOKE_URL: `${google.url}/revoke`,
    GOOGLE_API_URL: google.url,
  });
});
after(async () => { await app?.stop(); await google?.close(); });

test('sans session, l’API et les photos sont fermées, l’interface reste chargeable', async () => {
  assert.equal((await app.api('/api/plants')).status, 401);
  assert.equal((await app.api('/api/me')).data.login, true);
  assert.equal((await app.req('/photos/x.webp')).status, 401);
  assert.equal((await app.req('/')).status, 200);
  assert.equal((await app.api('/api/health')).status, 200);
});

test('un compte non autorisé est refusé', async () => {
  google.email = 'intrus@test.fr';
  const r = await app.follow('/auth/google/login');
  assert.match(r.url, /connexion\?erreur=/);
  assert.equal((await app.api('/api/plants')).status, 401);
  google.email = 'moi@test.fr';
});

test('un état OAuth inconnu est refusé', async () => {
  const r = await app.follow('/auth/google/callback?code=x&state=forge');
  assert.match(r.url, /erreur=/);
});

test('connexion, puis accès à l’API', async () => {
  const r = await app.follow('/auth/google/login');
  assert.match(r.url, /\/#\/$/);
  const me = await app.api('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, 'moi@test.fr');
  assert.equal(me.data.calendar.connected, false);
  assert.equal((await app.api('/api/plants')).status, 200);
});

test('l’arrosage enregistre qui l’a fait', async () => {
  const p = await app.api('/api/plants', { method: 'POST', body: form({ name: 'Monstera', species: 'Monstera deliciosa', interval_days: 7 }) });
  await app.api(`/api/plants/${p.data.id}/water`, { method: 'POST', json: { at: new Date(Date.now() - 8 * 86400e3).toISOString() } });
  const rows = (await app.api('/api/waterings')).data;
  assert.equal(rows[0].by_name, 'Testeur');
});

test('connexion de l’agenda : création de l’agenda et des événements', async () => {
  const r = await app.follow('/auth/google/calendar');
  assert.match(r.url, /agenda=ok/);
  const me = (await app.api('/api/me/calendar/sync', { method: 'POST' })).data;
  assert.equal(me.calendar.connected, true);
  assert.equal(me.calendar.last_sync_error, null);
  assert.equal(google.cals.size, 1);
  const evs = google.liveEvents();
  assert.ok(evs.length >= 3, `événements créés : ${evs.length}`);
  assert.match(evs[0].summary, /Arroser Monstera/);
  assert.deepEqual(evs[0].reminders.overrides, [{ method: 'popup', minutes: 60 }]);
  assert.match(evs[0].description, /Arrosage copieux/);
});

test('changer les alertes met à jour les événements existants', async () => {
  await app.api('/api/me/calendar', { method: 'PUT', json: { time: '08:30', reminders: [120, 1440, 9999], method: 'email' } });
  await app.api('/api/me/calendar/sync', { method: 'POST' });
  const ev = google.liveEvents()[0];
  assert.equal(ev.start.dateTime.slice(11, 16), '08:30');
  assert.deepEqual(ev.reminders.overrides.map((o) => o.minutes), [120, 1440], 'la valeur non proposée est ignorée');
  assert.equal(ev.reminders.overrides[0].method, 'email');
});

test('un soin activé ajoute ses propres événements, sans toucher aux arrosages', async () => {
  const p = (await app.api('/api/plants')).data[0];
  const before = google.liveEvents().filter((e) => /Arroser/.test(e.summary)).length;
  await app.api(`/api/plants/${p.id}/cares`, { method: 'PUT', json: { rotation: { on: true } } });
  await app.api('/api/me/calendar/sync', { method: 'POST' });
  const evs = google.liveEvents();
  assert.ok(evs.some((e) => /Tourner le pot.*Monstera/.test(e.summary)));
  assert.equal(evs.filter((e) => /Arroser/.test(e.summary)).length, before);
  await app.api(`/api/plants/${p.id}/cares`, { method: 'PUT', json: { rotation: { on: false } } });
  await app.api('/api/me/calendar/sync', { method: 'POST' });
  assert.equal(google.liveEvents().some((e) => /Tourner/.test(e.summary)), false);
});

test('supprimer la plante retire ses événements à venir', async () => {
  const p = (await app.api('/api/plants')).data[0];
  await app.api(`/api/plants/${p.id}`, { method: 'DELETE' });
  await app.api('/api/me/calendar/sync', { method: 'POST' });
  assert.equal(google.liveEvents().length, 0);
});

test('déconnexion de l’agenda puis du compte', async () => {
  const me = (await app.api('/api/me/calendar/disconnect', { method: 'POST', json: { delete_calendar: true } })).data;
  assert.equal(me.calendar.connected, false);
  assert.equal(google.cals.size, 0);
  await app.api('/auth/logout', { method: 'POST' });
  assert.equal((await app.api('/api/plants')).status, 401);
});
