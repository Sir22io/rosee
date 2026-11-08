// Tests de l'API sans compte Google : plantes, arrosages, saisons, capteurs, photos, agenda, sécurité, sauvegardes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startRosee, mockHA, mockINat, daysAgo } from './helpers.js';

let app, ha, inat;
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, String(v)); return f; };

before(async () => {
  ha = await mockHA();
  inat = await mockINat();
  app = await startRosee({ HA_URL: ha.url, HA_TOKEN: 'ha-token', INAT_API_URL: `${inat.url}/v1`, INAT_PHOTO_HOSTS: '127.0.0.1' });
});
after(async () => { await app?.stop(); await ha?.close(); await inat?.close(); });

test('le serveur répond et donne sa version', async () => {
  const h = await app.api('/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.data.ok, true);
  assert.match(h.data.version, /^\d+\.\d+\.\d+$/);
});

test('les pages et scripts sont servis, avec les en-têtes de sécurité', async () => {
  const r = await app.req('/');
  assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  for (const f of ['/app.js', '/app.css', '/sw.js', '/theme.js', '/manifest.webmanifest', '/fonts/manrope.woff2']) {
    assert.equal((await app.req(f)).status, 200, f);
  }
});

test('créer une plante applique les valeurs par défaut et la valide', async () => {
  const bad = await app.api('/api/plants', { method: 'POST', body: form({ name: '  ' }) });
  assert.equal(bad.status, 400);
  const r = await app.api('/api/plants', { method: 'POST', body: form({ name: 'Monstera', species: 'Monstera deliciosa', room: 'Salon', light: 'lumineux', interval_days: 7, interval_winter: 12 }) });
  assert.equal(r.status, 201);
  assert.equal(r.data.name, 'Monstera');
  assert.equal(r.data.days_left, 0, 'jamais arrosée : à arroser aujourd’hui');
  assert.equal(r.data.care.label, 'Monstera');
  assert.equal(r.data.care.water.kind, 'copieux');
  assert.equal(r.data.month_intervals.length, 12);
  assert.equal(r.data.month_intervals[6], 7, 'juillet = rythme d’été');
  assert.equal(r.data.month_intervals[0], 12, 'janvier = rythme d’hiver');
});

test('l’intervalle d’hiver ne peut pas être plus court que celui d’été', async () => {
  const r = await app.api('/api/plants', { method: 'POST', body: form({ name: 'Test hiver', interval_days: 10, interval_winter: 3 }) });
  assert.equal(r.data.winter_interval, 10);
  await app.api(`/api/plants/${r.data.id}`, { method: 'DELETE' });
});

test('arroser met à jour le compte à rebours, annuler le rétablit', async () => {
  const p = (await app.api('/api/plants')).data.find((x) => x.name === 'Monstera');
  const w = await app.api(`/api/plants/${p.id}/water`, { method: 'POST', json: {} });
  assert.equal(w.status, 201);
  const after1 = (await app.api(`/api/plants/${p.id}`)).data;
  assert.equal(after1.days_left, after1.current_interval);
  assert.equal(after1.history.length, 1);
  await app.api(`/api/waterings/${w.data.watering_id}`, { method: 'DELETE' });
  assert.equal((await app.api(`/api/plants/${p.id}`)).data.history.length, 0);
});

test('un arrosage dans le futur est refusé (ramené à maintenant)', async () => {
  const p = (await app.api('/api/plants')).data[0];
  const w = await app.api(`/api/plants/${p.id}/water`, { method: 'POST', json: { at: new Date(Date.now() + 5 * 86400e3).toISOString() } });
  const h = (await app.api(`/api/plants/${p.id}`)).data.history.find((x) => x.id === w.data.watering_id);
  assert.ok(new Date(h.at) <= new Date(Date.now() + 60e3));
  await app.api(`/api/waterings/${w.data.watering_id}`, { method: 'DELETE' });
});

test('une plante en retard a un days_left négatif', async () => {
  const r = await app.api('/api/plants', { method: 'POST', body: form({ name: 'Oubliée', interval_days: 3, seasonal: 0 }) });
  await app.api(`/api/plants/${r.data.id}/water`, { method: 'POST', json: { at: daysAgo(5) } });
  const p = (await app.api(`/api/plants/${r.data.id}`)).data;
  assert.equal(p.days_left, -2);
  assert.equal(p.health, 'water');
  await app.api(`/api/plants/${r.data.id}`, { method: 'DELETE' });
});

test('les capteurs Home Assistant produisent des alertes', async () => {
  const r = await app.api('/api/plants', { method: 'POST', body: form({ name: 'Ficus', species: 'Ficus elastica', interval_days: 8, sensor_moisture: 'sensor.ficus_moisture' }) });
  await app.api(`/api/plants/${r.data.id}/water`, { method: 'POST', json: {} });
  const p = (await app.api(`/api/plants/${r.data.id}`)).data;
  assert.equal(p.sensors.moisture.value, 12);
  assert.equal(p.sensors.moisture.range, 'low');
  assert.ok(p.alerts.some((a) => a.text.startsWith('Sol trop sec')));
  assert.ok(p.alerts.some((a) => a.text.includes('Batterie')));
  const hist = await app.api(`/api/plants/${r.data.id}/history?metric=moisture&hours=48`);
  assert.equal(hist.status, 200);
  assert.ok(hist.data.points.length > 5);
});

test('un nom d’entité invalide est ignoré', async () => {
  const r = await app.api('/api/plants', { method: 'POST', body: form({ name: 'Piège', sensor_moisture: 'sensor.x; DROP TABLE' }) });
  assert.deepEqual(r.data.sensor_map, {});
  await app.api(`/api/plants/${r.data.id}`, { method: 'DELETE' });
});

test('recherche de photos : seulement des végétaux, seulement des licences libres', async () => {
  const r = await app.api('/api/photo-search?q=basilic');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.taxa.map((t) => t.name), ['Ocimum basilicum']);
  assert.deepEqual(r.data.photos.map((p) => p.id), [11], 'la photo sans licence est écartée');
  const m = await app.api('/api/photo-search?q=monstera');
  assert.deepEqual(m.data.photos.map((p) => p.id), [31], 'la licence ND est écartée');
});

test('une photo de référence ne peut venir que d’un hôte autorisé', async () => {
  const r = await app.api('/api/plants', { method: 'POST', body: form({ name: 'SSRF', ref_photo_url: 'http://169.254.169.254/latest/meta-data' }) });
  assert.equal(r.status, 400);
  const ok = await app.api('/api/plants', { method: 'POST', body: form({ name: 'Basilic', ref_photo_url: `${inat.url}/photos/11/large.jpg`, ref_photo_attribution: '(c) Auteur 11', ref_photo_license: 'CC-BY-NC', ref_photo_page: 'https://www.inaturalist.org/photos/11' }) });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.photo_source, 'ref');
  assert.equal(ok.data.photo_credit.license, 'CC-BY-NC');
  assert.equal((await app.req(ok.data.photo_url)).status, 200);
});

test('flux d’agenda : jeton obligatoire, événements avec consigne d’arrosage', async () => {
  assert.equal((await app.req('/cal/mauvais-jeton.ics')).status, 404);
  const { data } = await app.api('/api/calendar-feed');
  const r = await app.req(data.path);
  assert.equal(r.status, 200);
  const ics = await r.text();
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:💧 Arroser Monstera/);
  assert.match(ics.replace(/\r\n /g, ''), /Arrosage copieux/);
  const rot = await app.api('/api/calendar-feed/rotate', { method: 'POST' });
  assert.notEqual(rot.data.path, data.path);
  assert.equal((await app.req(data.path)).status, 404, 'l’ancien lien ne marche plus');
});

test('réglages : heure du rappel validée', async () => {
  await app.api('/api/settings', { method: 'PUT', json: { reminder_time: '25:99', user_name: 'Clément' } });
  const s = (await app.api('/api/settings')).data;
  assert.equal(s.reminder_time, '09:00');
  assert.equal(s.user_name, 'Clément');
});

test('repères d’entretien : espèce, genre, nom commun', async () => {
  const c = async (q) => (await app.api(`/api/care?${q}`)).data.care;
  assert.equal((await c('species=Goeppertia+orbifolia')).label, 'Calathea / Maranta');
  assert.equal((await c('species=Ficus+altissima')).match, 'genus');
  assert.equal((await c('name=Mon+basilic')).label, 'Basilic');
  assert.equal(await c('name=Truc+inconnu'), null);
});

test('export puis restauration : les plantes, photos et arrosages reviennent', async () => {
  const before = (await app.api('/api/plants')).data;
  const exp = await app.api('/api/export');
  assert.equal(exp.status, 200);
  assert.equal(exp.data.app, 'rosee');
  assert.ok(exp.data.plants.some((p) => p.photo_data), 'les photos sont incluses');
  // On abîme les données, puis on restaure
  for (const p of before) await app.api(`/api/plants/${p.id}`, { method: 'DELETE' });
  assert.equal((await app.api('/api/plants')).data.length, 0);
  const imp = await app.api('/api/import', { method: 'POST', json: exp.data });
  assert.equal(imp.status, 200, JSON.stringify(imp.data));
  assert.equal(imp.data.plants, before.length);
  const restored = (await app.api('/api/plants')).data;
  assert.deepEqual(restored.map((p) => p.name).sort(), before.map((p) => p.name).sort());
  assert.ok(restored.find((p) => p.name === 'Basilic').photo_url);
  // Une sauvegarde a été faite juste avant la restauration
  const b = await app.api('/api/backups');
  assert.ok(b.data.backups.some((x) => x.name.includes('avant-import')));
  assert.ok(fs.existsSync(path.join(app.dataDir, 'backups', imp.data.backup)));
});

test('un fichier qui n’est pas un export est refusé', async () => {
  const r = await app.api('/api/import', { method: 'POST', json: { hello: 'world' } });
  assert.equal(r.status, 400);
});
