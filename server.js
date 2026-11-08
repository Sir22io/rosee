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
const FEED_BASE_URL = (process.env.FEED_BASE_URL || '').replace(/\/+$/, '');

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
function targetsFor(p, stored) {
  return {
    moisture_min: stored.moisture_min ?? 20,
    moisture_max: stored.moisture_max ?? 60,
    temp_min: stored.temp_min ?? 15,
    temp_max: stored.temp_max ?? 28,
    humidity_min: stored.humidity_min ?? 40,
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

function serializePlant(p, states) {
  const last = db.prepare('SELECT at FROM waterings WHERE plant_id=? ORDER BY at DESC LIMIT 1').get(p.id)?.at || null;
  const count = db.prepare('SELECT COUNT(*) c FROM waterings WHERE plant_id=?').get(p.id).c;
  let daysSince = null, daysLeft = 0;
  if (last) {
    daysSince = dayDiff(last);
    daysLeft = p.interval_days - daysSince;
  }
  const mapping = parseJSON(p.sensors, {});
  const storedTargets = parseJSON(p.targets, {});
  const targets = targetsFor(p, storedTargets);
  const sensors = {};
  for (const m of Object.keys(METRICS)) if (mapping[m]) sensors[m] = readSensor(m, mapping[m], states, targets);
  const readings = Object.values(sensors);

  // État global affiché en badge
  const alerts = [];
  for (const r of readings) {
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
    notes: p.notes,
    created_at: p.created_at,
    photo_url: p.photo ? `/photos/${p.photo}` : null,
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

async function buildReminder() {
  const plants = await allPlants();
  const due = plants.filter((p) => p.days_left <= 0);
  const attention = plants.filter((p) => p.days_left > 0 && p.alerts.some((a) => a.level === 'attention'));
  if (!due.length && !attention.length) return null;
  const list = (arr) => (arr.length <= 3 ? arr.join(', ') : `${arr.slice(0, 3).join(', ')} et ${arr.length - 3} autre${arr.length - 3 > 1 ? 's' : ''}`);
  const parts = [];
  if (due.length) parts.push(`À arroser : ${list(due.map((p) => p.name))}`);
  if (attention.length) parts.push(`À surveiller : ${list(attention.map((p) => `${p.name} (${p.alerts.find((a) => a.level === 'attention').text.toLowerCase()})`))}`);
  const n = due.length + attention.length;
  return {
    title: n === 1 ? '1 plante a besoin de vous' : `${n} plantes ont besoin de vous`,
    body: parts.join('\n'),
    url: '/',
    tag: 'rosee-daily',
  };
}

setInterval(async () => {
  try {
    if (getSetting('reminder_enabled', '1') !== '1') return;
    const time = getSetting('reminder_time', '09:00');
    const today = localDateKey();
    if (getSetting('last_reminder_date', '') === today) return;
    if (localHM() < time) return;
    setSetting('last_reminder_date', today);
    const payload = await buildReminder();
    if (payload) {
      const r = await pushToAll(payload);
      console.log(`[rosee] rappel envoyé (${r.sent}/${r.total})`);
    }
  } catch (e) {
    console.error('[rosee] erreur planificateur', e);
  }
}, 30_000);

// ---------- Application HTTP ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
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
    let offset = Math.max(0, p.days_left);
    while (offset <= horizon) {
      const key = addDaysKey(today, offset);
      lines.push('BEGIN:VEVENT', `UID:rosee-${p.id}-${key}@rosee`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(key)}`, `DTEND;VALUE=DATE:${icsDate(addDaysKey(key, 1))}`,
        `SUMMARY:${icsEscape(`💧 Arroser ${p.name}`)}`,
        ...(p.room ? [`LOCATION:${icsEscape(p.room)}`] : []),
        `DESCRIPTION:${icsEscape(`Tous les ${p.interval_days} jours.`)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
      offset += p.interval_days;
    }
  }
  lines.push('END:VCALENDAR');
  res.set('Content-Type', 'text/calendar; charset=utf-8').set('Cache-Control', 'no-cache')
    .send(lines.map((l) => (l.length > 74 ? l.match(/.{1,74}/gu).join('\r\n ') : l)).join('\r\n') + '\r\n');
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

app.use(express.json({ limit: '100kb' }));
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

const ENTITY_RE = /^sensor\.[a-z0-9_]+$/;
function plantFields(body) {
  const name = String(body.name || '').trim().slice(0, 80);
  const interval = Math.max(1, Math.min(120, parseInt(body.interval_days, 10) || 7));
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
  const photo = await savePhoto(req.file);
  const info = db
    .prepare('INSERT INTO plants(name,species,room,light,interval_days,notes,photo,sensors,targets) VALUES(@name,@species,@room,@light,@interval_days,@notes,@photo,@sensors,@targets)')
    .run({ ...f, photo });
  if (req.body.watered_today === '1') db.prepare('INSERT INTO waterings(plant_id, at) VALUES(?,?)').run(info.lastInsertRowid, new Date().toISOString());
  res.status(201).json(serializePlant(getPlantRow(info.lastInsertRowid), await loadStates([])));
}));

app.put('/api/plants/:id', upload.single('photo'), wrap(async (req, res) => {
  const existing = getPlantRow(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Plante introuvable' });
  const f = plantFields(req.body);
  if (!f.name) return res.status(400).json({ error: 'Le nom est obligatoire' });
  let photo = existing.photo;
  if (req.file) {
    photo = await savePhoto(req.file);
    removePhoto(existing.photo);
  } else if (req.body.remove_photo === '1') {
    removePhoto(existing.photo);
    photo = null;
  }
  db.prepare('UPDATE plants SET name=@name,species=@species,room=@room,light=@light,interval_days=@interval_days,notes=@notes,photo=@photo,sensors=@sensors,targets=@targets WHERE id=@id')
    .run({ ...f, photo, id: existing.id });
  res.json(serializePlant(getPlantRow(existing.id), await loadStates([])));
}));

app.delete('/api/plants/:id', (req, res) => {
  const p = getPlantRow(req.params.id);
  if (!p) return res.status(404).json({ error: 'Plante introuvable' });
  db.prepare('DELETE FROM plants WHERE id=?').run(p.id);
  removePhoto(p.photo);
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
  const info = db.prepare('INSERT INTO waterings(plant_id, at, note) VALUES(?,?,?)').run(p.id, at.toISOString(), String(req.body?.note || '').slice(0, 500));
  res.status(201).json({ watering_id: info.lastInsertRowid });
});

app.delete('/api/waterings/:id', (req, res) => {
  const w = db.prepare('SELECT plant_id FROM waterings WHERE id=?').get(req.params.id);
  if (!w) return res.status(404).json({ error: 'Arrosage introuvable' });
  db.prepare('DELETE FROM waterings WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Arrosages effectués sur une période (calendrier, activité récente)
app.get('/api/waterings', (req, res) => {
  const from = new Date(req.query.from || Date.now() - 31 * DAY);
  const to = new Date(req.query.to || Date.now());
  if (isNaN(from) || isNaN(to)) return res.status(400).json({ error: 'Période invalide' });
  const rows = db.prepare(`SELECT w.id, w.at, w.plant_id, p.name AS plant_name, p.room
    FROM waterings w JOIN plants p ON p.id = w.plant_id WHERE w.at >= ? AND w.at <= ? ORDER BY w.at DESC LIMIT 2000`)
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
  const payload = (await buildReminder()) || { title: 'Rosée est bien connectée', body: 'Aucune plante n’a besoin de vous pour le moment.', url: '/', tag: 'rosee-test' };
  res.json(await pushToAll(payload));
}));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

app.listen(PORT, () => console.log(`[rosee] en écoute sur :${PORT} (TZ ${TZ}, données ${DATA_DIR}, Home Assistant ${haConfigured() ? HA_URL : 'non configuré'})`));
