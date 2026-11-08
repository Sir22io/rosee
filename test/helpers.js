// Outils de test : services simulés (Home Assistant, iNaturalist, Google) et lancement du serveur.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
const body = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };

async function listen(handler) {
  const port = await freePort();
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${port}`, port, close: () => new Promise((r) => server.close(r)) };
}

// ---------- Home Assistant ----------
export async function mockHA() {
  const now = Date.now();
  const st = (id, state, dc, unit, ago = 3) => ({ entity_id: id, state: String(state), attributes: { device_class: dc, unit_of_measurement: unit, friendly_name: id }, last_updated: new Date(now - ago * 60000).toISOString() });
  const states = [
    st('sensor.monstera_moisture', 46, 'moisture', '%'),
    st('sensor.monstera_temperature', 21.4, 'temperature', '°C'),
    st('sensor.ficus_moisture', 12, 'moisture', '%'),
    st('sensor.ficus_battery', 9, 'battery', '%'),
    st('sensor.calathea_moisture', 'unavailable', 'moisture', '%', 600),
  ];
  return listen((req, res) => {
    if (req.headers.authorization !== 'Bearer ha-token') return json(res, 401, {});
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/config') return json(res, 200, { version: '2026.11.0', location_name: 'Test' });
    if (u.pathname === '/api/states') return json(res, 200, states);
    if (u.pathname.startsWith('/api/history/period/')) {
      const pts = [];
      for (let t = now - 48 * 3600e3; t < now; t += 3600e3) pts.push({ state: String(60 - (now - t) / 3600e3 / 4), last_changed: new Date(t).toISOString() });
      return json(res, 200, [pts.reverse()]);
    }
    json(res, 404, {});
  });
}

// ---------- iNaturalist ----------
export async function mockINat() {
  const img = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#3a7a4a' } }).jpeg().toBuffer();
  let base;
  const ph = (id, lic = 'cc-by-nc') => ({ id, license_code: lic, attribution: `(c) Auteur ${id}, some rights reserved`, url: `${base}/photos/${id}/square.jpg`, medium_url: `${base}/photos/${id}/medium.jpg` });
  const srv = await listen((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/photos/')) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(img); }
    const taxa = [
      { id: 1, name: 'Ocimum basilicum', preferred_common_name: 'basilic', iconic_taxon_name: 'Plantae', rank: 'species', photos: [ph(11), ph(12, null)] },
      { id: 2, name: 'Basiliscus', preferred_common_name: 'basilics', iconic_taxon_name: 'Reptilia', rank: 'genus', photos: [ph(21)] },
      { id: 3, name: 'Monstera deliciosa', preferred_common_name: 'monstera', iconic_taxon_name: 'Plantae', rank: 'species', photos: [ph(31), ph(32, 'cc-by-nd')] },
    ];
    if (u.pathname === '/v1/taxa') {
      const q = (u.searchParams.get('q') || '').toLowerCase();
      const r = taxa.filter((t) => t.name.toLowerCase().includes(q) || t.preferred_common_name.includes(q) || q.includes(t.preferred_common_name));
      return json(res, 200, { results: r.map((t) => ({ ...t, default_photo: t.photos[0], photos: undefined })) });
    }
    const m = u.pathname.match(/^\/v1\/taxa\/(\d+)$/);
    if (m) {
      const t = taxa.find((x) => x.id === Number(m[1]));
      return json(res, 200, { results: t ? [{ ...t, default_photo: t.photos[0], taxon_photos: t.photos.map((photo) => ({ photo })) }] : [] });
    }
    json(res, 404, {});
  });
  base = srv.url;
  return srv;
}

// ---------- Google (OAuth + Agenda) ----------
export async function mockGoogle({ email = 'moi@test.fr' } = {}) {
  const codes = new Map();
  const cals = new Map();
  let n = 0;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const srv = await listen(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/auth') {
      const code = `c${++n}`;
      codes.set(code, u.searchParams.get('scope'));
      res.writeHead(302, { Location: `${u.searchParams.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(u.searchParams.get('state'))}` });
      return res.end();
    }
    if (u.pathname === '/token') {
      const p = new URLSearchParams(await body(req));
      if (p.get('grant_type') === 'refresh_token') return json(res, p.get('refresh_token') === 'rt-secret' ? 200 : 400, { access_token: `at${++n}`, expires_in: 3600, error: 'invalid_grant' });
      const scope = codes.get(p.get('code'));
      if (!scope) return json(res, 400, { error: 'invalid_grant' });
      const id = `${b64({ alg: 'none' })}.${b64({ iss: 'https://accounts.google.com', aud: p.get('client_id'), sub: `sub-${srv.email}`, email: srv.email, email_verified: true, name: 'Test', given_name: 'Testeur', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
      return json(res, 200, { access_token: `at${++n}`, expires_in: 3600, id_token: id, scope, ...(scope.includes('calendar') ? { refresh_token: 'rt-secret' } : {}) });
    }
    if (u.pathname === '/revoke') return json(res, 200, {});
    let m;
    if (u.pathname === '/calendar/v3/calendars' && req.method === 'POST') {
      const b = JSON.parse(await body(req));
      const id = `cal${++n}`;
      cals.set(id, { summary: b.summary, events: new Map() });
      return json(res, 200, { id });
    }
    if ((m = u.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)$/))) {
      const id = decodeURIComponent(m[1]);
      if (!cals.has(id)) return json(res, 404, { error: { message: 'nf' } });
      if (req.method === 'DELETE') { cals.delete(id); res.writeHead(204); return res.end(); }
      return json(res, 200, { id });
    }
    if ((m = u.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/))) {
      const cal = cals.get(decodeURIComponent(m[1]));
      if (!cal) return json(res, 404, { error: { message: 'nf' } });
      if (req.method === 'POST') {
        const b = JSON.parse(await body(req));
        if (!/^[a-v0-9]{5,1024}$/.test(b.id)) return json(res, 400, { error: { message: `id invalide ${b.id}` } });
        if (cal.events.has(b.id)) return json(res, 409, { error: { message: 'duplicate' } });
        cal.events.set(b.id, { ...b, status: 'confirmed' });
        return json(res, 200, b);
      }
      if (req.method === 'PUT') { const b = JSON.parse(await body(req)); cal.events.set(m[2], { ...b, id: m[2] }); return json(res, 200, b); }
      if (req.method === 'DELETE') { const e = cal.events.get(m[2]); if (!e || e.status === 'cancelled') return json(res, 410, {}); e.status = 'cancelled'; res.writeHead(204); return res.end(); }
    }
    json(res, 404, { error: { message: `inconnu ${u.pathname}` } });
  });
  srv.email = email;
  srv.cals = cals;
  srv.liveEvents = () => [...cals.values()].flatMap((c) => [...c.events.values()].filter((e) => e.status !== 'cancelled'));
  return srv;
}

// ---------- Serveur Rosée ----------
export async function startRosee(env = {}) {
  const port = env.PORT ? Number(env.PORT) : await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rosee-test-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, TZ: 'Europe/Paris', PORT: String(port), DATA_DIR: dataDir, PHOTO_LOOKUP: '0', UPDATE_CHECK: '0', RATE_LIMIT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) break; } catch {}
    if (child.exitCode !== null) throw new Error(`Le serveur s'est arrêté :\n${log}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  let cookie = '';
  const req = async (p, opts = {}) => {
    const init = { redirect: 'manual', ...opts, headers: { ...(cookie ? { cookie } : {}), ...(opts.headers || {}) } };
    if (opts.json !== undefined) { init.body = JSON.stringify(opts.json); init.headers['Content-Type'] = 'application/json'; }
    const r = await fetch(base + p, init);
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return r;
  };
  const api = async (p, opts) => {
    const r = await req(p, opts);
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, headers: r.headers };
  };
  // Suit une chaîne de redirections (connexion OAuth) en gardant le cookie
  const follow = async (p, max = 6) => {
    let url = base + p;
    for (let i = 0; i < max; i++) {
      const r = await fetch(url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
      const set = r.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const loc = r.headers.get('location');
      if (!loc || r.status < 300 || r.status >= 400) return { status: r.status, url };
      url = new URL(loc, url).href;
      if (!url.startsWith('http')) return { status: r.status, url };
      if (url.includes('/#/')) return { status: r.status, url };
    }
    return { url };
  };
  return {
    base, dataDir, api, req, follow,
    get log() { return log; },
    async stop() { child.kill(); await new Promise((r) => child.once('exit', r)); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}

export const daysAgo = (n) => new Date(Date.now() - n * 86400e3).toISOString();
