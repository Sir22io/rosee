// Rosée — comptes Google (connexion OpenID Connect) et synchronisation avec Google Agenda.
// Tout passe par des connexions sortantes vers Google : rien à exposer sur Internet.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ENV = process.env;
const CLIENT_ID = ENV.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = ENV.GOOGLE_CLIENT_SECRET || '';
const PUBLIC_URL = (ENV.PUBLIC_URL || '').replace(/\/+$/, '');
const ALLOWED = new Set((ENV.ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
// Points d'accès Google (surchargeables pour les tests)
const AUTH_URL = ENV.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = ENV.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const REVOKE_URL = ENV.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke';
const API = (ENV.GOOGLE_API_URL || 'https://www.googleapis.com').replace(/\/+$/, '');
// Portée minimale : uniquement les agendas créés par Rosée (pas d'accès au reste de l'agenda)
const CAL_SCOPE = ENV.GOOGLE_CALENDAR_SCOPE || 'https://www.googleapis.com/auth/calendar.app.created';

const SESSION_DAYS = 60;
export const REMINDER_CHOICES = [0, 10, 30, 60, 120, 180, 1440];
const DEFAULT_CAL = { time: '18:00', duration: 15, reminders: [60], method: 'popup', horizon: 60 };

export function setupGoogle(app, ctx) {
  const { db, TZ, DATA_DIR, wrap, allPlants, upcomingDates, localDateKey, addDaysKey } = ctx;
  const enabled = !!(CLIENT_ID && CLIENT_SECRET && PUBLIC_URL);
  const secure = PUBLIC_URL.startsWith('https://');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_sub TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      name TEXT DEFAULT '',
      given_name TEXT DEFAULT '',
      refresh_token TEXT DEFAULT NULL,
      calendar_id TEXT DEFAULT NULL,
      cal_settings TEXT NOT NULL DEFAULT '{}',
      last_sync_at TEXT DEFAULT NULL,
      last_sync_error TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cal_events (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL,
      plant_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      hash TEXT NOT NULL,
      PRIMARY KEY (user_id, event_id)
    );
  `);
  const wcols = db.prepare('PRAGMA table_info(waterings)').all().map((c) => c.name);
  if (!wcols.includes('user_id')) db.exec('ALTER TABLE waterings ADD COLUMN user_id INTEGER DEFAULT NULL');

  // ---------- Chiffrement des jetons Google au repos ----------
  const keyFile = path.join(DATA_DIR, 'secret.key');
  let secret = ENV.SESSION_SECRET;
  if (!secret) {
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
    secret = fs.readFileSync(keyFile, 'utf8').trim();
  }
  const encKey = crypto.createHash('sha256').update(`rosee:${secret}`).digest();
  const encrypt = (txt) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
    const data = Buffer.concat([c.update(txt, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
  };
  const decrypt = (blob) => {
    const [iv, tag, data] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  };

  // ---------- Sessions ----------
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
  const cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  function userFromReq(req) {
    const tok = parseCookies(req.headers.cookie).rosee_session;
    if (!tok) return null;
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > datetime('now')`).get(sha(tok));
    return row || null;
  }
  db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();

  // États OAuth en mémoire (10 min)
  const states = new Map();
  const newState = (data) => {
    const id = crypto.randomBytes(24).toString('base64url');
    states.set(id, { ...data, at: Date.now() });
    for (const [k, v] of states) if (Date.now() - v.at > 600_000) states.delete(k);
    return id;
  };

  function authRedirect(res, { scope, purpose, userId, extra = {} }) {
    const verifier = crypto.randomBytes(48).toString('base64url');
    const state = newState({ purpose, verifier, userId });
    const q = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: `${PUBLIC_URL}/auth/google/callback`,
      response_type: 'code',
      scope,
      state,
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      ...extra,
    });
    res.redirect(`${AUTH_URL}?${q}`);
  }

  async function tokenRequest(params) {
    const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error_description || data.error || `Google a répondu ${res.status}`), { code: data.error, status: res.status });
    return data;
  }
  // Le jeton d'identité vient directement de Google en TLS : on vérifie ses champs, pas besoin de sa signature.
  function readIdToken(idToken) {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1] || '', 'base64url').toString('utf8'));
    if (payload.aud !== CLIENT_ID) throw new Error('Jeton destiné à une autre application');
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) && !ENV.GOOGLE_AUTH_URL) throw new Error('Émetteur inattendu');
    if (payload.exp * 1000 < Date.now()) throw new Error('Jeton expiré');
    return payload;
  }

  // ---------- Routes publiques d'authentification ----------
  const loginError = (res, msg) => res.redirect(`/#/connexion?erreur=${encodeURIComponent(msg)}`);

  app.get('/auth/google/login', (req, res) => {
    if (!enabled) return res.status(404).send('Connexion Google non configurée');
    authRedirect(res, { scope: 'openid email profile', purpose: 'login', extra: { prompt: 'select_account' } });
  });

  app.get('/auth/google/calendar', (req, res) => {
    const user = userFromReq(req);
    if (!enabled || !user) return res.redirect('/#/connexion');
    authRedirect(res, {
      scope: `openid email ${CAL_SCOPE}`,
      purpose: 'calendar',
      userId: user.id,
      extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', login_hint: user.email },
    });
  });

  app.get('/auth/google/callback', wrap(async (req, res) => {
    const st = states.get(String(req.query.state || ''));
    states.delete(String(req.query.state || ''));
    if (!st) return loginError(res, 'La demande de connexion a expiré, réessayez.');
    if (req.query.error) return st.purpose === 'calendar' ? res.redirect('/#/parametres?agenda=refuse') : loginError(res, 'Connexion annulée.');
    let tok, claims;
    try {
      tok = await tokenRequest({ grant_type: 'authorization_code', code: String(req.query.code || ''), redirect_uri: `${PUBLIC_URL}/auth/google/callback`, code_verifier: st.verifier });
      claims = readIdToken(tok.id_token);
    } catch (e) {
      console.error('[rosee] échec OAuth Google :', e.message);
      return loginError(res, 'Google a refusé la connexion. Vérifiez la configuration (README).');
    }
    const email = String(claims.email || '').toLowerCase();
    if (!claims.email_verified || !ALLOWED.has(email)) {
      console.warn(`[rosee] connexion refusée pour ${email || 'compte inconnu'}`);
      return loginError(res, `Le compte ${email} n'est pas autorisé sur cette serre.`);
    }

    if (st.purpose === 'calendar') {
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(st.userId);
      if (!user || user.google_sub !== claims.sub) return res.redirect('/#/parametres?agenda=compte');
      if (!String(tok.scope || '').split(' ').includes(CAL_SCOPE)) return res.redirect('/#/parametres?agenda=refuse');
      if (tok.refresh_token) db.prepare('UPDATE users SET refresh_token=? WHERE id=?').run(encrypt(tok.refresh_token), user.id);
      accessCache.set(user.id, { token: tok.access_token, exp: Date.now() + (tok.expires_in - 60) * 1000 });
      try {
        await ensureCalendar(db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
        scheduleSync(0);
      } catch (e) {
        db.prepare('UPDATE users SET last_sync_error=? WHERE id=?').run(e.message, user.id);
      }
      return res.redirect('/#/parametres?agenda=ok');
    }

    // Connexion
    db.prepare(`INSERT INTO users(google_sub, email, name, given_name) VALUES(@sub, @email, @name, @given)
      ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email, name=excluded.name, given_name=excluded.given_name`)
      .run({ sub: claims.sub, email, name: String(claims.name || '').slice(0, 80), given: String(claims.given_name || '').slice(0, 40) });
    const user = db.prepare('SELECT id FROM users WHERE google_sub=?').get(claims.sub);
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare(`INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?, ?, datetime('now', '+${SESSION_DAYS} days'))`).run(sha(token), user.id);
    res.set('Set-Cookie', cookie('rosee_session', token, SESSION_DAYS * 86400));
    res.redirect('/#/');
  }));

  app.post('/auth/logout', (req, res) => {
    const tok = parseCookies(req.headers.cookie).rosee_session;
    if (tok) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(tok));
    res.set('Set-Cookie', cookie('rosee_session', '', 0));
    res.json({ ok: true });
  });

  // Garde : à placer devant /api et /photos
  function requireAuth(req, res, next) {
    if (!enabled) return next();
    const user = userFromReq(req);
    if (!user) return res.status(401).json({ error: 'Connexion requise', login: true });
    req.user = user;
    next();
  }

  // ---------- Google Agenda ----------
  const accessCache = new Map();
  async function accessToken(user) {
    const c = accessCache.get(user.id);
    if (c && c.exp > Date.now()) return c.token;
    if (!user.refresh_token) throw Object.assign(new Error('Agenda non connecté'), { code: 'not_connected' });
    try {
      const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(user.refresh_token) });
      accessCache.set(user.id, { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 });
      return t.access_token;
    } catch (e) {
      if (e.code === 'invalid_grant') {
        // Accès révoqué ou expiré (application Google restée en mode « Test » : 7 jours)
        db.prepare('UPDATE users SET refresh_token=NULL, last_sync_error=? WHERE id=?').run('Accès à Google Agenda expiré ou révoqué : reconnectez l’agenda.', user.id);
      }
      throw e;
    }
  }
  async function gcal(user, method, p, body) {
    const res = await fetch(`${API}/calendar/v3${p}`, {
      method,
      headers: { Authorization: `Bearer ${await accessToken(user)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error?.message || `Google Agenda a répondu ${res.status}`), { status: res.status });
    return data;
  }
  async function ensureCalendar(user) {
    if (user.calendar_id) {
      try { await gcal(user, 'GET', `/calendars/${encodeURIComponent(user.calendar_id)}`); return user.calendar_id; }
      catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
    }
    const cal = await gcal(user, 'POST', '/calendars', { summary: 'Rosée — arrosages', description: 'Arrosages prévus par Rosée. Agenda géré automatiquement.', timeZone: TZ });
    db.prepare('UPDATE users SET calendar_id=? WHERE id=?').run(cal.id, user.id);
    db.prepare('DELETE FROM cal_events WHERE user_id=?').run(user.id);
    return cal.id;
  }
  const calSettings = (user) => ({ ...DEFAULT_CAL, ...JSON.parse(user.cal_settings || '{}') });
  // Identifiant d'événement stable : caractères autorisés par Google (a-v, 0-9)
  const eventId = (plantId, day) => `rosee${plantId}d${day.replace(/-/g, '')}`.replace(/[^a-v0-9]/g, '0');
  const plusMinutes = (hm, min) => {
    const [h, m] = hm.split(':').map(Number);
    const t = Math.min(h * 60 + m + min, 23 * 60 + 59);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };

  async function desiredEvents(user) {
    const s = calSettings(user);
    const today = localDateKey();
    const out = new Map();
    const reminders = { useDefault: false, overrides: s.reminders.slice(0, 5).map((minutes) => ({ method: s.method, minutes })) };
    const watered = new Set(db.prepare('SELECT plant_id, at FROM waterings WHERE at >= ?').all(new Date(Date.now() - 2 * 86400_000).toISOString())
      .filter((w) => localDateKey(new Date(w.at)) === today).map((w) => w.plant_id));
    for (const p of await allPlants()) {
      for (const { offset, interval } of upcomingDates(p, p.days_left, s.horizon)) {
        const day = addDaysKey(today, offset);
        const late = offset === 0 && p.days_left < 0;
        const body = {
          summary: `💧 Arroser ${p.name}${late ? ' (en retard)' : ''}`,
          description: [p.room && `Pièce : ${p.room}`, p.care?.water && `${p.care.water.short}. ${p.care.water.text}`, `Rythme actuel : tous les ${interval} jours.`, PUBLIC_URL && `${PUBLIC_URL}/#/plante/${p.id}`].filter(Boolean).join('\n'),
          ...(p.room ? { location: p.room } : {}),
          start: { dateTime: `${day}T${s.time}:00`, timeZone: TZ },
          end: { dateTime: `${day}T${plusMinutes(s.time, s.duration)}:00`, timeZone: TZ },
          reminders,
          colorId: '2', // vert sauge
          transparency: 'transparent',
          extendedProperties: { private: { rosee: '1', plant: String(p.id) } },
        };
        out.set(eventId(p.id, day), { plant_id: p.id, day, body });
      }
      // Arrosée aujourd'hui alors qu'un événement existait : on le marque comme fait plutôt que de le supprimer
      const id = eventId(p.id, today);
      if (!out.has(id) && watered.has(p.id) && db.prepare('SELECT 1 FROM cal_events WHERE user_id=? AND event_id=?').get(user.id, id)) {
        out.set(id, { plant_id: p.id, day: today, body: {
          summary: `✓ ${p.name} arrosée`, start: { dateTime: `${today}T${s.time}:00`, timeZone: TZ }, end: { dateTime: `${today}T${plusMinutes(s.time, s.duration)}:00`, timeZone: TZ },
          reminders: { useDefault: false, overrides: [] }, colorId: '8', transparency: 'transparent', status: 'confirmed',
          extendedProperties: { private: { rosee: '1', plant: String(p.id) } },
        } });
      }
    }
    return out;
  }

  async function syncUser(user) {
    if (!user.refresh_token) return;
    const calId = await ensureCalendar(user);
    const base = `/calendars/${encodeURIComponent(calId)}/events`;
    const today = localDateKey();
    const want = await desiredEvents(user);
    const have = new Map(db.prepare('SELECT * FROM cal_events WHERE user_id=?').all(user.id).map((r) => [r.event_id, r]));
    let created = 0, updated = 0, removed = 0;
    for (const [id, ev] of want) {
      const hash = crypto.createHash('sha1').update(JSON.stringify(ev.body)).digest('hex');
      const row = have.get(id);
      if (row && row.hash === hash) continue;
      if (row) {
        await gcal(user, 'PUT', `${base}/${id}`, { ...ev.body, status: 'confirmed' });
        updated++;
      } else {
        try { await gcal(user, 'POST', base, { id, ...ev.body }); }
        catch (e) {
          if (e.status !== 409) throw e;
          await gcal(user, 'PUT', `${base}/${id}`, { ...ev.body, status: 'confirmed' }); // déjà créé auparavant (ou supprimé à la main)
        }
        created++;
      }
      db.prepare('INSERT INTO cal_events(user_id, event_id, plant_id, day, hash) VALUES(?,?,?,?,?) ON CONFLICT(user_id, event_id) DO UPDATE SET hash=excluded.hash, day=excluded.day')
        .run(user.id, id, ev.plant_id, ev.day, hash);
    }
    for (const [id, row] of have) {
      if (want.has(id)) continue;
      if (row.day >= today) {
        try { await gcal(user, 'DELETE', `${base}/${id}`); } catch (e) { if (![404, 410].includes(e.status)) throw e; }
        removed++;
      }
      db.prepare('DELETE FROM cal_events WHERE user_id=? AND event_id=?').run(user.id, id);
    }
    db.prepare(`UPDATE users SET last_sync_at=datetime('now'), last_sync_error=NULL WHERE id=?`).run(user.id);
    if (created || updated || removed) console.log(`[rosee] agenda de ${user.email} : +${created} ~${updated} -${removed}`);
  }

  let syncTimer = null, syncing = false, again = false;
  async function syncAll() {
    if (!enabled) return;
    if (syncing) { again = true; return; }
    syncing = true; again = false;
    try {
      for (const u of db.prepare('SELECT * FROM users WHERE refresh_token IS NOT NULL').all()) {
        try { await syncUser(u); }
        catch (e) {
          console.error(`[rosee] synchronisation de l'agenda de ${u.email} impossible :`, e.message);
          db.prepare('UPDATE users SET last_sync_error=? WHERE id=?').run(String(e.message).slice(0, 300), u.id);
        }
      }
    } finally { syncing = false; }
    if (again) scheduleSync(2000);
  }
  function scheduleSync(delay = 5000) {
    if (!enabled) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncAll, delay);
  }
  if (enabled) {
    setTimeout(syncAll, 15_000);
    setInterval(syncAll, 3600_000); // rattrape les changements de jour et de saison
  }

  // ---------- API du compte ----------
  const meJson = (u) => {
    const s = calSettings(u);
    return {
      auth: true,
      user: { id: u.id, email: u.email, name: u.name, given_name: u.given_name },
      calendar: {
        connected: !!u.refresh_token,
        calendar_id: u.calendar_id,
        last_sync_at: u.last_sync_at,
        last_sync_error: u.last_sync_error,
        settings: s,
        choices: REMINDER_CHOICES,
      },
    };
  };
  app.get('/api/me', (req, res) => {
    if (!enabled) return res.json({ auth: false, configured: !!(CLIENT_ID || CLIENT_SECRET) });
    const u = userFromReq(req);
    if (!u) return res.status(401).json({ error: 'Connexion requise', login: true });
    res.json(meJson(u));
  });
  app.put('/api/me/calendar', requireAuth, (req, res) => {
    const s = calSettings(req.user);
    const b = req.body || {};
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time || '')) s.time = b.time;
    if ([15, 30, 60].includes(Number(b.duration))) s.duration = Number(b.duration);
    if (Array.isArray(b.reminders)) s.reminders = [...new Set(b.reminders.map(Number).filter((m) => REMINDER_CHOICES.includes(m)))].sort((x, y) => x - y).slice(0, 5);
    if (['popup', 'email'].includes(b.method)) s.method = b.method;
    if ([30, 60, 90].includes(Number(b.horizon))) s.horizon = Number(b.horizon);
    db.prepare('UPDATE users SET cal_settings=? WHERE id=?').run(JSON.stringify(s), req.user.id);
    scheduleSync(1000);
    res.json(meJson(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)));
  });
  app.post('/api/me/calendar/sync', requireAuth, wrap(async (req, res) => {
    try { await syncUser(req.user); }
    catch (e) { db.prepare('UPDATE users SET last_sync_error=? WHERE id=?').run(String(e.message).slice(0, 300), req.user.id); }
    res.json(meJson(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)));
  }));
  app.post('/api/me/calendar/disconnect', requireAuth, wrap(async (req, res) => {
    const u = req.user;
    if (u.refresh_token) {
      if (req.body?.delete_calendar && u.calendar_id) {
        try { await gcal(u, 'DELETE', `/calendars/${encodeURIComponent(u.calendar_id)}`); } catch (e) { console.error('[rosee] suppression de l’agenda :', e.message); }
      }
      try { await fetch(`${REVOKE_URL}?token=${encodeURIComponent(decrypt(u.refresh_token))}`, { method: 'POST' }); } catch {}
    }
    accessCache.delete(u.id);
    db.prepare(`UPDATE users SET refresh_token=NULL, last_sync_error=NULL${req.body?.delete_calendar ? ', calendar_id=NULL' : ''} WHERE id=?`).run(u.id);
    db.prepare('DELETE FROM cal_events WHERE user_id=?').run(u.id);
    res.json(meJson(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)));
  }));

  if (enabled && !ALLOWED.size) console.warn('[rosee] ALLOWED_EMAILS est vide : personne ne pourra se connecter.');
  if (enabled) console.log(`[rosee] connexion Google activée (${ALLOWED.size} compte(s) autorisé(s))`);
  return { enabled, requireAuth, scheduleSync };
}
