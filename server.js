// Rosée — serveur : plantes, arrosages, photos, notifications push, rappel quotidien
// et lecture des capteurs via l'API de Home Assistant.
import express from 'express';
import Database from 'better-sqlite3';
import multer from 'multer';
import sharp from 'sharp';
import webpush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { findCare } from './care.js';
import { setupGoogle } from './google.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const TZ = process.env.TZ || 'Europe/Paris';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
const AUTH_USER = process.env.BASIC_AUTH_USER || '';
const AUTH_PASS = process.env.BASIC_AUTH_PASS || '';
const HA_URL = (process.env.HA_URL || '').replace(/\/+$/, '');
const HA_TOKEN = process.env.HA_TOKEN || '';
// Version en cours (renseignée par le build GitHub Actions)
const PKG_VERSION = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const BUILD = { version: process.env.ROSEE_VERSION || PKG_VERSION, commit: process.env.ROSEE_COMMIT || 'dev', built: process.env.ROSEE_BUILT || null };
const REPO = process.env.ROSEE_REPO || 'Sir22io/rosee';
const UPDATE_CHECK = process.env.UPDATE_CHECK !== '0';
const GITHUB_API = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
const FEED_BASE_URL = (process.env.FEED_BASE_URL || '').replace(/\/+$/, '');
// Photos de référence (iNaturalist). PHOTO_LOOKUP=0 pour désactiver la recherche automatique.
const INAT_API = (process.env.INAT_API_URL || 'https://api.inaturalist.org/v1').replace(/\/+$/, '');
const PHOTO_LOOKUP = process.env.PHOTO_LOOKUP !== '0';
// Saisons : hémisphère nord par défaut (SEASONS=south pour l'hémisphère sud)
const SOUTH = (process.env.SEASONS || '').toLowerCase() === 'south';
const PHOTO_HOSTS = new Set(['inaturalist-open-data.s3.amazonaws.com', 'static.inaturalist.org', ...(process.env.INAT_PHOTO_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean)]);

fs.mkdirSync(PHOTO_DIR, { recursive: true });

// ---------- Base de données ----------
const db = new Database(path.join(DATA_DIR, 'rosee.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS plants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    species TEXT DEFAULT '',
    room TEXT DEFAULT '',
    light TEXT DEFAULT '',
    interval_days INTEGER NOT NULL DEFAULT 7,
    notes TEXT DEFAULT '',
    photo TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS waterings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    note TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_waterings_plant ON waterings(plant_id, at DESC);
  CREATE INDEX IF NOT EXISTS idx_waterings_at ON waterings(at);
  CREATE TABLE IF NOT EXISTS subscriptions (
    endpoint TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    label TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
// Migrations V2 : capteurs et seuils par plante
const cols = db.prepare('PRAGMA table_info(plants)').all().map((c) => c.name);
if (!cols.includes('sensors')) db.exec(`ALTER TABLE plants ADD COLUMN sensors TEXT NOT NULL DEFAULT '{}'`);
if (!cols.includes('targets')) db.exec(`ALTER TABLE plants ADD COLUMN targets TEXT NOT NULL DEFAULT '{}'`);
// photo_source : 'user' (photo perso), 'ref' (photo de référence choisie), 'auto' (trouvée automatiquement)
if (!cols.includes('photo_source')) db.exec(`ALTER TABLE plants ADD COLUMN photo_source TEXT DEFAULT NULL`);
if (!cols.includes('photo_credit')) db.exec(`ALTER TABLE plants ADD COLUMN photo_credit TEXT DEFAULT NULL`);
// photo_lookup : 0 = recherche auto à faire, 1 = faite ou refusée par l'utilisateur
// Arrosage saisonnier : interval_days = pleine saison (été), interval_winter = repos hivernal
if (!cols.includes('interval_winter')) db.exec(`ALTER TABLE plants ADD COLUMN interval_winter INTEGER DEFAULT NULL`);
if (!cols.includes('seasonal')) db.exec(`ALTER TABLE plants ADD COLUMN seasonal INTEGER NOT NULL DEFAULT 1`);
if (!cols.includes('photo_lookup')) db.exec(`ALTER TABLE plants ADD COLUMN photo_lookup INTEGER NOT NULL DEFAULT 0`);

const getSetting = (k, d) => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? d;
const setSetting = (k, v) =>
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));

// ---------- Clés VAPID ----------
const vapidFile = path.join(DATA_DIR, 'vapid.json');
let vapid;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
} else if (fs.existsSync(vapidFile)) {
  vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8'));
} else {
  vapid = webpush.generateVAPIDKeys();
  fs.writeFileSync(vapidFile, JSON.stringify(vapid, null, 2), { mode: 0o600 });
  console.log('[rosee] Clés VAPID générées dans', vapidFile);
}
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

// ---------- Home Assistant ----------
const haConfigured = () => !!(HA_URL && HA_TOKEN);
async function haFetch(p) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(HA_URL + p, { headers: { Authorization: `Bearer ${HA_TOKEN}` }, signal: ctrl.signal });
    if (!res.ok) throw Object.assign(new Error(`Home Assistant a répondu ${res.status}`), { status: res.status });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
let statesCache = { at: 0, map: null, error: null };
async function haStates() {
  if (!haConfigured()) return null;
  if (Date.now() - statesCache.at < 30_000) return statesCache.map;
  try {
    const list = await haFetch('/api/states');
    statesCache = { at: Date.now(), map: new Map(list.map((s) => [s.entity_id, s])), error: null };
  } catch (e) {
    statesCache = { at: Date.now(), map: null, error: e.message };
    console.error('[rosee] Home Assistant injoignable :', e.message);
  }
  return statesCache.map;
}

// Pic de luminosité des dernières 24 h, mis en cache 1 h par entité
const luxPeaks = new Map();
async function refreshLuxPeaks(entities) {
  await Promise.all(entities.map(async (id) => {
    const c = luxPeaks.get(id);
    if (c && Date.now() - c.at < 3600_000) return;
    try {
      const start = new Date(Date.now() - 24 * 3600_000).toISOString();
      const raw = await haFetch(`/api/history/period/${encodeURIComponent(start)}?filter_entity_id=${encodeURIComponent(id)}&minimal_response&no_attributes`);
      const vals = (raw[0] || []).map((x) => parseFloat(x.state)).filter((v) => !isNaN(v));
      luxPeaks.set(id, { at: Date.now(), peak: vals.length ? Math.max(...vals) : null });
    } catch {
      luxPeaks.set(id, { at: Date.now(), peak: null });
    }
  }));
}

// Mesures suivies et seuils par défaut
const METRICS = {
  moisture: { label: 'Humidité du sol', unit: '%' },
  temperature: { label: 'Température', unit: '°C' },
  illuminance: { label: 'Luminosité', unit: 'lx' },
  humidity: { label: "Humidité de l'air", unit: '%' },
};
const LUX_MIN = { ombre: 200, 'mi-ombre': 800, lumineux: 1500, soleil: 4000 };
function targetsFor(p, stored, care) {
  return {
    moisture_min: stored.moisture_min ?? care?.moisture[0] ?? 20,
    moisture_max: stored.moisture_max ?? care?.moisture[1] ?? 60,
    temp_min: stored.temp_min ?? care?.temp[0] ?? 15,
    temp_max: stored.temp_max ?? care?.temp[1] ?? 28,
    humidity_min: stored.humidity_min ?? care?.humidity ?? 40,
    lux_min: LUX_MIN[p.light] ?? 1000,
  };
}
const STALE_MS = 12 * 3600 * 1000;

function batteryFor(entityId, states) {
  if (!states) return null;
  const prefix = entityId.replace(/_[^_]+$/, '_');
  for (const s of states.values()) {
    if (s.entity_id !== entityId && s.entity_id.startsWith(prefix) && s.attributes?.device_class === 'battery') {
      const v = parseFloat(s.state);
      return isNaN(v) ? null : { entity_id: s.entity_id, value: v };
    }
  }
  return null;
}

function readSensor(metric, entityId, states, t) {
  const s = states?.get(entityId);
  if (!s) return { metric, entity_id: entityId, status: states ? 'missing' : 'unknown', value: null };
  const v = parseFloat(s.state);
  const updated = s.last_updated || s.last_changed;
  let status = 'ok';
  if (isNaN(v) || ['unavailable', 'unknown'].includes(s.state)) status = 'offline';
  else if (updated && Date.now() - new Date(updated).getTime() > STALE_MS) status = 'stale';
  let range = 'ok';
  if (status === 'ok') {
    if (metric === 'moisture') range = v < t.moisture_min ? 'low' : v > t.moisture_max ? 'high' : 'ok';
    if (metric === 'temperature') range = v < t.temp_min ? 'low' : v > t.temp_max ? 'high' : 'ok';
    if (metric === 'illuminance') {
      const peak = luxPeaks.get(entityId)?.peak;
      range = peak != null && peak < t.lux_min ? 'low' : 'ok';
    }
    if (metric === 'humidity') range = v < t.humidity_min ? 'low' : 'ok';
  }
  const battery = batteryFor(entityId, states);
  return {
    metric,
    entity_id: entityId,
    name: s.attributes?.friendly_name || entityId,
    value: isNaN(v) ? null : v,
    unit: s.attributes?.unit_of_measurement || METRICS[metric].unit,
    updated_at: updated,
    status,
    range,
    battery: battery?.value ?? null,
    peak_24h: metric === 'illuminance' ? luxPeaks.get(entityId)?.peak ?? null : undefined,
  };
}

// ---------- Logique d'arrosage ----------
const DAY = 86400000;
function localDateKey(d = new Date()) {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function localHM(d = new Date()) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
function dayDiff(fromISO, to = new Date()) {
  const a = new Date(localDateKey(new Date(fromISO)) + 'T00:00:00Z');
  const b = new Date(localDateKey(to) + 'T00:00:00Z');
  return Math.round((b - a) / DAY);
}
const parseJSON = (s, d) => { try { return JSON.parse(s || ''); } catch { return d; } };

// ---------- Saisons ----------
// Part « hiver » de chaque mois (0 = pleine saison, 1 = repos hivernal), hémisphère nord
const WINTER_SHARE = [1, 0.9, 0.6, 0.35, 0.1, 0, 0, 0, 0.2, 0.5, 0.8, 1];
const localMonth = (d) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'numeric' }).format(d)) - 1;
const winterOf = (p) => Math.max(p.interval_days, p.interval_winter || Math.round(p.interval_days * 1.6));
function intervalForMonth(p, m) {
  if (!p.seasonal) return p.interval_days;
  const share = WINTER_SHARE[SOUTH ? (m + 6) % 12 : m];
  return Math.max(1, Math.round(p.interval_days + share * (winterOf(p) - p.interval_days)));
}
const intervalAt = (p, date) => intervalForMonth(p, localMonth(date));
// Prochaines échéances à partir d'aujourd'hui, en suivant le rythme de chaque mois
function upcomingDates(p, daysLeft, horizonDays) {
  const out = [];
  const start = new Date();
  let offset = Math.max(0, daysLeft);
  while (offset <= horizonDays) {
    const d = new Date(start.getTime() + offset * DAY);
    out.push({ offset, interval: intervalAt(p, d) });
    offset += intervalAt(p, d);
  }
  return out;
}

function serializePlant(p, states) {
  const last = db.prepare('SELECT at FROM waterings WHERE plant_id=? ORDER BY at DESC LIMIT 1').get(p.id)?.at || null;
  const count = db.prepare('SELECT COUNT(*) c FROM waterings WHERE plant_id=?').get(p.id).c;
  let daysSince = null, daysLeft = 0;
  if (last) {
    daysSince = dayDiff(last);
    daysLeft = intervalAt(p, new Date(last)) - daysSince;
  }
  const care = findCare(p.species, p.name);
  const mapping = parseJSON(p.sensors, {});
  const storedTargets = parseJSON(p.targets, {});
  const targets = targetsFor(p, storedTargets, care);
  const sensors = {};
  for (const m of Object.keys(METRICS)) if (mapping[m]) sensors[m] = readSensor(m, mapping[m], states, targets);
  const readings = Object.values(sensors);

  // État global affiché en badge
  const alerts = [];
  for (const r of readings) {
    if (r.status === 'unknown') continue; // Home Assistant injoignable : pas d'alerte inventée
    if (r.status === 'offline' || r.status === 'missing') alerts.push({ level: 'sensor', text: `Capteur ${METRICS[r.metric].label.toLowerCase()} hors ligne` });
    else if (r.status === 'stale') alerts.push({ level: 'sensor', text: `Pas de nouvelle mesure depuis plus de 12 h` });
    else if (r.range === 'low' && r.metric === 'moisture') alerts.push({ level: 'attention', text: `Sol trop sec (${r.value} %)` });
    else if (r.range === 'high' && r.metric === 'moisture') alerts.push({ level: 'attention', text: `Sol trop humide (${r.value} %)` });
    else if (r.range === 'low' && r.metric === 'illuminance') alerts.push({ level: 'attention', text: `Lumière faible (max ${Math.round(r.peak_24h)} lx sur 24 h)` });
    else if (r.range !== 'ok' && r.metric === 'temperature') alerts.push({ level: 'attention', text: `Température hors plage (${r.value} °C)` });
    else if (r.range === 'low' && r.metric === 'humidity') alerts.push({ level: 'attention', text: `Air trop sec (${r.value} %)` });
    if (r.battery !== null && r.battery <= 15) alerts.push({ level: 'sensor', text: `Batterie du capteur faible (${r.battery} %)` });
  }
  const seen = new Set();
  for (let i = alerts.length - 1; i >= 0; i--) { if (seen.has(alerts[i].text)) alerts.splice(i, 1); else seen.add(alerts[i].text); }
  let health = 'ok';
  if (daysLeft <= 0) health = 'water';
  if (alerts.some((a) => a.level === 'attention')) health = health === 'water' ? 'water' : 'attention';
  if (alerts.some((a) => a.level === 'sensor') && health === 'ok') health = 'sensor';

  return {
    id: p.id,
    name: p.name,
    species: p.species,
    room: p.room,
    light: p.light,
    interval_days: p.interval_days,
    interval_winter: p.interval_winter,
    seasonal: !!p.seasonal,
    winter_interval: winterOf(p),
    current_interval: intervalAt(p, new Date()),
    month_intervals: Array.from({ length: 12 }, (_, m) => intervalForMonth(p, m)),
    care,
    notes: p.notes,
    created_at: p.created_at,
    photo_url: p.photo ? `/photos/${p.photo}` : null,
    photo_source: p.photo ? p.photo_source || 'user' : null,
    photo_credit: p.photo ? parseJSON(p.photo_credit, null) : null,
    photo_pending: !p.photo && p.photo_lookup === 0 && PHOTO_LOOKUP,
    last_watered_at: last,
    days_since: daysSince,
    days_left: daysLeft, // <= 0 : à arroser aujourd'hui (négatif = en retard)
    waterings_count: count,
    sensor_map: mapping,
    targets: storedTargets,
    effective_targets: targets,
    sensors,
    alerts,
    health,
  };
}
async function loadStates(rows) {
  const states = await haStates();
  if (states) {
    const lux = rows.map((p) => parseJSON(p.sensors, {}).illuminance).filter(Boolean);
    if (lux.length) await refreshLuxPeaks([...new Set(lux)]);
  }
  return states;
}
async function allPlants() {
  const rows = db.prepare('SELECT * FROM plants ORDER BY name COLLATE NOCASE').all();
  const states = await loadStates(rows);
  return rows.map((p) => serializePlant(p, states));
}

// ---------- Push ----------
async function pushToAll(payload) {
  const subs = db.prepare('SELECT endpoint, data FROM subscriptions').all();
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(JSON.parse(s.data), JSON.stringify(payload), { TTL: 60 * 60 * 12 });
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) db.prepare('DELETE FROM subscriptions WHERE endpoint=?').run(s.endpoint);
      else console.error('[rosee] push échoué', err.statusCode, err.body || err.message);
    }
  }
  return { sent, total: subs.length };
}

// ---------- Rappels avec actions ----------
// Jeton signé glissé dans la notification : il permet de marquer « arrosée » depuis la notification,
// sans session, uniquement pour ces plantes et pendant 3 jours.
const ACTION_KEY = crypto.createHash('sha256').update(`rosee-push:${vapid.privateKey}`).digest();
function actionToken(ids) {
  const payload = Buffer.from(JSON.stringify({ ids, exp: Date.now() + 3 * 86400e3 })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', ACTION_KEY).update(payload).digest('base64url')}`;
}
function readActionToken(tok) {
  const [payload, sig] = String(tok || '').split('.');
  if (!payload || !sig) return null;
  const want = crypto.createHmac('sha256', ACTION_KEY).update(payload).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  const d = parseJSON(Buffer.from(payload, 'base64url').toString('utf8'), null);
  return d && Array.isArray(d.ids) && d.exp > Date.now() ? d : null;
}
const listNames = (arr) => (arr.length <= 3 ? arr.join(', ') : `${arr.slice(0, 3).join(', ')} et ${arr.length - 3} autre${arr.length - 3 > 1 ? 's' : ''}`);
const shortWater = (p) => (p.care?.water ? ` · ${p.care.water.short.toLowerCase()}` : '');

// Jusqu'à 3 plantes à arroser : une notification chacune ; au-delà, une seule notification groupée.
async function buildReminders(onlyIds = null) {
  const plants = await allPlants();
  let due = plants.filter((p) => p.days_left <= 0);
  if (onlyIds) due = due.filter((p) => onlyIds.includes(p.id));
  const attention = onlyIds ? [] : plants.filter((p) => p.days_left > 0 && p.alerts.some((a) => a.level === 'attention'));
  const out = [];
  const actions = (n) => [{ action: 'water', title: n > 1 ? 'Tout est arrosé' : 'Arrosée' }, { action: 'later', title: 'Dans 3 h' }];
  if (due.length && due.length <= 3) {
    for (const p of due) {
      out.push({
        title: `Arroser ${p.name}`,
        body: `${p.days_left < 0 && p.last_watered_at ? `En retard de ${-p.days_left} j` : "Aujourd'hui"}${p.room ? ` · ${p.room}` : ''}${shortWater(p)}`,
        url: `/#/plante/${p.id}`, tag: `rosee-plant-${p.id}`, image: p.photo_url || undefined,
        token: actionToken([p.id]), actions: actions(1), done: `${p.name} arrosée`,
      });
    }
  } else if (due.length) {
    out.push({
      title: `${due.length} plantes ont soif`, body: listNames(due.map((p) => p.name)),
      url: '/', tag: 'rosee-daily', token: actionToken(due.map((p) => p.id)), actions: actions(due.length), done: `${due.length} plantes arrosées`,
    });
  }
  if (attention.length) {
    out.push({
      title: attention.length === 1 ? `À surveiller : ${attention[0].name}` : `${attention.length} plantes à surveiller`,
      body: listNames(attention.map((p) => `${p.name} (${p.alerts.find((a) => a.level === 'attention').text.toLowerCase()})`)),
      url: attention.length === 1 ? `/#/plante/${attention[0].id}` : '/#/plantes?f=alerts', tag: 'rosee-attention',
    });
  }
  return out;
}
async function sendReminders(onlyIds) {
  const list = await buildReminders(onlyIds);
  let sent = 0, total = 0;
  for (const payload of list) { const r = await pushToAll(payload); sent += r.sent; total = r.total; }
  return { sent, total, notifications: list.length };
}

// Rappels reportés (« Dans 3 h »), conservés en base pour survivre à un redémarrage
const getSnoozes = () => parseJSON(getSetting('snoozes', '[]'), []);
function addSnooze(ids, ms) { setSetting('snoozes', JSON.stringify([...getSnoozes(), { at: Date.now() + ms, ids }].slice(-50))); }

setInterval(async () => {
  try {
    // Reports arrivés à échéance : on ne renvoie que les plantes toujours pas arrosées
    const sn = getSnoozes();
    const ready = sn.filter((x) => x.at <= Date.now());
    if (ready.length) {
      setSetting('snoozes', JSON.stringify(sn.filter((x) => x.at > Date.now())));
      const ids = [...new Set(ready.flatMap((x) => x.ids))];
      const r = await sendReminders(ids);
      if (r.notifications) console.log(`[rosee] rappel reporté envoyé (${r.notifications} notification(s))`);
    }
    if (getSetting('reminder_enabled', '1') !== '1') return;
    const time = getSetting('reminder_time', '09:00');
    const today = localDateKey();
    if (getSetting('last_reminder_date', '') === today) return;
    if (localHM() < time) return;
    setSetting('last_reminder_date', today);
    const r = await sendReminders();
    if (r.notifications) console.log(`[rosee] rappel envoyé (${r.notifications} notification(s), ${r.total} appareil(s))`);
  } catch (e) {
    console.error('[rosee] erreur planificateur', e);
  }
}, 30_000);

// ---------- Application HTTP ----------
const app = express();
app.disable('x-powered-by');
// Ne croire X-Forwarded-For que d'un proxy local (NPM sur le réseau privé), pas d'un client qui l'inventerait
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');

// ---------- En-têtes de sécurité ----------
const IMG_HOSTS = [...PHOTO_HOSTS].map((h) => `https://${h}${process.env.INAT_PHOTO_HOSTS ? ` http://${h}:*` : ''}`).join(' ');
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // attributs style="--…" utilisés pour les jauges et graphiques
  `img-src 'self' data: blob: ${IMG_HOSTS}`,
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(self), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  next();
});

// ---------- Limitation de débit (par adresse IP, en mémoire) ----------
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'inconnu';
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    if (++h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: 'Trop de requêtes, réessayez dans un instant' });
    }
    next();
  };
}
const RL = process.env.RATE_LIMIT !== '0';
if (RL) {
  app.use(['/auth', '/cal', '/push-action'], rateLimit({ windowMs: 60_000, max: 30 }));
  app.use('/api', rateLimit({ windowMs: 60_000, max: 600 }));
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Flux d'agenda (.ics) pour Google Agenda, Apple Calendrier… ----------
// Placé AVANT l'authentification : Google doit pouvoir le lire. Protégé par un jeton secret.
function icsToken() {
  let t = getSetting('ics_token', '');
  if (!t) { t = crypto.randomBytes(24).toString('base64url'); setSetting('ics_token', t); }
  return t;
}
const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const icsDate = (key) => key.replace(/-/g, '');
function addDaysKey(key, n) {
  const d = new Date(key + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
app.get('/cal/:token.ics', wrap(async (req, res) => {
  const expected = Buffer.from(icsToken());
  const given = Buffer.from(String(req.params.token));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return res.status(404).end();
  const plants = await allPlants();
  const today = localDateKey();
  const horizon = 60;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rosee//Arrosages//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Rosée — arrosages', `X-WR-TIMEZONE:${TZ}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'];
  for (const p of plants) {
    for (const { offset, interval } of upcomingDates(p, p.days_left, horizon)) {
      const key = addDaysKey(today, offset);
      lines.push('BEGIN:VEVENT', `UID:rosee-${p.id}-${key}@rosee`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(key)}`, `DTEND;VALUE=DATE:${icsDate(addDaysKey(key, 1))}`,
        `SUMMARY:${icsEscape(`💧 Arroser ${p.name}`)}`,
        ...(p.room ? [`LOCATION:${icsEscape(p.room)}`] : []),
        `DESCRIPTION:${icsEscape([p.care?.water && `${p.care.water.short}. ${p.care.water.text}`, `Rythme actuel : tous les ${interval} jours.`].filter(Boolean).join('\n'))}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  res.set('Content-Type', 'text/calendar; charset=utf-8').set('Cache-Control', 'no-cache')
    .send(lines.map((l) => (l.length > 74 ? l.match(/.{1,74}/gu).join('\r\n ') : l)).join('\r\n') + '\r\n');
}));

// ---------- Actions depuis une notification ----------
app.post('/push-action', express.json({ limit: '4kb' }), wrap(async (req, res) => {
  const t = readActionToken(req.body?.token);
  if (!t) return res.status(403).json({ error: 'Lien expiré : ouvrez Rosée pour arroser' });
  const ids = t.ids.filter((id) => getPlantRow(id));
  if (req.body?.action === 'later') {
    addSnooze(ids, 3 * 3600e3);
    return res.json({ ok: true, snoozed: ids.length });
  }
  if (req.body?.action !== 'water') return res.status(400).json({ error: 'Action inconnue' });
  const today = localDateKey();
  let watered = 0;
  for (const id of ids) {
    // Pas de doublon si la plante a déjà été arrosée aujourd'hui (double appui, deux appareils)
    const last = db.prepare('SELECT at FROM waterings WHERE plant_id=? ORDER BY at DESC LIMIT 1').get(id)?.at;
    if (last && localDateKey(new Date(last)) === today) continue;
    db.prepare("INSERT INTO waterings(plant_id, at, note) VALUES(?,?,'notification')").run(id, new Date().toISOString());
    watered++;
  }
  google.scheduleSync(2000);
  res.json({ ok: true, watered });
}));

if (AUTH_USER && AUTH_PASS) {
  const expected = Buffer.from(`${AUTH_USER}:${AUTH_PASS}`);
  app.use((req, res, next) => {
    const hdr = req.headers.authorization || '';
    const given = Buffer.from(hdr.startsWith('Basic ') ? Buffer.from(hdr.slice(6), 'base64').toString() : '');
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
    res.set('WWW-Authenticate', 'Basic realm="Rosee"').status(401).send('Authentification requise');
  });
}

const jsonSmall = express.json({ limit: '100kb' });
app.use((req, res, next) => (req.path === '/api/import' ? next() : jsonSmall(req, res, next)));
app.get('/api/health', (_req, res) => res.json({ ok: true, version: BUILD.version, commit: BUILD.commit.slice(0, 7) }));
// Comptes Google : routes /auth/* et /api/me, puis garde sur l'API et les photos
const google = setupGoogle(app, { db, TZ, DATA_DIR, wrap, allPlants, upcomingDates, localDateKey, addDaysKey });
app.use(['/api', '/photos'], google.requireAuth);
app.use('/photos', express.static(PHOTO_DIR, { maxAge: '30d', immutable: true }));
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, file) {
      if (file.endsWith('sw.js') || file.endsWith('.html') || file.endsWith('.webmanifest')) res.set('Cache-Control', 'no-cache');
    },
  })
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

async function savePhoto(file) {
  if (!file) return null;
  const name = `${crypto.randomUUID()}.webp`;
  await sharp(file.buffer).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(PHOTO_DIR, name));
  return name;
}
function removePhoto(name) {
  if (name) fs.rm(path.join(PHOTO_DIR, path.basename(name)), { force: true }, () => {});
}

// ---------- Photos de référence : iNaturalist ----------
const OK_LICENSES = new Set(['cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa']);
const sized = (url, size) => (url ? url.replace(/\/(square|thumb|small|medium|large|original)\.(jpe?g|png|webp)/i, `/${size}.$2`) : null);
async function inatFetch(p) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(INAT_API + p, { headers: { 'User-Agent': 'Rosee/2 (appli auto-hebergee de suivi de plantes)', Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`iNaturalist a répondu ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
function photoInfo(ph, taxon) {
  if (!ph?.url || !OK_LICENSES.has(String(ph.license_code || '').toLowerCase())) return null;
  return {
    id: ph.id,
    thumb: ph.square_url || sized(ph.url, 'square'),
    preview: ph.medium_url || sized(ph.url, 'medium'),
    url: ph.large_url || sized(ph.url, 'large') || ph.medium_url,
    attribution: String(ph.attribution || '').slice(0, 200),
    license: String(ph.license_code || '').toUpperCase(),
    page: ph.id ? `https://www.inaturalist.org/photos/${ph.id}` : null,
    taxon: taxon?.name || null,
  };
}
// Taxons végétaux correspondant à une recherche (nom commun en français ou nom scientifique)
async function searchTaxa(q) {
  const r = await inatFetch(`/taxa?q=${encodeURIComponent(q)}&is_active=true&locale=fr&per_page=15`);
  return (r.results || [])
    .filter((t) => t.iconic_taxon_name === 'Plantae')
    .slice(0, 5)
    .map((t) => ({ id: t.id, name: t.name, common: t.preferred_common_name || null, rank: t.rank, default_photo: photoInfo(t.default_photo, t) }));
}
async function taxonPhotos(id) {
  const r = await inatFetch(`/taxa/${Number(id)}?locale=fr`);
  const t = r.results?.[0];
  if (!t) return { taxon: null, photos: [] };
  const photos = [];
  const seen = new Set();
  for (const tp of [{ photo: t.default_photo }, ...(t.taxon_photos || [])]) {
    const info = photoInfo(tp.photo, t);
    if (info && !seen.has(info.id)) { seen.add(info.id); photos.push(info); }
    if (photos.length >= 12) break;
  }
  return { taxon: { id: t.id, name: t.name, common: t.preferred_common_name || null }, photos };
}
// Télécharge une photo de référence (hôtes autorisés uniquement) et la stocke localement
async function saveRemotePhoto(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Adresse de photo invalide'); }
  if (!PHOTO_HOSTS.has(u.hostname) || !['https:', 'http:'].includes(u.protocol) || (u.protocol === 'http:' && !process.env.INAT_PHOTO_HOSTS)) {
    throw new Error('Source de photo non autorisée');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(u, { signal: ctrl.signal, redirect: 'error' });
    if (!res.ok) throw new Error(`Téléchargement impossible (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 15 * 1024 * 1024) throw new Error('Photo trop lourde');
    return await savePhoto({ buffer: buf });
  } finally {
    clearTimeout(timer);
  }
}
function refCredit(body) {
  const c = {
    attribution: String(body.ref_photo_attribution || '').slice(0, 200),
    license: String(body.ref_photo_license || '').slice(0, 20),
    page: /^https:\/\/www\.inaturalist\.org\/photos\/\d+$/.test(body.ref_photo_page || '') ? body.ref_photo_page : null,
    source: 'iNaturalist',
  };
  return JSON.stringify(c);
}

// Recherche automatique d'une photo pour les plantes qui n'en ont pas (une à la fois, ~1 requête/s)
let lookupRunning = false, lookupAgain = false;
async function runPhotoLookups() {
  if (!PHOTO_LOOKUP) return;
  if (lookupRunning) { lookupAgain = true; return; }
  lookupRunning = true;
  lookupAgain = false;
  try {
    const rows = db.prepare('SELECT * FROM plants WHERE photo IS NULL AND photo_lookup = 0 ORDER BY id').all();
    for (const p of rows) {
      const q = p.species || p.name;
      try {
        const taxa = await searchTaxa(q);
        const pick = taxa.find((t) => t.default_photo);
        let saved = null, credit = null;
        if (pick) {
          saved = await saveRemotePhoto(pick.default_photo.url);
          credit = JSON.stringify({ attribution: pick.default_photo.attribution, license: pick.default_photo.license, page: pick.default_photo.page, source: 'iNaturalist', taxon: pick.name });
        }
        // La plante a pu changer pendant le téléchargement : on n'écrase jamais une photo choisie entre-temps
        if (saved) {
          const r = db.prepare("UPDATE plants SET photo=@photo, photo_source='auto', photo_credit=@credit, photo_lookup=1 WHERE id=@id AND photo IS NULL AND photo_lookup=0").run({ id: p.id, photo: saved, credit });
          if (!r.changes) removePhoto(saved);
          // Espèce trouvée : on la renseigne si l'utilisateur ne l'a pas fait (sert aux conseils d'entretien)
          else if (pick.rank === 'species' || pick.rank === 'variety' || pick.rank === 'hybrid') db.prepare("UPDATE plants SET species=? WHERE id=? AND (species IS NULL OR species='')").run(pick.name, p.id);
        } else {
          db.prepare('UPDATE plants SET photo_lookup=1 WHERE id=? AND photo_lookup=0').run(p.id);
        }
        console.log(`[rosee] photo de référence ${saved ? 'trouvée' : 'introuvable'} pour « ${p.name} » (${q})`);
      } catch (e) {
        console.error(`[rosee] recherche de photo impossible pour « ${p.name} » :`, e.message);
        break; // réseau indisponible : on réessaiera plus tard
      }
      await new Promise((r) => setTimeout(r, 1100));
    }
  } finally {
    lookupRunning = false;
  }
  if (lookupAgain) runPhotoLookups(); // des plantes ajoutées pendant la recherche
}
setTimeout(runPhotoLookups, 5000);
setInterval(runPhotoLookups, 6 * 3600 * 1000);

const ENTITY_RE = /^sensor\.[a-z0-9_]+$/;
function plantFields(body) {
  const name = String(body.name || '').trim().slice(0, 80);
  const interval = Math.max(1, Math.min(120, parseInt(body.interval_days, 10) || 7));
  const wRaw = parseInt(body.interval_winter, 10);
  const intervalWinter = Number.isFinite(wRaw) ? Math.max(interval, Math.min(180, wRaw)) : null;
  const sensors = {};
  for (const m of Object.keys(METRICS)) {
    const v = String(body[`sensor_${m}`] || '').trim();
    if (ENTITY_RE.test(v)) sensors[m] = v;
  }
  const targets = {};
  const num = (k, lo, hi) => {
    const v = parseFloat(body[k]);
    if (!isNaN(v) && v >= lo && v <= hi) targets[k] = v;
  };
  num('moisture_min', 0, 100); num('moisture_max', 0, 100);
  num('temp_min', -10, 50); num('temp_max', -10, 50);
  num('humidity_min', 0, 100);
  return {
    name,
    species: String(body.species || '').trim().slice(0, 120),
    room: String(body.room || '').trim().slice(0, 60),
    light: String(body.light || '').trim().slice(0, 30),
    interval_days: interval,
    interval_winter: intervalWinter,
    seasonal: body.seasonal === '0' ? 0 : 1,
    notes: String(body.notes || '').slice(0, 4000),
    sensors: JSON.stringify(sensors),
    targets: JSON.stringify(targets),
  };
}

const getPlantRow = (id) => db.prepare('SELECT * FROM plants WHERE id=?').get(id);

app.get('/api/plants', wrap(async (_req, res) => res.json(await allPlants())));

app.get('/api/plants/:id', wrap(async (req, res) => {
  const p = getPlantRow(req.params.id);
  if (!p) return res.status(404).json({ error: 'Plante introuvable' });
  const history = db.prepare('SELECT id, at, note FROM waterings WHERE plant_id=? ORDER BY at DESC LIMIT 200').all(p.id);
  res.json({ ...serializePlant(p, await loadStates([p])), history });
}));

app.post('/api/plants', upload.single('photo'), wrap(async (req, res) => {
  const f = plantFields(req.body);
  if (!f.name) return res.status(400).json({ error: 'Le nom est obligatoire' });
  let photo = null, photo_source = null, photo_credit = null, photo_lookup = 0;
  if (req.file) { photo = await savePhoto(req.file); photo_source = 'user'; photo_lookup = 1; }
  else if (req.body.ref_photo_url) {
    photo = await saveRemotePhoto(req.body.ref_photo_url).catch((e) => { throw Object.assign(e, { status: 400 }); });
    photo_source = 'ref'; photo_credit = refCredit(req.body); photo_lookup = 1;
  }
  const info = db
    .prepare('INSERT INTO plants(name,species,room,light,interval_days,interval_winter,seasonal,notes,photo,sensors,targets,photo_source,photo_credit,photo_lookup) VALUES(@name,@species,@room,@light,@interval_days,@interval_winter,@seasonal,@notes,@photo,@sensors,@targets,@photo_source,@photo_credit,@photo_lookup)')
    .run({ ...f, photo, photo_source, photo_credit, photo_lookup });
  if (!photo) runPhotoLookups();
  if (req.body.watered_today === '1') db.prepare('INSERT INTO waterings(plant_id, at) VALUES(?,?)').run(info.lastInsertRowid, new Date().toISOString());
  res.status(201).json(serializePlant(getPlantRow(info.lastInsertRowid), await loadStates([])));
}));

app.put('/api/plants/:id', upload.single('photo'), wrap(async (req, res) => {
  const existing = getPlantRow(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Plante introuvable' });
  const f = plantFields(req.body);
  if (!f.name) return res.status(400).json({ error: 'Le nom est obligatoire' });
  let photo = existing.photo, photo_source = existing.photo_source, photo_credit = existing.photo_credit, photo_lookup = existing.photo_lookup;
  if (req.file) {
    photo = await savePhoto(req.file); photo_source = 'user'; photo_credit = null; photo_lookup = 1;
  } else if (req.body.ref_photo_url) {
    photo = await saveRemotePhoto(req.body.ref_photo_url).catch((e) => { throw Object.assign(e, { status: 400 }); });
    photo_source = 'ref'; photo_credit = refCredit(req.body); photo_lookup = 1;
  } else if (req.body.remove_photo === '1') {
    // Choix explicite de ne pas avoir de photo : plus de recherche automatique
    photo = null; photo_source = 'none'; photo_credit = null; photo_lookup = 1;
  } else if ((f.species !== existing.species || f.name !== existing.name) && (existing.photo_source === 'auto' || (!existing.photo && existing.photo_source !== 'none'))) {
    // Photo automatique (ou aucune trouvée) et espèce/nom modifiés : nouvelle recherche
    photo = null; photo_source = null; photo_credit = null; photo_lookup = 0;
  }
  if (photo !== existing.photo) removePhoto(existing.photo);
  db.prepare('UPDATE plants SET name=@name,species=@species,room=@room,light=@light,interval_days=@interval_days,interval_winter=@interval_winter,seasonal=@seasonal,notes=@notes,photo=@photo,sensors=@sensors,targets=@targets,photo_source=@photo_source,photo_credit=@photo_credit,photo_lookup=@photo_lookup WHERE id=@id')
    .run({ ...f, photo, photo_source, photo_credit, photo_lookup, id: existing.id });
  if (!photo && photo_lookup === 0) runPhotoLookups();
  google.scheduleSync();
  res.json(serializePlant(getPlantRow(existing.id), await loadStates([])));
}));

app.delete('/api/plants/:id', (req, res) => {
  const p = getPlantRow(req.params.id);
  if (!p) return res.status(404).json({ error: 'Plante introuvable' });
  db.prepare('DELETE FROM plants WHERE id=?').run(p.id);
  removePhoto(p.photo);
  google.scheduleSync();
  res.status(204).end();
});

app.post('/api/plants/:id/water', (req, res) => {
  const p = getPlantRow(req.params.id);
  if (!p) return res.status(404).json({ error: 'Plante introuvable' });
  let at = new Date();
  if (req.body?.at) {
    const d = new Date(req.body.at);
    if (!isNaN(d) && d <= new Date(Date.now() + 60000)) at = d;
  }
  const info = db.prepare('INSERT INTO waterings(plant_id, at, note, user_id) VALUES(?,?,?,?)').run(p.id, at.toISOString(), String(req.body?.note || '').slice(0, 500), req.user?.id ?? null);
  google.scheduleSync(2000);
  res.status(201).json({ watering_id: info.lastInsertRowid });
});

app.delete('/api/waterings/:id', (req, res) => {
  const w = db.prepare('SELECT plant_id FROM waterings WHERE id=?').get(req.params.id);
  if (!w) return res.status(404).json({ error: 'Arrosage introuvable' });
  db.prepare('DELETE FROM waterings WHERE id=?').run(req.params.id);
  google.scheduleSync(2000);
  res.json({ ok: true });
});

// Arrosages effectués sur une période (calendrier, activité récente)
app.get('/api/waterings', (req, res) => {
  const from = new Date(req.query.from || Date.now() - 31 * DAY);
  const to = new Date(req.query.to || Date.now());
  if (isNaN(from) || isNaN(to)) return res.status(400).json({ error: 'Période invalide' });
  const rows = db.prepare(`SELECT w.id, w.at, w.plant_id, p.name AS plant_name, p.room, COALESCE(NULLIF(u.given_name, ''), u.name) AS by_name
    FROM waterings w JOIN plants p ON p.id = w.plant_id LEFT JOIN users u ON u.id = w.user_id WHERE w.at >= ? AND w.at <= ? ORDER BY w.at DESC LIMIT 2000`)
    .all(from.toISOString(), to.toISOString());
  res.json(rows);
});

// ---------- Capteurs ----------
app.get('/api/ha/status', wrap(async (_req, res) => {
  if (!haConfigured()) return res.json({ configured: false });
  try {
    const r = await haFetch('/api/config');
    res.json({ configured: true, ok: true, version: r.version, location: r.location_name });
  } catch (e) {
    res.json({ configured: true, ok: false, error: e.status === 401 ? 'Jeton refusé (401)' : e.name === 'AbortError' ? 'Délai dépassé' : e.message });
  }
}));

// Entités proposées dans le formulaire plante
app.get('/api/ha/entities', wrap(async (_req, res) => {
  if (!haConfigured()) return res.json([]);
  statesCache.at = 0;
  const states = await haStates();
  if (!states) return res.status(502).json({ error: 'Home Assistant injoignable' });
  const guess = (s) => {
    const dc = s.attributes?.device_class;
    const u = s.attributes?.unit_of_measurement;
    if (dc === 'moisture') return 'moisture';
    if (dc === 'temperature' || u === '°C') return 'temperature';
    if (dc === 'illuminance' || u === 'lx') return 'illuminance';
    if (dc === 'humidity') return 'humidity';
    if (u === '%' && /moist|humid|sol|soil/i.test(s.entity_id)) return /air|humid/i.test(s.entity_id) && !/soil|sol|moist/i.test(s.entity_id) ? 'humidity' : 'moisture';
    return null;
  };
  const list = [];
  for (const s of states.values()) {
    if (!s.entity_id.startsWith('sensor.')) continue;
    const kind = guess(s);
    if (!kind) continue;
    list.push({ entity_id: s.entity_id, name: s.attributes?.friendly_name || s.entity_id, kind, state: s.state, unit: s.attributes?.unit_of_measurement || '' });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  res.json(list);
}));

// Liste des capteurs associés aux plantes
app.get('/api/sensors', wrap(async (_req, res) => {
  const plants = await allPlants();
  const out = [];
  for (const p of plants) for (const r of Object.values(p.sensors)) out.push({ ...r, plant_id: p.id, plant_name: p.name, room: p.room });
  res.json({ configured: haConfigured(), reachable: !!statesCache.map || !haConfigured(), error: statesCache.error, sensors: out });
}));

// Historique d'une mesure, agrégé par tranche (moyenne)
app.get('/api/plants/:id/history', wrap(async (req, res) => {
  const p = getPlantRow(req.params.id);
  if (!p) return res.status(404).json({ error: 'Plante introuvable' });
  const metric = String(req.query.metric || 'moisture');
  const entity = parseJSON(p.sensors, {})[metric];
  if (!entity) return res.status(404).json({ error: 'Aucun capteur pour cette mesure' });
  if (!haConfigured()) return res.status(503).json({ error: 'Home Assistant non configuré' });
  const hours = Math.max(1, Math.min(24 * 30, parseInt(req.query.hours, 10) || 168));
  const start = new Date(Date.now() - hours * 3600 * 1000);
  const raw = await haFetch(`/api/history/period/${encodeURIComponent(start.toISOString())}?filter_entity_id=${encodeURIComponent(entity)}&minimal_response&no_attributes`);
  const pts = (raw[0] || [])
    .map((s) => ({ t: new Date(s.last_changed || s.last_updated).getTime(), v: parseFloat(s.state) }))
    .filter((x) => !isNaN(x.v) && !isNaN(x.t));
  const bucketMs = (hours <= 48 ? 0.5 : hours <= 24 * 7 ? 3 : 12) * 3600 * 1000;
  const buckets = new Map();
  for (const x of pts) {
    const k = Math.floor(x.t / bucketMs) * bucketMs;
    const b = buckets.get(k) || { s: 0, n: 0 };
    b.s += x.v; b.n++;
    buckets.set(k, b);
  }
  const series = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, b]) => ({ t: t + bucketMs / 2, v: Math.round((b.s / b.n) * 10) / 10 }));
  res.json({ metric, entity, unit: METRICS[metric]?.unit || '', points: series });
}));

// ---------- Repères d'entretien ----------
app.get('/api/care', (req, res) => {
  const care = findCare(String(req.query.species || ''), String(req.query.name || ''));
  res.json({ care, current_month: localMonth(new Date()), winter_share: WINTER_SHARE, south: SOUTH });
});

// ---------- Photos de référence ----------
app.get('/api/photo-search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const taxonId = parseInt(req.query.taxon_id, 10);
  try {
    if (taxonId) return res.json({ taxa: [], ...(await taxonPhotos(taxonId)) });
    if (q.length < 2) return res.status(400).json({ error: 'Indiquez un nom ou une espèce' });
    const taxa = await searchTaxa(q);
    if (!taxa.length) return res.json({ taxa: [], taxon: null, photos: [] });
    res.json({ taxa, ...(await taxonPhotos(taxa[0].id)) });
  } catch (e) {
    res.status(502).json({ error: e.name === 'AbortError' ? 'iNaturalist ne répond pas' : `Recherche impossible : ${e.message}` });
  }
}));

// ---------- Version et mises à jour ----------
// Compare le commit de ce conteneur au dernier commit dont l'image a été construite avec succès,
// pour ne signaler une mise à jour que lorsqu'une image plus récente existe vraiment.
let updateCache = { at: 0, data: null };
async function ghFetch(p) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(GITHUB_API + p, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Rosee-update-check' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(res.status === 403 ? 'limite de requêtes GitHub atteinte, réessayez plus tard' : `GitHub a répondu ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
async function checkUpdate(force) {
  if (!UPDATE_CHECK) return { status: 'disabled' };
  if (BUILD.commit === 'dev') return { status: 'dev' };
  const ttl = force ? 60_000 : 6 * 3600_000;
  if (updateCache.data && Date.now() - updateCache.at < ttl) return updateCache.data;
  let data;
  try {
    const runs = await ghFetch(`/repos/${REPO}/actions/workflows/docker.yml/runs?branch=main&status=success&per_page=1`);
    const run = runs.workflow_runs?.[0];
    if (!run) data = { status: 'unknown', error: 'Aucune image publiée trouvée' };
    else if (run.head_sha === BUILD.commit) data = { status: 'current', latest: { commit: run.head_sha, date: run.updated_at } };
    else {
      let behind = null, messages = [];
      try {
        const cmp = await ghFetch(`/repos/${REPO}/compare/${BUILD.commit}...${run.head_sha}`);
        behind = cmp.ahead_by;
        messages = (cmp.commits || []).slice(-5).reverse().map((c) => String(c.commit?.message || '').split('\n')[0].slice(0, 120));
      } catch {}
      data = behind === 0 ? { status: 'current', latest: { commit: run.head_sha, date: run.updated_at } }
        : { status: 'available', latest: { commit: run.head_sha, date: run.updated_at }, behind, messages };
    }
  } catch (e) {
    data = { status: 'unknown', error: e.name === 'AbortError' ? 'GitHub ne répond pas' : e.message };
  }
  updateCache = { at: Date.now(), data };
  return data;
}
if (UPDATE_CHECK && BUILD.commit !== 'dev') {
  setTimeout(() => checkUpdate(), 20_000);
  setInterval(() => checkUpdate(), 6 * 3600_000);
}
app.get('/api/version', wrap(async (req, res) => {
  const update = await checkUpdate(req.query.refresh === '1');
  res.json({ ...BUILD, short: BUILD.commit.slice(0, 7), repo: REPO, update, checked_at: updateCache.at ? new Date(updateCache.at).toISOString() : null });
}));

// ---------- Sauvegardes, export et import ----------
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const BACKUP_KEEP = Math.max(1, parseInt(process.env.BACKUP_KEEP, 10) || 14);
async function backupDb(reason = 'quotidienne') {
  const file = path.join(BACKUP_DIR, `rosee-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}${reason === 'quotidienne' ? '' : `-${reason}`}.db`);
  await db.backup(file);
  const all = fs.readdirSync(BACKUP_DIR).filter((f) => /^rosee-.*\.db$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - BACKUP_KEEP))) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
  return path.basename(file);
}
// Une sauvegarde par jour (au démarrage si la dernière date de plus de 20 h)
function lastBackupAge() {
  const all = fs.readdirSync(BACKUP_DIR).filter((f) => /^rosee-.*\.db$/.test(f));
  if (!all.length) return Infinity;
  return Math.min(...all.map((f) => Date.now() - fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs));
}
setTimeout(() => { if (lastBackupAge() > 20 * 3600_000) backupDb().catch((e) => console.error('[rosee] sauvegarde impossible :', e.message)); }, 10_000).unref();
setInterval(() => backupDb().catch((e) => console.error('[rosee] sauvegarde impossible :', e.message)), 24 * 3600_000).unref();

app.get('/api/backups', (_req, res) => {
  const list = fs.readdirSync(BACKUP_DIR).filter((f) => /^rosee-.*\.db$/.test(f)).sort().reverse()
    .map((f) => ({ name: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size, at: fs.statSync(path.join(BACKUP_DIR, f)).mtime }));
  res.json({ keep: BACKUP_KEEP, backups: list });
});

const EXPORT_COLS = ['name', 'species', 'room', 'light', 'interval_days', 'interval_winter', 'seasonal', 'notes', 'sensors', 'targets', 'photo_source', 'photo_credit', 'created_at'];
app.get('/api/export', (req, res) => {
  const withPhotos = req.query.photos !== '0';
  const plants = db.prepare('SELECT * FROM plants ORDER BY id').all().map((p) => {
    const o = { ref: p.id };
    for (const c of EXPORT_COLS) o[c] = p[c];
    if (withPhotos && p.photo) {
      try { o.photo_data = fs.readFileSync(path.join(PHOTO_DIR, path.basename(p.photo))).toString('base64'); } catch {}
    }
    return o;
  });
  const waterings = db.prepare('SELECT plant_id AS plant_ref, at, note FROM waterings ORDER BY at').all();
  const settings = Object.fromEntries(db.prepare("SELECT key, value FROM settings WHERE key IN ('reminder_enabled','reminder_time','user_name')").all().map((r) => [r.key, r.value]));
  res.set('Content-Disposition', `attachment; filename="rosee-export-${localDateKey()}.json"`);
  res.json({ app: 'rosee', format: 1, version: BUILD.version, exported_at: new Date().toISOString(), plants, waterings, settings });
});

// Restauration : remplace toutes les plantes et l'historique (sauvegarde automatique juste avant)
app.post('/api/import', express.json({ limit: '80mb' }), wrap(async (req, res) => {
  const d = req.body || {};
  if (d.app !== 'rosee' || d.format !== 1 || !Array.isArray(d.plants) || !Array.isArray(d.waterings)) return res.status(400).json({ error: 'Fichier non reconnu : utilisez un export de Rosée' });
  if (d.plants.length > 2000 || d.waterings.length > 200000) return res.status(400).json({ error: 'Fichier trop volumineux' });
  const backup = await backupDb('avant-import');
  // Photos d'abord (hors transaction), en les ré-encodant : un fichier piégé ne passe pas
  const photos = new Map();
  for (const p of d.plants) {
    if (typeof p.photo_data !== 'string' || !p.photo_data) continue;
    try { photos.set(p.ref, await savePhoto({ buffer: Buffer.from(p.photo_data, 'base64') })); } catch {}
  }
  const old = db.prepare('SELECT photo FROM plants WHERE photo IS NOT NULL').all().map((r) => r.photo);
  const str = (v, n) => String(v ?? '').slice(0, n);
  const insertPlant = db.prepare(`INSERT INTO plants(name,species,room,light,interval_days,interval_winter,seasonal,notes,sensors,targets,photo,photo_source,photo_credit,photo_lookup,created_at)
    VALUES(@name,@species,@room,@light,@interval_days,@interval_winter,@seasonal,@notes,@sensors,@targets,@photo,@photo_source,@photo_credit,1,@created_at)`);
  const insertW = db.prepare('INSERT INTO waterings(plant_id, at, note) VALUES(?,?,?)');
  const refMap = new Map();
  db.transaction(() => {
    db.prepare('DELETE FROM plants').run();
    for (const p of d.plants) {
      if (!str(p.name, 80).trim()) continue;
      const iv = Math.max(1, Math.min(120, parseInt(p.interval_days, 10) || 7));
      const info = insertPlant.run({
        name: str(p.name, 80), species: str(p.species, 120), room: str(p.room, 60), light: str(p.light, 30),
        interval_days: iv, interval_winter: Number.isFinite(+p.interval_winter) && p.interval_winter !== null ? Math.max(iv, Math.min(180, +p.interval_winter)) : null,
        seasonal: p.seasonal === 0 ? 0 : 1, notes: str(p.notes, 4000),
        sensors: JSON.stringify(parseJSON(p.sensors, {})), targets: JSON.stringify(parseJSON(p.targets, {})),
        photo: photos.get(p.ref) || null, photo_source: photos.get(p.ref) ? str(p.photo_source || 'user', 10) : null,
        photo_credit: photos.get(p.ref) && p.photo_credit ? str(p.photo_credit, 600) : null,
        created_at: str(p.created_at, 30) || new Date().toISOString().slice(0, 19).replace('T', ' '),
      });
      refMap.set(p.ref, info.lastInsertRowid);
    }
    for (const w of d.waterings) {
      const id = refMap.get(w.plant_ref);
      const at = new Date(w.at);
      if (id && !isNaN(at)) insertW.run(id, at.toISOString(), str(w.note, 500));
    }
    for (const [k, v] of Object.entries(d.settings || {})) if (['reminder_enabled', 'reminder_time', 'user_name'].includes(k)) setSetting(k, str(v, 40));
  })();
  for (const f of old) removePhoto(f);
  google.scheduleSync();
  res.json({ ok: true, plants: refMap.size, waterings: db.prepare('SELECT COUNT(*) c FROM waterings').get().c, backup });
}));

// ---------- Réglages ----------
app.get('/api/settings', (_req, res) =>
  res.json({
    reminder_enabled: getSetting('reminder_enabled', '1') === '1',
    reminder_time: getSetting('reminder_time', '09:00'),
    user_name: getSetting('user_name', ''),
    timezone: TZ,
    devices: db.prepare('SELECT COUNT(*) c FROM subscriptions').get().c,
    ha_configured: haConfigured(),
  })
);
app.put('/api/settings', (req, res) => {
  if (typeof req.body.reminder_enabled === 'boolean') setSetting('reminder_enabled', req.body.reminder_enabled ? '1' : '0');
  if (typeof req.body.user_name === 'string') setSetting('user_name', req.body.user_name.trim().slice(0, 40));
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(req.body.reminder_time || '')) {
    setSetting('reminder_time', req.body.reminder_time);
    if (req.body.reminder_time > localHM()) setSetting('last_reminder_date', '');
  }
  res.json({ ok: true });
});

app.get('/api/calendar-feed', (_req, res) => res.json({ path: `/cal/${icsToken()}.ics`, base: FEED_BASE_URL }));
app.post('/api/calendar-feed/rotate', (_req, res) => {
  setSetting('ics_token', crypto.randomBytes(24).toString('base64url'));
  res.json({ path: `/cal/${icsToken()}.ics`, base: FEED_BASE_URL });
});

// ---------- Push ----------
app.get('/api/push/key', (_req, res) => res.json({ publicKey: vapid.publicKey }));
app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return res.status(400).json({ error: 'Abonnement invalide' });
  db.prepare('INSERT INTO subscriptions(endpoint,data,label) VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET data=excluded.data, label=excluded.label')
    .run(sub.endpoint, JSON.stringify(sub), String(req.body.label || '').slice(0, 80));
  res.status(201).json({ ok: true });
});
app.post('/api/push/unsubscribe', (req, res) => {
  if (req.body?.endpoint) db.prepare('DELETE FROM subscriptions WHERE endpoint=?').run(req.body.endpoint);
  res.json({ ok: true });
});
app.post('/api/push/test', wrap(async (_req, res) => {
  const r = await sendReminders();
  if (r.notifications) return res.json(r);
  res.json(await pushToAll({ title: 'Rosée est bien connectée', body: 'Aucune plante n\u2019a besoin de vous pour le moment.', url: '/', tag: 'rosee-test' }));
}));


app.use((err, _req, res, _next) => {
  if (err.status === 400) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

app.listen(PORT, () => console.log(`[rosee] v${BUILD.version} (${BUILD.commit.slice(0, 7)}) en écoute sur :${PORT} (TZ ${TZ}, données ${DATA_DIR}, Home Assistant ${haConfigured() ? HA_URL : 'non configuré'})`));
