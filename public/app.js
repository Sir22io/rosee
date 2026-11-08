// Rosée V2 — interface « Greenhouse » (sans framework).

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');
const sheet = $('#sheet');
const isWide = () => matchMedia('(min-width: 1024px)').matches;

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id) => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const fmtNum = (v, d = 0) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d }).format(v);

// ---------- API ----------
async function api(path, opts = {}) {
  const init = { ...opts, headers: { ...(opts.headers || {}) } };
  if (opts.json !== undefined) {
    init.body = JSON.stringify(opts.json);
    init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, init);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.login && path !== '/api/me') { location.hash = '#/connexion'; throw new Error('Connexion requise'); }
  if (!res.ok) throw Object.assign(new Error(data.error || `Erreur ${res.status}`), { status: res.status, data });
  return data;
}

const state = { plants: [], settings: null, me: null, version: null };
async function loadPlants() { state.plants = await api('/api/plants'); return state.plants; }
async function loadSettings() { state.settings = await api('/api/settings'); return state.settings; }

// ---------- Thème ----------
function applyTheme(t) {
  try { localStorage.setItem('rosee-theme', t); } catch {}
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
const currentTheme = () => { try { return localStorage.getItem('rosee-theme') || 'auto'; } catch { return 'auto'; } };

// ---------- Dates ----------
const fmtLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDM = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const fmtMonth = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
// Part « hiver » de chaque mois, identique au serveur (hémisphère nord)
const SEASON_SHARE = [1, 0.9, 0.6, 0.35, 0.1, 0, 0, 0, 0.2, 0.5, 0.8, 1];
const fmtTime = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtDow = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function relPast(date) {
  const n = daysBetween(date, new Date());
  if (n === 0) return "aujourd'hui";
  if (n === 1) return 'hier';
  if (n < 7) return `il y a ${n} jours`;
  return `le ${fmtDM.format(date)}`;
}
function relAgo(iso) {
  if (!iso) return '—';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return relPast(new Date(iso));
}
function nextText(p) {
  if (!p.last_watered_at) return "Aujourd'hui";
  const d = p.days_left;
  if (d < 0) return `En retard de ${plural(-d, 'jour', 'jours')}`;
  if (d === 0) return "Aujourd'hui";
  if (d === 1) return 'Demain';
  return `Dans ${d} jours`;
}

// ---------- Éléments partagés ----------
const HEALTH = {
  ok: { cls: 'ok', icon: 'check-circle', text: 'En bonne santé' },
  water: { cls: 'water', icon: 'drop', text: 'À arroser' },
  attention: { cls: 'attention', icon: 'alert', text: 'Attention' },
  sensor: { cls: 'sensor', icon: 'sensor', text: 'Alerte capteur' },
};
const badge = (p) => { const h = HEALTH[p.health] || HEALTH.ok; return `<span class="badge b-${h.cls}">${icon(h.icon)}${h.text}</span>`; };
const needsCare = (p) => p.health !== 'ok';
const hasSensors = (p) => Object.keys(p.sensors || {}).length > 0;
const sensorOffline = (p) => Object.values(p.sensors || {}).some((s) => s.status !== 'ok');

const METRIC = {
  moisture: { label: 'Humidité sol', long: 'Humidité du sol', icon: 'drop', unit: '%' },
  temperature: { label: 'Température', long: 'Température', icon: 'thermo', unit: '°C' },
  illuminance: { label: 'Luminosité', long: 'Luminosité', icon: 'sun', unit: 'lx' },
  humidity: { label: 'Humidité air', long: "Humidité de l'air", icon: 'air', unit: '%' },
};
const fmtMetric = (m, v) => (v == null ? '—' : m === 'illuminance' ? fmtNum(Math.round(v)) : m === 'temperature' ? fmtNum(v, 1) : fmtNum(Math.round(v)));

function creditText(c) {
  if (!c) return '';
  const who = String(c.attribution || '').replace(/^\(c\)\s*/i, '').replace(/,?\s*(some|no) rights reserved.*$/i, '').trim();
  return `Photo : ${who || 'iNaturalist'}${c.license ? ` · ${c.license.toUpperCase().replace(/^CC-?/, 'CC ')}` : ''} · iNaturalist`;
}

function media(p) {
  return p.photo_url
    ? `<img src="${esc(p.photo_url)}" alt="" loading="lazy" decoding="async">`
    : `<div class="ph">${icon('pot')}</div>`;
}

// Part d'eau restante avant le prochain arrosage (1 = vient d'être arrosée)
const waterLeft = (p) => (!p.last_watered_at ? 0 : Math.max(0, Math.min(1, p.days_left / (p.current_interval || p.interval_days))));
function gauge(p) {
  const f = waterLeft(p);
  const label = p.days_left <= 0 ? nextText(p) : `${Math.round(f * 100)} % de réserve, ${nextText(p).toLowerCase()}`;
  return `<span class="gauge ${p.days_left <= 0 ? 'dry' : ''}" role="img" aria-label="${esc(label)}"><i style="width:${(f * 100).toFixed(1)}%"></i></span>`;
}
function thumb(p, extra = '') {
  if (!p) return `<span class="thumb ${extra}"><span class="ph">${icon('pot')}</span></span>`;
  return `<span class="thumb ${extra}">${p.photo_url ? `<img src="${esc(p.photo_url)}" alt="" loading="lazy" decoding="async">` : `<span class="ph">${icon('pot')}</span>`}</span>`;
}
const plantById = (id) => state.plants.find((x) => x.id === Number(id));

function plantCard(p) {
  const moist = p.sensors?.moisture;
  const conn = hasSensors(p) ? `<span class="conn ${sensorOffline(p) ? 'off' : ''}" title="${sensorOffline(p) ? 'Capteur à vérifier' : 'Capteur connecté'}">${icon('sensor')}</span>` : '';
  return `<a class="pcard" href="#/plante/${p.id}">
    <div class="media">${media(p)}${conn}${gauge(p)}</div>
    <div class="body">
      <div class="name">${esc(p.name)}</div>
      <div class="species">${esc(p.species || p.room || ' ')}</div>
      <div>${badge(p)}</div>
      <div class="mini">
        ${moist && moist.value != null ? `<span class="m1">${icon('drop-fill')}${fmtMetric('moisture', moist.value)} %</span>` : ''}
        <span class="m2">${icon('clock')}${esc(nextText(p))}</span>
      </div>
    </div>
  </a>`;
}

const LIGHTS = [
  { v: 'ombre', label: 'Ombre', suns: 1 },
  { v: 'mi-ombre', label: 'Mi-ombre', suns: 2 },
  { v: 'lumineux', label: 'Lumineux', suns: 3 },
  { v: 'soleil', label: 'Plein soleil', suns: 4 },
];
const lightLabel = (v) => LIGHTS.find((l) => l.v === v)?.label || '—';

// ---------- Toast ----------
let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => { t.classList.remove('show'); action.run(); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : 3000);
}

async function water(p, { at, quiet, after } = {}) {
  const r = await api(`/api/plants/${p.id}/water`, { method: 'POST', json: at ? { at } : {} });
  await loadPlants();
  if (!quiet) {
    toast(`${p.name} arrosée`, {
      label: 'Annuler',
      run: async () => {
        await api(`/api/waterings/${r.watering_id}`, { method: 'DELETE' });
        await loadPlants();
        toast('Arrosage annulé');
        render();
      },
    });
  }
  after?.();
  return r;
}

function setTab(name) {
  $$('[data-tab]').forEach((a) => (a.dataset.tab === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}

function emptyGarden() {
  return `<div class="card empty">
    <div class="ill">${icon('pot')}</div>
    <h2>Bienvenue dans votre serre</h2>
    <p>Ajoutez une première plante pour suivre ses arrosages et recevoir des rappels.</p>
    <button class="btn" type="button" data-add>${icon('plus')}Ajouter une plante</button>
  </div>`;
}

// ================= ACCUEIL =================
function greeting() {
  const h = new Date().getHours();
  const name = state.settings?.user_name || state.me?.user?.given_name;
  return `${h >= 18 || h < 4 ? 'Bonsoir' : 'Bonjour'}${name ? ` ${name}` : ''}`;
}

async function renderHome() {
  setTab('home');
  const P = state.plants;
  const due = P.filter((p) => p.days_left <= 0).sort((a, b) => a.days_left - b.days_left);
  const alerts = P.filter((p) => p.alerts.length);
  const attention = P.filter(needsCare);
  const healthy = P.filter((p) => p.health === 'ok').length;
  const sensorsCount = P.reduce((n, p) => n + Object.keys(p.sensors || {}).length, 0);
  const sub = attention.length
    ? `${plural(attention.length, 'plante a', 'plantes ont')} besoin d'attention aujourd'hui`
    : P.length ? 'Votre jardin se porte bien' : 'Votre serre est prête';

  view.innerHTML = `
    <div class="page-head">
      <div><h1>${esc(greeting())} ${icon('plants')}</h1><p>${esc(sub)}</p></div>
      <div class="head-actions mobile-only"><a class="icon-btn" href="#/parametres" aria-label="Paramètres">${icon('gear')}</a></div>
    </div>
    ${!P.length ? emptyGarden() : `
    <section class="card figures" aria-label="Résumé de la serre">
      <div class="fig"><b>${P.length}</b><span>${P.length > 1 ? 'plantes' : 'plante'}</span></div>
      <div class="fig ${due.length ? 'is-due' : ''}"><b>${due.length}</b><span>à arroser aujourd'hui</span></div>
      <div class="fig ${alerts.length ? 'is-alert' : ''}"><b>${alerts.length}</b><span>${alerts.length > 1 ? 'alertes' : 'alerte'} capteur</span></div>
      <div class="fig"><b>${healthy}</b><span>en bonne santé</span></div>
    </section>

    <div class="home-cols">
      <div class="col">
        <section class="card o1">
          <div class="section-title"><h2>Tâches du jour</h2><a href="#/calendrier">Calendrier</a></div>
          ${due.length ? `<ul class="tasks" id="tasks">${due.map(taskRow).join('')}</ul>`
            : `<div class="empty-line">${icon('check-circle')}<span>Aucun arrosage prévu aujourd'hui.${nextUp()}</span></div>`}
        </section>
        <section class="card o4" id="activity"><div class="section-title"><h2>Activité récente</h2></div><div class="muted">Chargement…</div></section>
      </div>
      <div class="col">
        <section class="card o2" id="conditions"></section>
        <section class="card o5" id="upcoming"></section>
      </div>
    ${attention.length ? `<section class="watch-wrap o3">
      <div class="section-title"><h2>Plantes à surveiller</h2><a href="#/plantes?f=care">Tout voir</a></div>
      <div class="watch">${attention.slice(0, isWide() ? 5 : 8).map(plantCard).join('')}</div>
    </section>` : ''}
    </div>

    </div>`}
  `;
  bindAdd();
  if (!P.length) return;
  $$('#tasks .check').forEach((b) => (b.onclick = () => checkTask(b)));
  renderConditions();
  renderUpcoming();
  try {
    const rows = await api(`/api/waterings?from=${addDays(new Date(), -21).toISOString()}`);
    const el = $('#activity');
    if (!el) return;
    el.innerHTML = `<div class="section-title"><h2>Activité récente</h2></div>${rows.length
      ? `<ul class="activity">${rows.slice(0, 5).map((w) => `<li>${thumb(plantById(w.plant_id), 'sm')}<span><b>${esc(w.plant_name)}</b> arrosée${w.by_name ? ` par ${esc(w.by_name)}` : ''}</span><time datetime="${esc(w.at)}">${esc(relAgo(w.at))}</time></li>`).join('')}</ul>`
      : `<div class="muted">Aucun arrosage ces trois dernières semaines.</div>`}`;
  } catch {}
}

function nextUp() {
  const n = state.plants.filter((p) => p.days_left > 0).sort((a, b) => a.days_left - b.days_left)[0];
  return n ? ` Prochain : ${esc(n.name)}, ${n.days_left === 1 ? 'demain' : `dans ${n.days_left} jours`}.` : '';
}

function taskRow(p) {
  const late = p.last_watered_at && p.days_left < 0;
  const sub = [p.room, p.care?.water ? esc(p.care.water.short.toLowerCase()) : '', late ? `<span class="late">${esc(nextText(p))}</span>` : p.last_watered_at ? `arrosée ${relPast(new Date(p.last_watered_at))}` : 'jamais arrosée'].filter(Boolean).join(' · ');
  return `<li class="task" data-id="${p.id}">
    ${thumb(p)}
    <a class="t-body" href="#/plante/${p.id}"><div class="t-title">Arroser ${esc(p.name)}</div><div class="t-sub">${sub}</div></a>
    <button class="check" type="button" aria-label="Marquer ${esc(p.name)} comme arrosée">${icon('check')}</button>
  </li>`;
}

async function checkTask(btn) {
  const li = btn.closest('.task');
  const p = state.plants.find((x) => x.id === Number(li.dataset.id));
  btn.classList.add('on'); btn.disabled = true;
  li.classList.add('is-done');
  try {
    await water(p);
    setTimeout(() => { if (currentRoute() === 'home') render(); }, 900);
  } catch (e) {
    btn.classList.remove('on'); btn.disabled = false; li.classList.remove('is-done');
    toast(e.message);
  }
}

let condRoom = null;
function renderConditions() {
  const el = $('#conditions');
  if (!el) return;
  const rooms = new Map();
  for (const p of state.plants) {
    for (const s of Object.values(p.sensors || {})) {
      if (s.metric === 'moisture' || s.value == null || s.status !== 'ok') continue;
      const r = p.room || 'Sans pièce';
      if (!rooms.has(r)) rooms.set(r, {});
      const bucket = rooms.get(r);
      (bucket[s.metric] ||= new Map()).set(s.entity_id, s.value); // une entité partagée n'est comptée qu'une fois
    }
  }
  if (!rooms.size) {
    el.innerHTML = `<div class="section-title"><h2>Conditions</h2><a href="#/capteurs">Capteurs</a></div>
      <div class="empty-line">${icon('sensor')}<span>${state.settings?.ha_configured ? 'Associez un capteur de température, de lumière ou d’humidité à une plante pour voir les conditions de la pièce.' : 'Connectez Home Assistant pour suivre la température, la lumière et l’humidité.'}</span></div>`;
    return;
  }
  const names = [...rooms.keys()].sort((a, b) => Object.keys(rooms.get(b)).length - Object.keys(rooms.get(a)).length);
  if (!condRoom || !rooms.has(condRoom)) condRoom = names[0];
  const b = rooms.get(condRoom);
  const avg = (m) => (b[m] ? [...b[m].values()].reduce((x, y) => x + y, 0) / b[m].size : null);
  const tiles = ['temperature', 'humidity', 'illuminance'].filter((m) => b[m]).map((m) => `
    <div class="metric m-${m}">${icon(METRIC[m].icon)}<b>${fmtMetric(m, avg(m))}<small>${METRIC[m].unit === '°C' ? '°C' : METRIC[m].unit}</small></b><span>${METRIC[m].label}</span></div>`).join('');
  el.innerHTML = `<div class="section-title"><h2>Conditions <span class="soft">(${esc(condRoom)})</span></h2>
      ${names.length > 1 ? `<button class="link-btn" type="button" id="next-room">Pièce suivante</button>` : ''}</div>
    <div class="metrics">${tiles}</div>`;
  $('#next-room')?.addEventListener('click', () => { condRoom = names[(names.indexOf(condRoom) + 1) % names.length]; renderConditions(); });
}

function renderUpcoming() {
  const el = $('#upcoming');
  if (!el) return;
  const next = state.plants.filter((p) => p.days_left > 0 && p.days_left <= 7).sort((a, b) => a.days_left - b.days_left);
  el.innerHTML = `<div class="section-title"><h2>Cette semaine</h2><a href="#/calendrier">Calendrier</a></div>
    ${next.length ? `<ul class="tasks">${next.map((p) => `<li class="task">
      ${thumb(p)}
      <a class="t-body" href="#/plante/${p.id}"><div class="t-title">Arroser ${esc(p.name)}</div><div class="t-sub">${esc(cap(fmtLong.format(addDays(new Date(), p.days_left))))}</div></a><span></span></li>`).join('')}</ul>`
      : `<div class="muted">Rien de prévu dans les 7 prochains jours.</div>`}`;
}

// ================= MES PLANTES =================
let plantFilter = 'all';
let plantQuery = '';
function renderPlants(params) {
  setTab('plants');
  if (params.get('f')) plantFilter = params.get('f');
  if (params.has('q')) plantQuery = params.get('q');
  const P = state.plants;
  const rooms = [...new Set(P.map((p) => p.room).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const count = { all: P.length, water: P.filter((p) => p.days_left <= 0).length, care: P.filter(needsCare).length, alerts: P.filter((p) => p.alerts.length).length, sensors: P.filter(hasSensors).length };
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Mes plantes</h1><p>${plural(P.length, 'plante', 'plantes')} dans votre serre</p></div>
      <div class="head-actions mobile-only"><button class="icon-btn" type="button" data-add aria-label="Ajouter une plante">${icon('plus')}</button></div>
    </div>
    ${!P.length ? emptyGarden() : `
    <label class="search mobile-only">${icon('search')}<span class="visually-hidden">Rechercher</span>
      <input type="search" id="q" placeholder="Rechercher une plante…" value="${esc(plantQuery)}" autocomplete="off"></label>
    <div class="chips" role="toolbar" aria-label="Filtres">
      ${[['all', `Toutes (${count.all})`], ['water', `À arroser (${count.water})`], ['alerts', `Alertes (${count.alerts})`], ['sensors', `Connectées (${count.sensors})`]]
        .map(([k, l]) => `<button class="chip" type="button" data-f="${k}" aria-pressed="${plantFilter === k}">${l}</button>`).join('')}
      ${rooms.map((r) => `<button class="chip" type="button" data-f="room:${esc(r)}" aria-pressed="${plantFilter === 'room:' + r}">${esc(r)}</button>`).join('')}
    </div>
    <div class="grid" id="grid"></div>`}
  `;
  bindAdd();
  if (!P.length) return;
  const draw = () => {
    const q = plantQuery.trim().toLowerCase();
    const list = P.filter((p) => {
      if (plantFilter === 'water' && p.days_left > 0) return false;
      if (plantFilter === 'care' && !needsCare(p)) return false;
      if (plantFilter === 'alerts' && !p.alerts.length) return false;
      if (plantFilter === 'sensors' && !hasSensors(p)) return false;
      if (plantFilter.startsWith('room:') && p.room !== plantFilter.slice(5)) return false;
      if (q && !`${p.name} ${p.species} ${p.room}`.toLowerCase().includes(q)) return false;
      return true;
    });
    $('#grid').innerHTML = list.length ? list.map(plantCard).join('') : `<p class="muted" style="grid-column:1/-1">Aucune plante ne correspond.</p>`;
  };
  draw();
  $('#q')?.addEventListener('input', (e) => { plantQuery = e.target.value; $('#global-q').value = plantQuery; draw(); });
  $$('.chip').forEach((b) => (b.onclick = () => {
    plantFilter = b.dataset.f;
    $$('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    draw();
  }));
  window.__drawPlants = draw;
}

// ================= FICHE PLANTE =================
let detailTab = 'suivi';
let chartMetric = null;
let chartHours = 168;
async function renderDetail(id) {
  setTab('plants');
  let p;
  try { p = await api(`/api/plants/${id}`); }
  catch {
    view.innerHTML = `<div class="card empty"><h2>Plante introuvable</h2><p>Elle a peut-être été supprimée.</p><a class="btn" href="#/plantes">Voir mes plantes</a></div>`;
    return;
  }
  view.classList.add('flush-top');
  const metrics = Object.keys(METRIC).filter((m) => p.sensors[m]);
  if (!metrics.includes(chartMetric)) chartMetric = metrics[0] || null;
  const frac = !p.last_watered_at ? 0 : Math.max(0, Math.min(1, p.days_left / (p.current_interval || p.interval_days)));
  const ringColor = p.days_left <= 0 ? 'var(--orange)' : 'var(--teal)';
  const C = 2 * Math.PI * 31;

  view.innerHTML = `
    <nav class="crumbs"><a href="#/plantes">Mes plantes</a>${icon('next')}<span>${esc(p.name)}</span></nav>
    <div class="d-wrap">
      <div class="d-left">
        <div class="d-hero">
          <div class="media">${media(p)}${p.photo_pending ? `<span class="photo-pending">Recherche d'une photo…</span>` : ''}</div>
          ${p.photo_credit ? `<a class="photo-credit" ${p.photo_credit.page ? `href="${esc(p.photo_credit.page)}" target="_blank" rel="noopener"` : ''}>${esc(creditText(p.photo_credit))}</a>` : ''}
          <div class="bar">
            <button class="icon-btn float" type="button" id="back" aria-label="Retour">${icon('back')}</button>
            <div class="right"><button class="icon-btn float" type="button" id="edit" aria-label="Modifier">${icon('edit')}</button></div>
          </div>
        </div>
        <div class="card d-id">
          <div class="top">
            <div>
              <h1>${esc(p.name)}</h1>
              ${p.species ? `<div class="sp">${esc(p.species)}</div>` : ''}
              <div class="meta">${p.room ? `<span class="room">${icon('pin')}${esc(p.room)}</span>` : ''}${badge(p)}</div>
            </div>
            <div class="ring" role="img" aria-label="${esc(nextText(p))}">
              <svg viewBox="0 0 74 74"><circle class="track" cx="37" cy="37" r="31" fill="none" stroke-width="7"/>
                <circle class="val" cx="37" cy="37" r="31" fill="none" stroke="${ringColor}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - Math.max(frac, 0.02))}"/></svg>
              <div class="lbl">${p.days_left < 0 && p.last_watered_at ? `<b>+${-p.days_left} j</b><span>de retard</span>` : p.days_left <= 0 ? `<b>Auj.</b><span>à arroser</span>` : `<b>${p.days_left} j</b><span>avant arrosage</span>`}</div>
            </div>
          </div>
          <div class="d-actions">
            <button class="btn" type="button" id="water">${icon('drop')}Arroser</button>
            <button class="icon-btn more-btn" type="button" id="more" aria-label="Plus d'actions" style="width:46px;height:46px">${icon('more')}</button>
          </div>
          ${p.care?.water ? `<p class="water-hint">${icon('drop')}<span><b>${esc(p.care.water.short)}</b> · ${esc(p.care.water.text.split(' : ')[1] || p.care.water.text)}</span></p>` : ''}
          <div class="d-quick">
            <button class="btn secondary" type="button" data-act="date">${icon('calendar')}Arrosée un autre jour</button>
            <button class="btn secondary" type="button" data-act="edit">${icon('edit')}Modifier la fiche</button>
            <button class="btn secondary" type="button" data-act="sensors">${icon('sensor')}${metrics.length ? 'Gérer les capteurs' : 'Connecter un capteur'}</button>
            <button class="btn danger" type="button" data-act="delete">${icon('trash')}Supprimer</button>
          </div>
        </div>
      </div>

      <div class="d-right stack">
        <div class="tabs" role="tablist">
          <button type="button" role="tab" data-tab-id="suivi" aria-selected="${detailTab === 'suivi'}">Suivi</button>
          <button type="button" role="tab" data-tab-id="historique" aria-selected="${detailTab === 'historique'}">Historique</button>
        </div>
        <div id="tab-body"></div>
      </div>
    </div>
  `;

  if (p.photo_pending && (renderDetail.tries = (renderDetail.tries || 0) + 1) <= 4) {
    setTimeout(async () => { if (location.hash === `#/plante/${id}`) { await loadPlants(); renderDetail(id); } }, 2500);
  } else if (!p.photo_pending) renderDetail.tries = 0;
  $('#back').onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/plantes'));
  $('#edit').onclick = () => openPlantForm(p);
  $('#more').onclick = () => openActions(p);
  $('#water').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try { await water(p); renderDetail(id); } catch (err) { toast(err.message); e.currentTarget.disabled = false; }
  };
  $$('.d-quick [data-act]').forEach((b) => (b.onclick = () => runAction(b.dataset.act, p)));
  $$('[data-tab-id]').forEach((b) => (b.onclick = () => {
    detailTab = b.dataset.tabId;
    $$('[data-tab-id]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    drawTab(p, metrics);
  }));
  drawTab(p, metrics);
}

function drawTab(p, metrics) {
  const body = $('#tab-body');
  if (detailTab === 'historique') {
    const h = p.history;
    body.innerHTML = `<section class="card">
      <div class="section-title"><h2>Arrosages <span class="soft">(${h.length})</span></h2></div>
      ${h.length ? `<ul class="timeline">${h.map((w, i) => {
        const d = new Date(w.at);
        const gap = h[i + 1] ? daysBetween(new Date(h[i + 1].at), d) : null;
        return `<li><span class="dot"></span>
          <span class="when"><b>Arrosage</b><span>${esc(cap(fmtLong.format(d)))} à ${esc(fmtTime.format(d))}</span></span>
          ${gap !== null ? `<span class="gap">+${gap} j</span>` : ''}
          <button type="button" data-del="${w.id}" aria-label="Supprimer cet arrosage">${icon('close')}</button></li>`;
      }).join('')}</ul>` : `<div class="muted">Aucun arrosage enregistré pour le moment.</div>`}
    </section>`;
    $$('[data-del]', body).forEach((b) => (b.onclick = async () => {
      await api(`/api/waterings/${b.dataset.del}`, { method: 'DELETE' });
      await loadPlants();
      toast('Arrosage supprimé');
      renderDetail(p.id);
    }));
    return;
  }

  const t = p.effective_targets;
  const last = p.last_watered_at ? new Date(p.last_watered_at) : null;
  body.innerHTML = `
    ${p.alerts.length ? `<section class="card"><div class="section-title"><h2>Conseils</h2></div>
      <ul class="advice">${p.alerts.map((a) => `<li class="lv-${a.level}">${icon(a.level === 'sensor' ? 'sensor' : 'alert')}<span>${esc(adviceText(a))}</span></li>`).join('')}</ul></section>` : ''}

    ${metrics.length ? `<section class="card">
      <div class="section-title"><h2>Conditions actuelles</h2><span class="muted" style="font-size:12.5px">${esc(relAgo(Object.values(p.sensors)[0]?.updated_at))}</span></div>
      <div class="metrics ${metrics.length > 3 ? 'four' : ''}">${metrics.map((m) => metricTile(m, p.sensors[m])).join('')}</div>
    </section>
    <section class="card">
      <div class="chart-head"><h2 style="margin:0;font-size:18px">Évolution</h2>
        <div class="seg-sm" role="group" aria-label="Période">
          <button type="button" data-h="24" aria-pressed="${chartHours === 24}">24 h</button>
          <button type="button" data-h="168" aria-pressed="${chartHours === 168}">7 jours</button>
        </div></div>
      ${metrics.length > 1 ? `<div class="metric-tabs">${metrics.map((m) => `<button type="button" data-m="${m}" aria-pressed="${m === chartMetric}">${icon(METRIC[m].icon)}${METRIC[m].label}</button>`).join('')}</div>` : ''}
      <div class="chart-layout"><div id="chart"></div><aside class="chart-facts" id="chart-facts" aria-live="polite"></aside></div>
    </section>` : `<section class="card data">
      <div class="ha-card none" style="align-items:flex-start"><div class="ha-ico">${icon('sensor')}</div>
        <div><b>Aucun capteur</b><span>Associez un capteur Home Assistant pour suivre l'humidité du sol, la lumière et la température de cette plante.</span>
        <div style="margin-top:10px"><button class="btn sm" type="button" id="connect">${icon('link')}Connecter un capteur</button></div></div></div>
    </section>`}

    <section class="card">
      <div class="section-title"><h2>Résumé</h2></div>
      <div class="summary">
        <div><span>Prochain arrosage</span><b>${esc(nextText(p))}</b></div>
        <div><span>Dernier arrosage</span><b>${last ? esc(cap(relPast(last))) : 'Jamais'}</b></div>
        <div><span>Rythme actuel</span><b>${p.current_interval === 1 ? 'Chaque jour' : `Tous les ${p.current_interval} jours`}</b></div>
        <div><span>Été / hiver</span><b>${p.seasonal ? `${p.interval_days} j / ${p.winter_interval} j` : `${p.interval_days} j toute l'année`}</b></div>
        <div><span>Lumière</span><b>${esc(lightLabel(p.light))}</b></div>
        ${metrics.includes('moisture') ? `<div><span>Humidité du sol cible</span><b>${t.moisture_min}–${t.moisture_max} %</b></div>` : ''}
        ${metrics.includes('temperature') ? `<div><span>Température idéale</span><b>${t.temp_min}–${t.temp_max} °C</b></div>` : ''}
      </div>
    </section>

    ${careCard(p)}
    ${p.notes ? `<section class="card"><div class="section-title"><h2>Notes</h2></div><p class="notes">${esc(p.notes)}</p></section>` : ''}
  `;
  $('#connect')?.addEventListener('click', () => openPlantForm(p, { focusSensors: true }));
  $$('[data-h]', body).forEach((b) => (b.onclick = () => { chartHours = Number(b.dataset.h); $$('[data-h]', body).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); loadChart(p); }));
  $$('[data-m]', body).forEach((b) => (b.onclick = () => { chartMetric = b.dataset.m; $$('[data-m]', body).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); loadChart(p); }));
  if (metrics.length) loadChart(p);
}

function careCard(p) {
  const c = p.care;
  if (!c) return '';
  const diff = c.summer !== p.interval_days || (p.seasonal && c.winter !== p.winter_interval) || !p.seasonal;
  return `<section class="card">
    <div class="section-title"><h2>Entretien <span class="soft">(${esc(c.label)})</span></h2></div>
    <div class="reco-facts" style="margin-bottom:12px">
      <span>${icon('drop')}Été : ${c.summer} j · hiver : ${c.winter} j</span>
      <span>${icon('sun')}${esc(lightLabel(c.light))}</span>
      <span>${icon('thermo')}${c.temp[0]}–${c.temp[1]} °C</span>
      <span>${icon('air')}Air ≥ ${c.humidity} %</span>
    </div>
    ${c.water ? `<div class="how-water">
      <div><span class="hw-label">${icon('drop')}Combien</span><b>${esc(c.water.short)}</b><p>${esc(c.water.text)}</p></div>
      ${c.dry ? `<div><span class="hw-label">${icon('clock')}Quand recommencer</span><p>${esc(c.dry)}</p></div>` : ''}
    </div>` : ''}
    <ul class="care-tips">${c.tips.map((t) => `<li>${icon('check')}<span>${esc(t)}</span></li>`).join('')}</ul>
    ${diff ? `<p class="muted" style="font-size:12.5px;margin:10px 0 0">Vos réglages diffèrent de ces repères : c'est normal si votre intérieur est plus chaud, plus sec ou plus lumineux. Ils restent modifiables dans la fiche.</p>` : ''}
    <p class="muted" style="font-size:11.5px;margin:8px 0 0">Repères généraux pour une culture en intérieur : vérifiez toujours la terre au doigt avant d'arroser.</p>
  </section>`;
}

function adviceText(a) {
  if (a.text.startsWith('Sol trop sec')) return `${a.text} : un arrosage est conseillé, même si la date prévue n'est pas atteinte.`;
  if (a.text.startsWith('Sol trop humide')) return `${a.text} : attendez avant le prochain arrosage.`;
  if (a.text.startsWith('Lumière faible')) return `${a.text} : rapprochez la plante d'une fenêtre.`;
  return a.text;
}

function metricTile(m, s) {
  let st = '', cls = 'ok';
  if (s.status === 'unknown') { st = 'Indisponible'; cls = 'off'; }
  else if (s.status === 'offline' || s.status === 'missing') { st = 'Hors ligne'; cls = 'off'; }
  else if (s.status === 'stale') { st = 'Pas à jour'; cls = 'off'; }
  else if (s.range === 'low') { st = m === 'illuminance' ? 'Faible sur 24 h' : 'Trop bas'; cls = 'low'; }
  else if (s.range === 'high') { st = 'Trop haut'; cls = 'high'; }
  else st = 'Normal';
  return `<div class="metric m-${m}">${icon(METRIC[m].icon)}
    <b>${fmtMetric(m, s.value)}<small>${METRIC[m].unit}</small></b><span>${METRIC[m].long}</span>
    <span class="state ${cls}">${st}</span></div>`;
}

async function loadChart(p) {
  const box = $('#chart');
  if (!box || !chartMetric) return;
  box.innerHTML = `<div class="chart-msg">Chargement…</div>`;
  try {
    const d = await api(`/api/plants/${p.id}/history?metric=${chartMetric}&hours=${chartHours}`);
    if (!$('#chart')) return;
    if (d.points.length < 2) { box.innerHTML = `<div class="chart-msg">Pas encore assez de mesures sur cette période.</div>`; return; }
    const t = p.effective_targets;
    const band = chartMetric === 'moisture' ? [t.moisture_min, t.moisture_max] : chartMetric === 'temperature' ? [t.temp_min, t.temp_max] : null;
    const marks = (p.history || []).map((w) => new Date(w.at).getTime()).filter((t) => t >= d.points[0].t);
    drawChart(box, d.points, { metric: chartMetric, hours: chartHours, band, marks });
    const facts = $('#chart-facts');
    if (facts) facts.innerHTML = chartFacts(p, chartMetric, d.points, chartHours);
  } catch (e) {
    box.innerHTML = `<div class="chart-msg">Historique indisponible : ${esc(e.message)}</div>`;
  }
}

// Graphique en aire, une seule série, avec plage cible et info-bulle
// Ce que dit la courbe, en une phrase et quelques chiffres (calculés depuis les points affichés)
function chartFacts(p, metric, pts, hours) {
  const t = p.effective_targets;
  const u = METRIC[metric].unit;
  const cur = pts.at(-1).v;
  const vals = pts.map((x) => x.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = hours > 48 ? 'sur 7 jours' : 'sur 24 h';
  const fmtD = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric' });
  let lead = '', rows = [];
  if (metric === 'moisture') {
    const lastW = p.last_watered_at ? new Date(p.last_watered_at).getTime() : null;
    const after = lastW ? pts.filter((x) => x.t >= lastW) : [];
    const peak = after.length ? Math.max(...after.map((x) => x.v)) : null;
    // Pente sur les 48 dernières heures (ou toute la fenêtre si plus courte)
    const from = pts.find((x) => x.t >= Date.now() - 48 * 3600e3) || pts[0];
    const days = (pts.at(-1).t - from.t) / 86400e3;
    const rate = days > 0.25 ? (cur - from.v) / days : 0;
    rows.push(['Maintenant', `${fmtMetric('moisture', cur)} %`]);
    if (peak != null) rows.push([`Après l'arrosage du ${fmtDM.format(new Date(lastW))}`, `${fmtMetric('moisture', peak)} %`]);
    if (rate < -0.2) rows.push(['Le sol sèche de', `${fmtNum(-rate, 1)} pt / jour`]);
    if (cur < t.moisture_min) lead = `Le sol est sous le seuil de ${t.moisture_min} % : arrosez dès maintenant.`;
    else if (rate < -0.2) {
      const dLeft = Math.max(0, (cur - t.moisture_min) / -rate);
      const when = addDays(new Date(), Math.round(dLeft));
      const planned = addDays(new Date(), Math.max(0, p.days_left));
      const diff = daysBetween(planned, when);
      lead = `Au rythme actuel, le sol atteindra ${t.moisture_min} % ${Math.round(dLeft) <= 0 ? "aujourd'hui" : Math.round(dLeft) === 1 ? 'demain' : `vers ${fmtD.format(when)}`}`
        + (diff <= -2 ? `, avant l'arrosage prévu ${fmtD.format(planned)} : pensez à l'avancer.` : diff >= 3 ? `, bien après l'arrosage prévu : vous pouvez espacer.` : `, en phase avec le calendrier.`);
    } else lead = `Humidité stable ${span}, dans la plage de ${t.moisture_min} à ${t.moisture_max} %.`;
  } else if (metric === 'temperature') {
    const out = pts.filter((x) => x.v < t.temp_min || x.v > t.temp_max).length / pts.length;
    rows.push(['Maintenant', `${fmtMetric('temperature', cur)} °C`], ['Minimum', `${fmtMetric('temperature', min)} °C`], ['Maximum', `${fmtMetric('temperature', max)} °C`]);
    lead = out === 0 ? `Toujours entre ${t.temp_min} et ${t.temp_max} °C ${span}.` : `Hors de la plage ${t.temp_min}–${t.temp_max} °C pendant ${Math.round(out * 100)} % du temps ${span}.`;
  } else if (metric === 'illuminance') {
    const byDay = new Map();
    for (const x of pts) { const k = dayKey(new Date(x.t)); byDay.set(k, Math.max(byDay.get(k) || 0, x.v)); }
    const peaks = [...byDay.values()];
    const avgPeak = peaks.reduce((a, b) => a + b, 0) / peaks.length;
    const low = peaks.filter((v) => v < t.lux_min).length;
    rows.push(['Pic moyen par jour', `${fmtNum(Math.round(avgPeak))} lx`], ['Seuil pour cette plante', `${fmtNum(t.lux_min)} lx`]);
    lead = low ? `${plural(low, 'journée', 'journées')} sous ${fmtNum(t.lux_min)} lx ${span} : rapprochez-la de la lumière.` : `Assez de lumière chaque jour ${span}.`;
  } else {
    rows.push(['Maintenant', `${fmtMetric(metric, cur)} %`], ['Minimum', `${fmtMetric(metric, min)} %`]);
    lead = min < t.humidity_min ? `L'air est descendu à ${fmtMetric(metric, min)} %, sous les ${t.humidity_min} % conseillés.` : `Air assez humide ${span}.`;
  }
  return `<p class="facts-lead">${esc(lead)}</p><dl>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

function drawChart(box, pts, { metric, hours, band, marks = [] }) {
  const W = Math.max(280, box.clientWidth || 320), H = 190;
  const m = { l: 36, r: 8, t: 26, b: 22 };
  const x0 = pts[0].t, x1 = Date.now();
  let ymin, ymax;
  const vals = pts.map((p) => p.v);
  if (metric === 'moisture' || metric === 'humidity') { ymin = 0; ymax = 100; }
  else if (metric === 'illuminance') { ymin = 0; ymax = Math.max(500, Math.ceil((Math.max(...vals) * 1.15) / 500) * 500); }
  else { ymin = Math.floor(Math.min(...vals, band?.[0] ?? Infinity) - 1); ymax = Math.ceil(Math.max(...vals, band?.[1] ?? -Infinity) + 1); }
  const X = (t) => m.l + ((t - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - ymin) / (ymax - ymin)) * (H - m.t - m.b);
  const ticks = 4;
  let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = ymin + ((ymax - ymin) * i) / ticks;
    const y = Y(v);
    grid += `<line class="grid-l" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text class="axis-t" x="${m.l - 6}" y="${y + 4}" text-anchor="end">${metric === 'illuminance' && v >= 1000 ? fmtNum(v / 1000, 1) + 'k' : fmtNum(Math.round(v))}</text>`;
  }
  let xl = '';
  if (hours > 48) {
    for (let d = startOfDay(addDays(new Date(x0), 1)); d <= x1; d = addDays(d, 1)) {
      const x = X(d.getTime());
      if (x > W - 18) continue;
      xl += `<text class="axis-t" x="${x}" y="${H - 4}" text-anchor="middle">${esc(cap(fmtDow.format(d).replace('.', '')))}</text>`;
    }
  } else {
    const s = new Date(x0); s.setMinutes(0, 0, 0); s.setHours(Math.ceil(s.getHours() / 6) * 6);
    for (let d = s; d <= x1; d = new Date(d.getTime() + 6 * 3600e3)) {
      const x = X(d.getTime());
      if (x < m.l + 10 || x > W - 18) continue;
      xl += `<text class="axis-t" x="${x}" y="${H - 4}" text-anchor="middle">${String(d.getHours()).padStart(2, '0')} h</text>`;
    }
  }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${X(pts.at(-1).t).toFixed(1)},${Y(ymin)}L${X(pts[0].t).toFixed(1)},${Y(ymin)}Z`;
  const bandRect = band ? `<rect class="band" x="${m.l}" width="${W - m.l - m.r}" y="${Y(Math.min(band[1], ymax))}" height="${Math.max(0, Y(Math.max(band[0], ymin)) - Y(Math.min(band[1], ymax)))}" rx="4"/>` : '';
  box.innerHTML = `<div class="chart" role="img" aria-label="${esc(METRIC[metric].long)} sur ${hours > 48 ? '7 jours' : '24 heures'}">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bandRect}${grid}${xl}
      <path class="area" d="${area}"/><path class="line" d="${line}"/>
      ${marks.filter((t) => t >= x0 && t <= x1).map((t) => `<g class="wmark"><line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${m.t - 6}" y2="${H - m.b}"/><circle cx="${X(t).toFixed(1)}" cy="${m.t - 10}" r="4"/></g>`).join('')}
      <line class="cross" y1="${m.t}" y2="${H - m.b}" x1="-10" x2="-10" visibility="hidden"/>
      <circle class="pt" r="4.5" cx="-10" cy="-10" visibility="hidden"/></svg>
    <div class="tip" hidden></div></div>
    <div class="chart-note">${band ? `<span><i></i>Plage cible ${band[0]}–${band[1]} ${METRIC[metric].unit}</span>` : ''}${marks.some((t) => t >= x0) ? `<span><b class="wm"></b>Arrosage</span>` : ''}</div>`;
  const chart = $('.chart', box), svg = $('svg', chart), cross = $('.cross', svg), dot = $('.pt', svg), tip = $('.tip', chart);
  const fmtWhen = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    let best = pts[0], bd = Infinity;
    for (const p of pts) { const d = Math.abs(X(p.t) - sx); if (d < bd) { bd = d; best = p; } }
    const x = X(best.t), y = Y(best.v);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `${fmtMetric(metric, best.v)} ${METRIC[metric].unit}<span>${esc(fmtWhen.format(new Date(best.t)))}</span>`;
    tip.style.left = `${Math.min(Math.max((x / W) * r.width, 50), r.width - 50)}px`;
  };
  const leave = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  chart.addEventListener('pointermove', move);
  chart.addEventListener('pointerdown', move);
  chart.addEventListener('pointerleave', leave);
}

// Actions de la fiche
function openActions(p) {
  const hasS = Object.keys(p.sensors || {}).length;
  openSheet(`<div class="sheet-inner">
    <div class="sheet-head"><h2 id="sheet-title">${esc(p.name)}</h2><button class="icon-btn" type="button" data-close aria-label="Fermer">${icon('close')}</button></div>
    <div class="menu-list">
      <button type="button" data-act="date">${icon('calendar')}Arrosée un autre jour</button>
      <button type="button" data-act="edit">${icon('edit')}Modifier la fiche</button>
      <button type="button" data-act="sensors">${icon('sensor')}${hasS ? 'Gérer les capteurs' : 'Connecter un capteur'}</button>
      <button type="button" data-act="delete" class="danger">${icon('trash')}Supprimer la plante</button>
    </div></div>`, (root) => {
    $$('[data-act]', root).forEach((b) => (b.onclick = () => { sheet.close(); runAction(b.dataset.act, p); }));
  });
}
function runAction(act, p) {
  if (act === 'date') openWaterDate(p);
  else if (act === 'edit') openPlantForm(p);
  else if (act === 'sensors') openPlantForm(p, { focusSensors: true });
  else if (act === 'delete') confirmDelete(p);
}

// ================= CALENDRIER =================
let calMonth = startOfDay(new Date()); calMonth.setDate(1);
let calSelected = startOfDay(new Date());
async function renderCalendar() {
  setTab('calendar');
  const first = new Date(calMonth);
  const gridStart = addDays(first, -((first.getDay() + 6) % 7));
  const gridEnd = addDays(gridStart, 41);
  const today = startOfDay(new Date());

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Calendrier</h1><p>Arrosages réalisés et prévus</p></div>
      <div class="head-actions"><button class="btn secondary sm green" type="button" id="feed">${icon('link')}<span>Google Agenda</span></button></div>
    </div>
    <div class="cal-layout">
      <section class="card">
        <div class="cal-head">
          <h2>${esc(fmtMonth.format(first))}</h2>
          <div class="nav">
            <button class="icon-btn" type="button" id="prev" aria-label="Mois précédent">${icon('back')}</button>
            <button class="btn secondary sm web-only" type="button" id="today">Aujourd'hui</button>
            <button class="icon-btn" type="button" id="next" aria-label="Mois suivant">${icon('next')}</button>
          </div>
        </div>
        <div class="cal-grid" id="cal"><div class="skeleton" style="grid-column:1/-1;padding:40px 0">Chargement…</div></div>
        <div class="legend"><span><i style="background:var(--ink-3)"></i>Fait</span><span><i style="background:var(--teal)"></i>Prévu</span><span><i style="background:var(--orange)"></i>En retard</span></div>
      </section>
      <section class="card cal-side" id="day-panel"></section>
    </div>`;
  $('#prev').onclick = () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); };
  $('#next').onclick = () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); };
  $('#today').onclick = () => { calMonth = startOfDay(new Date()); calMonth.setDate(1); calSelected = startOfDay(new Date()); renderCalendar(); };
  $('#feed').onclick = () => (state.me?.auth ? (location.hash = '#/parametres?section=agenda') : openFeed());

  // Événements : arrosages faits (API) + projections à partir d'aujourd'hui
  const events = new Map();
  const push = (key, ev) => { if (!events.has(key)) events.set(key, []); events.get(key).push(ev); };
  let done = [];
  try { done = await api(`/api/waterings?from=${gridStart.toISOString()}&to=${addDays(gridEnd, 1).toISOString()}`); } catch {}
  for (const w of done) { const d = new Date(w.at); push(dayKey(d), { type: 'done', plant_id: w.plant_id, name: w.plant_name, room: w.room, at: d, id: w.id }); }
  for (const p of state.plants) {
    let first = true;
    for (let d = addDays(today, Math.max(0, p.days_left)); d <= gridEnd; d = addDays(d, p.month_intervals?.[d.getMonth()] || p.interval_days)) {
      push(dayKey(d), { type: first && p.days_left < 0 ? 'late' : 'planned', plant_id: p.id, name: p.name, room: p.room, plant: p });
      first = false;
    }
  }
  const order = { late: 0, planned: 1, done: 2 };
  for (const list of events.values()) list.sort((a, b) => order[a.type] - order[b.type] || a.name.localeCompare(b.name));

  const dows = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  let html = dows.map((d) => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const key = dayKey(d);
    const ev = events.get(key) || [];
    const cls = [d.getMonth() !== first.getMonth() ? 'out' : '', key === dayKey(today) ? 'today' : ''].join(' ');
    html += `<button type="button" class="day ${cls}" data-key="${key}" aria-pressed="${key === dayKey(calSelected)}" aria-label="${esc(fmtLong.format(d))}, ${plural(ev.length, 'soin', 'soins')}">
      <span class="n">${d.getDate()}</span>
      <span class="dots">${ev.slice(0, 3).map((e) => `<i class="${e.type}"></i>`).join('')}</span>
      <span class="pills">${ev.slice(0, 3).map((e) => `<span class="${e.type}">${esc(e.name)}</span>`).join('')}${ev.length > 3 ? `<em>+${ev.length - 3}</em>` : ''}</span>
    </button>`;
  }
  $('#cal').innerHTML = html;
  $$('#cal .day').forEach((b) => (b.onclick = () => {
    calSelected = new Date(b.dataset.key + 'T00:00:00');
    $$('#cal .day').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    drawDay(events);
  }));
  drawDay(events);
}

function nextDays(events, fromKey) {
  const out = [];
  const start = new Date(fromKey + 'T00:00:00');
  for (let i = 1; i <= 7; i++) {
    const d = addDays(start, i);
    const list = (events.get(dayKey(d)) || []).filter((e) => e.type !== 'done');
    if (list.length) out.push({ d, list });
  }
  if (!out.length) return '';
  return `<div class="next-days"><h3>Les 7 jours suivants</h3>
    <ul>${out.map(({ d, list }) => `<li><span class="nd-day">${esc(cap(fmtShort.format(d).replace('.', '')))}</span>
      <span class="nd-plants">${list.map((e) => `<a href="#/plante/${e.plant_id}" title="${esc(e.name)}">${thumb(plantById(e.plant_id), 'sm')}<span>${esc(e.name)}</span></a>`).join('')}</span></li>`).join('')}</ul></div>`;
}

function drawDay(events) {
  const el = $('#day-panel');
  const key = dayKey(calSelected);
  const today = dayKey(new Date());
  const list = events.get(key) || [];
  el.innerHTML = `<div class="section-title"><h2>${esc(cap(fmtLong.format(calSelected)))}</h2></div>
    ${list.length ? `<ul class="tasks">${list.map((e) => {
      const canCheck = e.type !== 'done' && key === today;
      const sub = e.type === 'done' ? `Fait à ${fmtTime.format(e.at)}` : e.type === 'late' ? `<span class="late">${esc(nextText(e.plant))}</span>` : key < today ? 'Non réalisé' : 'Prévu';
      return `<li class="task ${e.type === 'done' ? 'is-done' : ''}" data-id="${e.plant_id}">
        ${thumb(plantById(e.plant_id))}
        <a class="t-body" href="#/plante/${e.plant_id}"><div class="t-title">Arroser ${esc(e.name)}</div><div class="t-sub">${[e.room ? esc(e.room) : '', sub].filter(Boolean).join(' · ')}</div></a>
        ${canCheck ? `<button class="check" type="button" aria-label="Marquer ${esc(e.name)} comme arrosée">${icon('check')}</button>` : '<span></span>'}
      </li>`;
    }).join('')}</ul>` : `<div class="empty-line">${icon('calendar')}<span>Aucun soin ce jour-là.</span></div>`}
    ${nextDays(events, key)}`;
  $$('.check', el).forEach((b) => (b.onclick = async () => {
    const p = state.plants.find((x) => x.id === Number(b.closest('.task').dataset.id));
    b.classList.add('on'); b.disabled = true;
    await water(p);
    renderCalendar();
  }));
}

async function openFeed() {
  const { path, base } = await api('/api/calendar-feed');
  const url = (base || location.origin) + path;
  openSheet(`<div class="sheet-inner">
    <div class="sheet-head"><h2 id="sheet-title">Afficher dans Google Agenda</h2><button class="icon-btn" type="button" data-close aria-label="Fermer">${icon('close')}</button></div>
    <div class="sheet-body">
      <p class="muted" style="margin:0">Abonnez Google Agenda à ce lien : vos arrosages prévus (60 jours) apparaîtront à côté de vos rendez-vous, sur tous vos appareils.</p>
      <div class="feed"><code id="feed-url">${esc(url)}</code><button class="icon-btn" type="button" id="copy" aria-label="Copier le lien">${icon('link')}</button></div>
      <ol class="steps">
        <li>Sur ordinateur, ouvrez Google Agenda, puis <b>Autres agendas</b> → <b>+</b> → <b>À partir de l'URL</b>.</li>
        <li>Collez le lien et validez. L'agenda « Rosée — arrosages » apparaît aussi sur votre téléphone.</li>
        <li>Google met à jour les agendas abonnés toutes les quelques heures.</li>
      </ol>
      <div class="hint"><b>Important :</b> Google lit ce lien depuis Internet. ${base ? 'Ce lien utilise l\u2019adresse publique configurée.' : 'Configurez <code>FEED_BASE_URL</code> avec une adresse joignable depuis Internet (voir README).'} Toute personne qui a le lien voit les noms de vos plantes et les dates.</div>
    </div>
    <div class="sheet-foot" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <button class="btn secondary" type="button" id="rotate">${icon('refresh')}Nouveau lien</button>
      <button class="btn" type="button" id="copy2">Copier le lien</button>
    </div></div>`, (root) => {
    const copy = async () => {
      try { await navigator.clipboard.writeText($('#feed-url', root).textContent); toast('Lien copié'); }
      catch { const r = document.createRange(); r.selectNodeContents($('#feed-url', root)); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Sélectionné : copiez-le'); }
    };
    $('#copy', root).onclick = copy;
    $('#copy2', root).onclick = copy;
    $('#rotate', root).onclick = async () => {
      const r = await api('/api/calendar-feed/rotate', { method: 'POST' });
      $('#feed-url', root).textContent = (r.base || location.origin) + r.path;
      toast("Nouveau lien créé : l'ancien ne fonctionne plus");
    };
  });
}

// ================= CAPTEURS =================
async function renderSensors() {
  setTab('sensors');
  view.innerHTML = `<div class="page-head"><div><h1>Capteurs</h1><p>Mesures lues dans Home Assistant</p></div></div><div class="skeleton">Chargement…</div>`;
  const [st, data] = await Promise.all([api('/api/ha/status'), api('/api/sensors')]);
  updateSideHA(st);
  const list = data.sensors;
  let haBlock;
  if (!st.configured) {
    haBlock = `<section class="card"><div class="ha-card none"><div class="ha-ico">${icon('sensor')}</div><div><b>Home Assistant n'est pas connecté</b><span>Rosée lit les capteurs de vos plantes via l'API de Home Assistant.</span></div></div>
      <ol class="steps">
        <li>Dans Home Assistant : <b>Profil</b> → <b>Sécurité</b> → <b>Jetons d'accès longue durée</b> → <b>Créer un jeton</b>.</li>
        <li>Dans le fichier <code>.env</code>, renseignez <code>HA_URL</code> (ex. <code>http://ip-de-home-assistant:8123</code>) et <code>HA_TOKEN</code>.</li>
        <li>Relancez : <code>docker compose up -d</code>. Associez ensuite un capteur depuis la fiche d'une plante.</li>
      </ol></section>`;
  } else if (!st.ok) {
    haBlock = `<section class="card"><div class="ha-card ko"><div class="ha-ico">${icon('alert')}</div><div><b>Home Assistant injoignable</b><span>${esc(st.error || 'Erreur inconnue')}. Vérifiez <code>HA_URL</code>, le jeton et les règles du pare-feu entre Rosée et Home Assistant.</span></div></div></section>`;
  } else {
    haBlock = `<section class="card"><div class="ha-card ok"><div class="ha-ico">${icon('check-circle')}</div><div><b>Home Assistant connecté</b><span>${esc(st.location || 'Maison')} · version ${esc(st.version || '?')} · ${plural(list.length, 'capteur associé', 'capteurs associés')}</span></div></div></section>`;
  }
  const order = { offline: 0, missing: 0, stale: 1, ok: 2 };
  list.sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || a.plant_name.localeCompare(b.plant_name));
  view.innerHTML = `
    <div class="page-head"><div><h1>Capteurs</h1><p>Mesures lues dans Home Assistant</p></div></div>
    <div class="stack-lg">
      ${haBlock}
      ${list.length ? `<div class="sensors">${list.map(sensorCard).join('')}</div>`
        : st.configured ? `<section class="card empty"><div class="ill">${icon('sensor')}</div><h2>Aucun capteur associé</h2><p>Ouvrez la fiche d'une plante, puis « Connecter un capteur » pour choisir ses entités Home Assistant.</p><a class="btn" href="#/plantes">Choisir une plante</a></section>` : ''}
    </div>`;
}

function sensorCard(s) {
  const M = METRIC[s.metric];
  const off = s.status === 'offline' || s.status === 'missing';
  const stale = s.status === 'stale';
  const status = off ? `<span class="status-dot off">${s.status === 'missing' ? 'Entité introuvable' : 'Hors ligne'}</span>` : stale ? `<span class="status-dot warn">Pas à jour</span>` : `<span class="status-dot ok">Connecté</span>`;
  const bat = s.battery != null ? `<span class="bat ${s.battery <= 15 ? 'low' : ''}">${icon('battery')}${fmtNum(s.battery)} %</span>` : '';
  const color = { moisture: 'var(--teal)', temperature: 'var(--red)', illuminance: 'var(--orange)', humidity: 'var(--green-2)' }[s.metric];
  return `<a class="card sensor" href="#/plante/${s.plant_id}">
    ${thumb(plantById(s.plant_id))}
    <div style="min-width:0"><div class="s-name"><span class="s-metric" style="color:${color}">${icon(M.icon)}</span>${esc(s.name || s.entity_id)}</div>
      <div class="s-sub">${esc(s.plant_name)}${s.room ? ` · ${esc(s.room)}` : ''} · ${esc(M.long)}</div>
      <div class="s-state">${status}${bat}</div></div>
    <div class="s-val"><b>${off ? '—' : fmtMetric(s.metric, s.value)}</b><small> ${off ? '' : esc(s.unit || M.unit)}</small><span>${esc(relAgo(s.updated_at))}</span></div>
  </a>`;
}

function updateSideHA(st) {
  const el = $('#side-ha');
  if (!el) return;
  if (!st?.configured) { el.innerHTML = `<a class="side-ha" href="#/capteurs">${icon('sensor')}<span><b>Home Assistant</b>Non connecté</span></a>`; return; }
  el.innerHTML = `<a class="side-ha" href="#/capteurs"><span class="status-dot ${st.ok ? 'ok' : 'off'}"></span><span><b>Home Assistant</b>${st.ok ? 'Connecté' : 'Injoignable'}</span></a>`;
}

// ================= PARAMÈTRES =================
async function renderSettings() {
  setTab('settings');
  const st = await loadSettings();
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const sub = supported ? await currentSubscription() : null;
  const on = !!sub && Notification.permission === 'granted';
  const denied = supported && Notification.permission === 'denied';

  let push;
  if (!supported && isIOS && !standalone) push = `<div class="hint"><b>Sur iPhone</b>, installez d'abord Rosée : <b>Partager</b> → <b>Sur l'écran d'accueil</b>, puis ouvrez-la depuis son icône et revenez ici.</div>`;
  else if (!supported) push = `<div class="hint">Ce navigateur ne gère pas les notifications. Ouvrez Rosée en HTTPS dans Chrome, Edge, Firefox ou Safari récent.</div>`;
  else push = `<div class="row"><div class="txt"><b>${on ? 'Cet appareil reçoit les rappels' : 'Rappels sur cet appareil'}</b><span>${on ? 'Notifications activées' : denied ? 'Bloquées dans les réglages du navigateur' : 'Désactivés'}</span></div>
      ${on ? `<button class="btn secondary sm" type="button" id="unsub">Désactiver</button>` : `<button class="btn sm" type="button" id="sub" ${denied ? 'disabled' : ''}>${icon('bell')}Activer</button>`}</div>
    ${on ? `<div class="row"><div class="txt"><b>Tester</b><span>Envoie la notification du jour à vos appareils</span></div><button class="btn secondary sm" type="button" id="test">Envoyer</button></div>` : ''}`;

  view.innerHTML = `
    <div class="page-head"><div><h1>Paramètres</h1><p>Rappels, agenda, apparence et connexions</p></div></div>
    <div class="settings-grid">
      <section class="card">
        <div class="section-title"><h2>${icon('bell')} Rappels</h2></div>
        <div class="rows">
          ${push}
          <div class="row"><div class="txt"><b>Rappel quotidien</b><span>Seulement si une plante a besoin de vous</span></div>
            <label class="switch"><input type="checkbox" id="enabled" ${st.reminder_enabled ? 'checked' : ''} aria-label="Rappel quotidien"><span></span></label></div>
          <div class="row"><div class="txt"><b>Heure</b><span>Fuseau ${esc(st.timezone)}</span></div>
            <input class="input time-input" type="time" id="time" value="${esc(st.reminder_time)}" aria-label="Heure du rappel"></div>
        </div>
        <p class="muted" style="font-size:12.5px;margin:10px 0 0">${plural(st.devices, 'appareil abonné', 'appareils abonnés')}</p>
      </section>

      <section class="card">
        <div class="section-title"><h2>Profil et apparence</h2></div>
        <div class="rows">
          <div class="row"><div class="txt"><b>Prénom</b><span>Pour l'accueil</span></div>
            <input class="input" style="max-width:170px" id="uname" value="${esc(st.user_name)}" maxlength="40" placeholder="Votre prénom" autocomplete="given-name"></div>
          <div class="row" style="flex-wrap:wrap"><div class="txt"><b>Thème</b><span>Clair, sombre ou selon l'appareil</span></div>
            <div class="seg-sm" role="group" aria-label="Thème">
              ${[['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, l]) => `<button type="button" data-theme-opt="${k}" aria-pressed="${currentTheme() === k}">${l}</button>`).join('')}
            </div></div>
        </div>
      </section>

      <section class="card">
        <div class="section-title"><h2>Agenda</h2></div>
        ${state.me?.auth ? '<div id="gcal"></div>' : ''}
        <div class="rows"><div class="row"><div class="txt"><b>${state.me?.auth ? 'Lien d\u2019abonnement (.ics)' : 'Google Agenda'}</b><span>${state.me?.auth ? 'Autre méthode, sans compte : lecture seule, exposition requise' : 'Voir les arrosages prévus à côté de vos rendez-vous'}</span></div>
          <button class="btn secondary sm green" type="button" id="feed">${icon('link')}${state.me?.auth ? 'Afficher' : 'Configurer'}</button></div></div>
      </section>

      ${state.me?.auth ? `<section class="card">
        <div class="section-title"><h2>Compte</h2></div>
        <div class="account">
          <span class="avatar" aria-hidden="true">${esc((state.me.user.given_name || state.me.user.name || state.me.user.email).charAt(0).toUpperCase())}</span>
          <div class="txt"><b>${esc(state.me.user.name || state.me.user.email)}</b><span>${esc(state.me.user.email)}</span></div>
          <button class="btn secondary sm" type="button" id="logout">Se déconnecter</button>
        </div>
        <p class="muted" style="font-size:12.5px;margin:12px 0 0">La serre est partagée : tous les comptes autorisés voient les mêmes plantes. Chacun connecte son propre agenda et règle ses alertes.</p>
      </section>` : ''}

      <section class="card" id="backup">
        <div class="section-title"><h2>Sauvegarde</h2></div>
        <div class="rows">
          <div class="row"><div class="txt"><b>Sauvegardes automatiques</b><span id="backup-info">…</span></div></div>
          <div class="row"><div class="txt"><b>Exporter</b><span>Plantes, photos et historique dans un fichier</span></div>
            <a class="btn secondary sm" href="/api/export" download>${icon('link')}Télécharger</a></div>
          <div class="row"><div class="txt"><b>Restaurer</b><span>Remplace les données actuelles par un export</span></div>
            <label class="btn secondary sm file-btn">Choisir un fichier<input type="file" id="import-file" accept="application/json,.json"></label></div>
        </div>
      </section>

      <section class="card" id="about"><div class="section-title"><h2>À propos</h2></div><div class="muted">Vérification…</div></section>

      <section class="card" id="ha-settings"><div class="section-title"><h2>Home Assistant</h2></div><div class="muted">Vérification…</div></section>
    </div>`;

  $('#enabled').onchange = async (e) => { await api('/api/settings', { method: 'PUT', json: { reminder_enabled: e.target.checked } }); toast(e.target.checked ? 'Rappel quotidien activé' : 'Rappel quotidien coupé'); };
  $('#time').onchange = async (e) => { await api('/api/settings', { method: 'PUT', json: { reminder_time: e.target.value } }); toast(`Rappel à ${e.target.value}`); };
  $('#uname').onchange = async (e) => { await api('/api/settings', { method: 'PUT', json: { user_name: e.target.value } }); await loadSettings(); toast('Prénom enregistré'); };
  $$('[data-theme-opt]').forEach((b) => (b.onclick = () => { applyTheme(b.dataset.themeOpt); $$('[data-theme-opt]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
  $('#feed').onclick = openFeed;
  $('#logout')?.addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); state.me = null; location.hash = '#/connexion'; });
  if (state.me?.auth) drawGcal();
  const qp = new URLSearchParams((location.hash.split('?')[1] || ''));
  const msg = { ok: 'Google Agenda connecté', refuse: 'Accès à l\u2019agenda refusé', compte: 'Connectez l\u2019agenda avec le même compte Google' }[qp.get('agenda')];
  if (msg) { toast(msg); history.replaceState(null, '', '#/parametres'); }
  if (qp.get('section') === 'agenda' || qp.get('agenda')) setTimeout(() => $('#gcal')?.scrollIntoView({ block: 'center' }), 50);
  $('#sub')?.addEventListener('click', async (e) => { e.currentTarget.disabled = true; try { await subscribe(); toast('Rappels activés sur cet appareil'); } catch (err) { toast(err.message); } renderSettings(); });
  $('#unsub')?.addEventListener('click', async () => { await unsubscribe(); toast('Rappels désactivés sur cet appareil'); renderSettings(); });
  $('#test')?.addEventListener('click', async () => { const r = await api('/api/push/test', { method: 'POST' }); toast(r.sent ? 'Notification de test envoyée' : "Aucun appareil n'a reçu le test"); });

  drawAbout();
  api('/api/backups').then((b) => {
    const el = $('#backup-info');
    if (!el) return;
    const last = b.backups[0];
    el.textContent = last ? `${plural(b.backups.length, 'sauvegarde conservée', 'sauvegardes conservées')} sur ${b.keep}, la dernière ${relAgo(last.at)}` : `Une par jour, ${b.keep} conservées`;
  }).catch(() => {});
  $('#import-file').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    openSheet(`<div class="sheet-inner">
      <div class="sheet-head"><h2 id="sheet-title">Restaurer cet export ?</h2><button class="icon-btn" type="button" data-close aria-label="Fermer">${icon('close')}</button></div>
      <div class="sheet-body"><p class="muted" style="margin:0">Toutes les plantes et l'historique actuels seront remplacés par le contenu de « ${esc(f.name)} ». Une sauvegarde de l'état actuel est faite juste avant.</p></div>
      <div class="sheet-foot" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <button class="btn secondary" type="button" data-close>Annuler</button>
        <button class="btn solid-danger" type="button" id="import-ok">Restaurer</button></div></div>`, (root) => {
      $$('[data-close]', root).forEach((b) => (b.onclick = () => { sheet.close(); e.target.value = ''; }));
      $('#import-ok', root).onclick = async (ev) => {
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Restauration…';
        try {
          const data = JSON.parse(await f.text());
          const r = await api('/api/import', { method: 'POST', json: data });
          await loadPlants(); sheet.close();
          toast(`${plural(r.plants, 'plante restaurée', 'plantes restaurées')}`);
          renderSettings();
        } catch (err) { sheet.close(); toast(err instanceof SyntaxError ? 'Fichier illisible' : err.message); }
        e.target.value = '';
      };
    });
  };
  const ha = await api('/api/ha/status');
  updateSideHA(ha);
  const el = $('#ha-settings');
  if (el) el.innerHTML = `<div class="section-title"><h2>Home Assistant</h2><a href="#/capteurs">Capteurs</a></div>
    <div class="ha-card ${!ha.configured ? 'none' : ha.ok ? 'ok' : 'ko'}"><div class="ha-ico">${icon(!ha.configured ? 'sensor' : ha.ok ? 'check-circle' : 'alert')}</div>
    <div><b>${!ha.configured ? 'Non configuré' : ha.ok ? 'Connecté' : 'Injoignable'}</b><span>${!ha.configured ? 'Renseignez HA_URL et HA_TOKEN dans le fichier .env.' : ha.ok ? `Version ${esc(ha.version)}` : esc(ha.error)}</span></div></div>`;
}

// ---------- Version et mises à jour ----------
async function loadVersion(refresh) {
  try { state.version = await api(`/api/version${refresh ? '?refresh=1' : ''}`); } catch { state.version = null; }
  updateSideVersion();
  return state.version;
}
function updateSideVersion() {
  const v = state.version;
  const el = $('#side-version');
  if (!el || !v) return;
  const up = v.update?.status === 'available';
  el.innerHTML = up
    ? `<a class="side-update" href="#/parametres?section=about"><span class="status-dot warn"></span><span><b>Mise à jour disponible</b>v${esc(v.version)} · ${esc(v.short)}</span></a>`
    : `<span class="side-ver">Rosée v${esc(v.version)}${v.commit !== 'dev' ? ` · ${esc(v.short)}` : ''}</span>`;
  $$('[data-tab="settings"]').forEach((a) => a.classList.toggle('has-update', up));
}
async function drawAbout(refresh) {
  const el = $('#about');
  if (!el) return;
  const v = state.version && !refresh ? state.version : await loadVersion(refresh);
  if (!v || !$('#about')) return;
  const u = v.update || {};
  const built = v.built ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(v.built)) : null;
  const status = {
    current: `<span class="status-dot ok">À jour</span>`,
    available: `<span class="status-dot warn">Mise à jour disponible${u.behind ? ` : ${plural(u.behind, 'modification', 'modifications')}` : ''}</span>`,
    dev: `<span class="status-dot">Version de développement (pas de vérification)</span>`,
    disabled: `<span class="status-dot">Vérification désactivée</span>`,
    unknown: `<span class="status-dot off">Vérification impossible${u.error ? ` : ${esc(u.error)}` : ''}</span>`,
  }[u.status] || '';
  el.innerHTML = `<div class="section-title"><h2>À propos</h2><a href="https://github.com/${esc(v.repo)}/commits/main" target="_blank" rel="noopener">Historique</a></div>
    <div class="rows">
      <div class="row"><div class="txt"><b>Rosée ${esc(v.version)}</b><span>${v.commit === 'dev' ? 'Construite localement' : `Commit ${esc(v.short)}${built ? ` · construite le ${esc(built)}` : ''}`}</span></div></div>
      <div class="row"><div class="txt"><b>Mises à jour</b><span>${status}</span></div>
        ${u.status === 'dev' || u.status === 'disabled' ? '' : `<button class="btn secondary sm" type="button" id="check-update">${icon('refresh')}Vérifier</button>`}</div>
    </div>
    ${u.status === 'available' ? `<div class="update-box">
      ${u.messages?.length ? `<b>Nouveautés</b><ul>${u.messages.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
      <b>Mettre à jour</b>
      <p>Dans Portainer : <b>Stacks → rosee → Pull and redeploy</b>, avec <b>Re-pull image</b> coché. Vos plantes et réglages sont conservés.</p>
    </div>` : ''}`;
  $('#check-update', el)?.addEventListener('click', async (e) => { e.currentTarget.disabled = true; await drawAbout(true); toast(state.version?.update?.status === 'available' ? 'Une mise à jour est disponible' : state.version?.update?.status === 'current' ? 'Rosée est à jour' : 'Vérification impossible'); });
  const qp = new URLSearchParams(location.hash.split('?')[1] || '');
  if (qp.get('section') === 'about') { el.scrollIntoView({ block: 'center' }); history.replaceState(null, '', '#/parametres'); }
}

// ---------- Google Agenda (par compte) ----------
const REMINDER_LABELS = { 0: 'Au moment', 10: '10 min', 30: '30 min', 60: '1 h', 120: '2 h', 180: '3 h', 1440: 'La veille' };
function drawGcal() {
  const el = $('#gcal');
  if (!el || !state.me?.auth) return;
  const c = state.me.calendar;
  if (!c.connected) {
    el.innerHTML = `<div class="gcal-off">
      <p class="muted" style="margin:0 0 10px">Rosée crée un agenda « Rosée — arrosages » dans votre Google Agenda et le tient à jour : un événement par arrosage prévu, avec les alertes de votre choix. Rosée n'a accès qu'à cet agenda, pas à vos autres rendez-vous.</p>
      ${c.last_sync_error ? `<div class="hint" style="margin:0 0 10px">${esc(c.last_sync_error)}</div>` : ''}
      <a class="btn" href="/auth/google/calendar">${icon('calendar')}Connecter Google Agenda</a></div>`;
    return;
  }
  const s = c.settings;
  el.innerHTML = `<div class="rows">
      <div class="row"><div class="txt"><b>Heure des arrosages</b><span>Le jour prévu</span></div>
        <input class="input time-input" type="time" id="g-time" value="${esc(s.time)}" aria-label="Heure de l'événement"></div>
      <div class="row" style="flex-wrap:wrap"><div class="txt"><b>Durée</b></div>
        <div class="seg-sm" role="group" aria-label="Durée">${[15, 30, 60].map((d) => `<button type="button" data-dur="${d}" aria-pressed="${s.duration === d}">${d === 60 ? '1 h' : `${d} min`}</button>`).join('')}</div></div>
      <div class="row col"><div class="txt"><b>Alertes</b><span>Jusqu'à 5, avant l'heure de l'arrosage</span></div>
        <div class="chips wrap" role="group" aria-label="Alertes">${c.choices.map((m) => `<button type="button" class="chip" data-rem="${m}" aria-pressed="${s.reminders.includes(m)}">${REMINDER_LABELS[m] || `${m} min`}</button>`).join('')}</div></div>
      <div class="row" style="flex-wrap:wrap"><div class="txt"><b>Type d'alerte</b></div>
        <div class="seg-sm" role="group" aria-label="Type d'alerte"><button type="button" data-meth="popup" aria-pressed="${s.method === 'popup'}">Notification</button><button type="button" data-meth="email" aria-pressed="${s.method === 'email'}">E-mail</button></div></div>
      <div class="row"><div class="txt"><b>Synchronisation</b><span class="${c.last_sync_error ? 'err' : ''}">${c.last_sync_error ? esc(c.last_sync_error) : c.last_sync_at ? `Agenda à jour (${esc(relAgo(c.last_sync_at.replace(' ', 'T') + 'Z'))})` : 'En attente…'}</span></div>
        <button class="btn secondary sm" type="button" id="g-sync">${icon('refresh')}Maintenant</button></div>
      <div class="row"><div class="txt"><b>Agenda connecté</b><span>${esc(state.me.user.email)}</span></div>
        <button class="btn danger sm" type="button" id="g-off">Déconnecter</button></div>
    </div>`;
  const save = async (patch) => {
    try { state.me = await api('/api/me/calendar', { method: 'PUT', json: { ...state.me.calendar.settings, ...patch } }); drawGcal(); toast('Alertes enregistrées'); }
    catch (e) { toast(e.message); }
  };
  $('#g-time', el).onchange = (e) => save({ time: e.target.value });
  $$('[data-dur]', el).forEach((b) => (b.onclick = () => save({ duration: Number(b.dataset.dur) })));
  $$('[data-meth]', el).forEach((b) => (b.onclick = () => save({ method: b.dataset.meth })));
  $$('[data-rem]', el).forEach((b) => (b.onclick = () => {
    const m = Number(b.dataset.rem);
    const cur = new Set(s.reminders);
    if (cur.has(m)) cur.delete(m); else if (cur.size >= 5) return toast('5 alertes maximum'); else cur.add(m);
    save({ reminders: [...cur] });
  }));
  $('#g-sync', el).onclick = async (e) => {
    e.currentTarget.disabled = true;
    state.me = await api('/api/me/calendar/sync', { method: 'POST' });
    drawGcal();
    toast(state.me.calendar.last_sync_error ? 'Synchronisation impossible' : 'Agenda synchronisé');
  };
  $('#g-off', el).onclick = () => openSheet(`<div class="sheet-inner">
    <div class="sheet-head"><h2 id="sheet-title">Déconnecter Google Agenda ?</h2><button class="icon-btn" type="button" data-close aria-label="Fermer">${icon('close')}</button></div>
    <div class="sheet-body"><p class="muted" style="margin:0">Rosée ne mettra plus votre agenda à jour et son accès sera révoqué.</p>
      <label class="field" style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="del-cal" checked> <span style="margin:0;font-weight:600">Supprimer aussi l'agenda « Rosée — arrosages »</span></label></div>
    <div class="sheet-foot" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <button class="btn secondary" type="button" data-close>Annuler</button>
      <button class="btn solid-danger" type="button" id="g-off-ok">Déconnecter</button></div></div>`, (root) => {
    $$('[data-close]', root).forEach((b) => (b.onclick = () => sheet.close()));
    $('#g-off-ok', root).onclick = async () => {
      state.me = await api('/api/me/calendar/disconnect', { method: 'POST', json: { delete_calendar: $('#del-cal', root).checked } });
      sheet.close(); drawGcal(); toast('Google Agenda déconnecté');
    };
  });
}

// ---------- Écran de connexion ----------
function renderLogin() {
  document.body.classList.add('logged-out');
  const err = new URLSearchParams(location.hash.split('?')[1] || '').get('erreur');
  view.innerHTML = `<div class="login">
    <div class="login-card">
      <span class="logo-mark big">${icon('plants')}</span>
      <h1>Rosée</h1>
      <p class="muted">Vos plantes, leurs arrosages et vos rappels, partagés avec la maison.</p>
      ${err ? `<div class="hint" role="alert">${esc(err)}</div>` : ''}
      <a class="btn block" href="/auth/google/login">${icon('link')}Se connecter avec Google</a>
      <p class="muted small">Seuls les comptes autorisés sur ce serveur peuvent entrer.</p>
    </div></div>`;
}

// ---------- Push ----------
let swReg;
async function currentSubscription() { swReg = swReg || (await navigator.serviceWorker.ready); return swReg.pushManager.getSubscription(); }
function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function subscribe() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications refusées');
  swReg = swReg || (await navigator.serviceWorker.ready);
  const { publicKey } = await api('/api/push/key');
  let sub = await swReg.pushManager.getSubscription();
  if (!sub) sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(publicKey) });
  await api('/api/push/subscribe', { method: 'POST', json: { subscription: sub.toJSON(), label: navigator.userAgent.slice(0, 80) } });
}
async function unsubscribe() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/api/push/unsubscribe', { method: 'POST', json: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}

// ================= FEUILLES =================
function openSheet(html, onReady) {
  sheet.innerHTML = html;
  if (!sheet.open) sheet.showModal();
  sheet.onclick = (e) => { if (e.target === sheet) sheet.close(); };
  $$('[data-close]', sheet).forEach((b) => (b.onclick = () => sheet.close()));
  onReady?.(sheet);
}

let haEntities = null;
async function openPlantForm(p = null, { focusSensors = false } = {}) {
  const editing = !!p;
  const rooms = [...new Set(state.plants.map((x) => x.room).filter(Boolean))];
  const interval = p?.interval_days || 7;
  const presets = [3, 7, 10, 14, 21];
  const haOn = state.settings?.ha_configured;
  if (haOn && !haEntities) { try { haEntities = await api('/api/ha/entities'); } catch { haEntities = []; } }
  const map = p?.sensor_map || {};
  const tg = p?.targets || {};
  const sensorSelect = (m) => {
    const opts = (haEntities || []).filter((e) => e.kind === m || e.entity_id === map[m]);
    return `<label class="sensor-pick"><span class="s-ico" style="color:${{ moisture: 'var(--teal)', temperature: 'var(--red)', illuminance: 'var(--orange)', humidity: 'var(--green-2)' }[m]}">${icon(METRIC[m].icon)}</span>
      <select class="input" name="sensor_${m}" aria-label="${esc(METRIC[m].long)}">
        <option value="">${esc(METRIC[m].long)} : aucun</option>
        ${opts.map((e) => `<option value="${esc(e.entity_id)}" ${map[m] === e.entity_id ? 'selected' : ''}>${esc(e.name)} (${esc(e.state)}${e.unit ? ' ' + esc(e.unit) : ''})</option>`).join('')}
      </select></label>`;
  };

  openSheet(`
    <form method="dialog" id="plant-form" novalidate>
      <div class="sheet-head">
        <h2 id="sheet-title">${editing ? 'Modifier la plante' : 'Ajouter une plante'}</h2>
        <button class="icon-btn" type="button" data-close aria-label="Fermer">${icon('close')}</button>
      </div>
      <div class="progress" aria-hidden="true"><i id="prog"></i></div>
      <div class="sheet-body" id="form-body">
        <div class="form-section">
          <h3>${icon('plants')}Nom et espèce</h3>
          <div class="two">
            <label class="field"><span>Nom</span><input class="input" name="name" required maxlength="80" placeholder="Monstera du salon" value="${esc(p?.name || '')}"></label>
            <label class="field"><span>Espèce</span><input class="input" name="species" maxlength="120" placeholder="Monstera deliciosa" value="${esc(p?.species || '')}"></label>
          </div>
        </div>

        <div class="form-section">
          <h3>${icon('camera')}Photo</h3>
          <label class="photo-pick ${p?.photo_url ? 'has-photo' : ''}" id="pick" style="margin-top:12px">
            ${p?.photo_url ? `<img src="${esc(p.photo_url)}" alt="">` : ''}
            <span class="pick-label">${icon('camera')}<span>${p?.photo_url ? 'Mettre ma photo' : 'Prendre ou choisir ma photo'}</span></span>
            <input type="file" name="photo" accept="image/*" aria-label="Ma photo de la plante">
          </label>
          <div class="photo-meta">
            <span class="credit" id="pick-credit">${p?.photo_credit ? esc(creditText(p.photo_credit)) : ''}</span>
            ${p?.photo_url ? `<button type="button" class="remove-photo" id="rm-photo">Retirer la photo</button>` : ''}
          </div>
          <input type="hidden" name="remove_photo" value="0">
          <input type="hidden" name="ref_photo_url"><input type="hidden" name="ref_photo_attribution">
          <input type="hidden" name="ref_photo_license"><input type="hidden" name="ref_photo_page">

          <div class="refs">
            <div class="refs-head"><b>Photos de l'espèce</b><button type="button" class="link-btn" id="ref-search">${icon('search')}Rechercher</button></div>
            <div class="refs-taxa" id="ref-taxa"></div>
            <div class="refs-strip" id="ref-strip" role="listbox" aria-label="Photos de référence"><span class="refs-msg">${p?.name || p?.species ? 'Recherche…' : 'Saisissez un nom ou une espèce pour voir des photos.'}</span></div>
            <small class="muted">Photos iNaturalist sous licence Creative Commons, auteur cité.${editing ? '' : ' Sans choix de votre part, la première est utilisée.'}</small>
          </div>
        </div>

        <div class="form-section">
          <h3>${icon('pin')}Emplacement</h3>
          <label class="field"><span>Pièce</span><input class="input" name="room" maxlength="60" list="rooms" placeholder="Salon" value="${esc(p?.room || '')}"></label>
          <datalist id="rooms">${rooms.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
          <fieldset class="field"><legend>Lumière reçue</legend>
            <div class="seg">${LIGHTS.map((l) => `<label><input type="radio" name="light" value="${l.v}" ${p?.light === l.v ? 'checked' : ''}><span><i>${Array.from({ length: l.suns }, () => icon('sun')).join('')}</i>${l.label}</span></label>`).join('')}</div>
          </fieldset>
        </div>

        <div class="form-section">
          <h3>${icon('drop')}Arrosage</h3>
          <div class="care-reco" id="care-reco" hidden></div>
          <div class="field"><span id="interval-label">En pleine saison (printemps–été), tous les</span>
            <div class="stepper" role="group" aria-labelledby="interval-label">
              <button type="button" data-step="-1" data-target="summer" aria-label="Un jour de moins">−</button>
              <output id="interval-out" aria-live="polite"><b>${interval}</b><span>${interval > 1 ? 'jours' : 'jour'}</span></output>
              <button type="button" data-step="1" data-target="summer" aria-label="Un jour de plus">+</button>
            </div>
            <input type="hidden" name="interval_days" value="${interval}">
            <div class="presets">${presets.map((n) => `<button type="button" data-preset="${n}" aria-pressed="${n === interval}">${n} j</button>`).join('')}</div>
          </div>
          <div class="field season-row">
            <div><b style="font-size:14px">Adapter à la saison</b><div class="muted" style="font-size:12.5px">Arrosages plus espacés en automne et en hiver</div></div>
            <label class="switch"><input type="checkbox" id="seasonal-toggle" ${p?.seasonal === false ? '' : 'checked'} aria-label="Adapter à la saison"><span></span></label>
          </div>
          <input type="hidden" name="seasonal" value="${p?.seasonal === false ? '0' : '1'}">
          <div class="field" id="winter-field" ${p?.seasonal === false ? 'hidden' : ''}><span id="winter-label">En hiver, tous les</span>
            <div class="stepper" role="group" aria-labelledby="winter-label">
              <button type="button" data-step="-1" data-target="winter" aria-label="Un jour de moins en hiver">−</button>
              <output id="winter-out" aria-live="polite"></output>
              <button type="button" data-step="1" data-target="winter" aria-label="Un jour de plus en hiver">+</button>
            </div>
            <input type="hidden" name="interval_winter" value="${p?.interval_winter ?? ''}">
            <div class="season-bar" id="season-bar" aria-hidden="true"></div>
            <small id="season-now"></small>
          </div>
          ${editing ? '' : `<div class="field" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
            <div><b style="font-size:14px">Arrosée aujourd'hui</b><div class="muted" style="font-size:12.5px">Le compte à rebours démarre maintenant</div></div>
            <label class="switch"><input type="checkbox" name="watered_today" value="1" aria-label="Arrosée aujourd'hui"><span></span></label></div>`}
        </div>

        <div class="form-section" id="sensors-section">
          <h3>${icon('sensor')}Capteurs <span class="muted" style="font-weight:600;font-size:13px">(facultatif)</span></h3>
          ${!haOn ? `<p>Connectez Home Assistant (variables <code>HA_URL</code> et <code>HA_TOKEN</code>) pour associer des capteurs.</p>`
            : !haEntities?.length ? `<p>Aucune entité de capteur trouvée dans Home Assistant.</p>`
            : `<p>Choisissez les entités Home Assistant de cette plante.</p>
              ${Object.keys(METRIC).map(sensorSelect).join('')}
              <div id="targets" style="margin-top:6px">
                <div class="two">
                  <label class="field"><span>Humidité sol min (%)</span><input class="input" name="moisture_min" type="number" min="0" max="100" inputmode="numeric" placeholder="20" value="${tg.moisture_min ?? ''}"></label>
                  <label class="field"><span>Humidité sol max (%)</span><input class="input" name="moisture_max" type="number" min="0" max="100" inputmode="numeric" placeholder="60" value="${tg.moisture_max ?? ''}"></label>
                  <label class="field"><span>Température min (°C)</span><input class="input" name="temp_min" type="number" min="-10" max="50" step="0.5" inputmode="decimal" placeholder="15" value="${tg.temp_min ?? ''}"></label>
                  <label class="field"><span>Température max (°C)</span><input class="input" name="temp_max" type="number" min="-10" max="50" step="0.5" inputmode="decimal" placeholder="28" value="${tg.temp_max ?? ''}"></label>
                </div>
                <small class="muted" style="display:block;margin-top:6px;font-size:12.5px">Champs vides : valeurs par défaut. Le seuil de lumière dépend du niveau choisi plus haut.</small>
              </div>`}
        </div>

        <div class="form-section">
          <h3>${icon('edit')}Notes</h3>
          <label class="field" style="margin-top:8px"><span class="visually-hidden">Notes</span><textarea class="input" name="notes" maxlength="4000" placeholder="Engrais, rempotage, particularités…">${esc(p?.notes || '')}</textarea></label>
        </div>
      </div>
      <div class="sheet-foot"><button class="btn block" type="submit" id="save">${editing ? 'Enregistrer' : 'Ajouter la plante'}</button></div>
    </form>`, (root) => {
    const form = $('#plant-form', root);
    const hidden = form.elements.interval_days;
    const winterInput = form.elements.interval_winter;
    let touched = editing; // en modification, on n'écrase jamais les réglages sans demander
    const winterVal = () => Math.max(Number(hidden.value), Number(winterInput.value) || Math.round(Number(hidden.value) * 1.6));
    const drawSeason = () => {
      const sm = Number(hidden.value), w = winterVal();
      $('#winter-out', root).innerHTML = `<b>${w}</b><span>${w > 1 ? 'jours' : 'jour'}${winterInput.value ? '' : ' · automatique'}</span>`;
      const on = form.elements.seasonal.value === '1';
      const ivs = SEASON_SHARE.map((sh) => (on ? Math.max(1, Math.round(sm + sh * (w - sm))) : sm));
      const max = Math.max(...ivs);
      const m = new Date().getMonth();
      $('#season-bar', root).innerHTML = ivs.map((v, i) => `<span class="${i === m ? 'now' : ''}" style="--h:${(v / max) * 100}%" title="${MONTHS_SHORT[i]} : ${v} j"><i></i><em>${MONTHS_SHORT[i][0]}</em></span>`).join('');
      $('#season-now', root).textContent = on ? `En ${MONTHS_LONG[m]}, Rosée prévoit un arrosage tous les ${ivs[m]} jours.` : '';
    };
    const setIv = (n) => {
      n = Math.max(1, Math.min(120, n));
      hidden.value = n;
      $('#interval-out', root).innerHTML = `<b>${n}</b><span>${n > 1 ? 'jours' : 'jour'}</span>`;
      $$('[data-preset]', root).forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.preset) === n)));
      if (winterInput.value && Number(winterInput.value) < n) winterInput.value = n;
      drawSeason();
    };
    const setWinter = (n) => { winterInput.value = Math.max(Number(hidden.value), Math.min(180, n)); drawSeason(); };
    $$('[data-step]', root).forEach((b) => (b.onclick = () => {
      touched = true;
      if (b.dataset.target === 'winter') setWinter(winterVal() + Number(b.dataset.step));
      else setIv(Number(hidden.value) + Number(b.dataset.step));
    }));
    $$('[data-preset]', root).forEach((b) => (b.onclick = () => { touched = true; setIv(Number(b.dataset.preset)); }));
    $('#seasonal-toggle', root).onchange = (e) => {
      form.elements.seasonal.value = e.target.checked ? '1' : '0';
      $('#winter-field', root).hidden = !e.target.checked;
      drawSeason();
    };
    $$('[name=light]', root).forEach((r) => r.addEventListener('change', () => { touched = true; }));
    drawSeason();

    // Repères d'entretien selon l'espèce
    let careQuery = null;
    const recoEl = $('#care-reco', root);
    const applyCare = (c, quiet) => {
      setIv(c.summer);
      setWinter(c.winter);
      if (!$('#seasonal-toggle', root).checked) { $('#seasonal-toggle', root).checked = true; $('#seasonal-toggle', root).onchange({ target: $('#seasonal-toggle', root) }); }
      const radio = form.querySelector(`[name=light][value="${c.light}"]`);
      if (radio) radio.checked = true;
      for (const [k, v] of [['moisture_min', c.moisture[0]], ['moisture_max', c.moisture[1]], ['temp_min', c.temp[0]], ['temp_max', c.temp[1]]]) if (form.elements[k]) form.elements[k].placeholder = v;
      progress();
      recoEl.querySelector('.reco-apply')?.replaceWith(Object.assign(document.createElement('span'), { className: 'reco-done', textContent: 'Réglages appliqués' }));
      if (!quiet) toast('Réglages recommandés appliqués');
    };
    const loadCare = async () => {
      const q = `${form.elements.species.value.trim()}|${form.elements.name.value.trim()}`;
      if (q === careQuery) return;
      careQuery = q;
      if (q === '|') { recoEl.hidden = true; return; }
      try {
        const { care: c } = await api(`/api/care?species=${encodeURIComponent(form.elements.species.value)}&name=${encodeURIComponent(form.elements.name.value)}`);
        if (!c) { recoEl.hidden = true; return; }
        const same = Number(hidden.value) === c.summer && winterVal() === c.winter && form.querySelector('[name=light]:checked')?.value === c.light;
        recoEl.hidden = false;
        recoEl.innerHTML = `<div class="reco-head">${icon('plants')}<b>Repères pour ${esc(c.label)}</b>${c.match === 'genus' ? '<span class="muted">(genre)</span>' : ''}</div>
          <div class="reco-facts">
            <span>${icon('drop')}Été : ${c.summer} j · hiver : ${c.winter} j</span>
            <span>${icon('sun')}${esc(lightLabel(c.light))}</span>
            <span>${icon('thermo')}${c.temp[0]}–${c.temp[1]} °C</span>
            ${c.water ? `<span>${icon('drop')}${esc(c.water.short)}</span>` : ''}
          </div>
          ${same ? '<span class="reco-done">Réglages appliqués</span>' : '<button type="button" class="btn sm reco-apply">Appliquer ces réglages</button>'}`;
        recoEl.querySelector('.reco-apply')?.addEventListener('click', () => { touched = true; applyCare(c); });
        if (!touched) applyCare(c, true);
      } catch { recoEl.hidden = true; }
    };
    for (const n of ['name', 'species']) form.elements[n].addEventListener('change', loadCare);

    // Barre de progression : complétude de la fiche
    const progress = () => {
      const f = form.elements;
      const parts = [!!(f.photo.files.length || $('#pick img', root)), !!f.name.value.trim(), !!f.species.value.trim(), !!f.room.value.trim(), !!form.querySelector('[name=light]:checked')];
      $('#prog', root).style.width = `${(parts.filter(Boolean).length / parts.length) * 100}%`;
    };
    form.addEventListener('input', progress);
    form.addEventListener('change', progress);
    progress();

    const fileInput = form.elements.photo;
    const pick = $('#pick', root);
    const creditEl = $('#pick-credit', root);
    const setRef = (ph) => {
      form.elements.ref_photo_url.value = ph?.url || '';
      form.elements.ref_photo_attribution.value = ph?.attribution || '';
      form.elements.ref_photo_license.value = ph?.license || '';
      form.elements.ref_photo_page.value = ph?.page || '';
    };
    const showPreview = (src) => {
      pick.querySelector('img')?.remove();
      if (src) { const img = new Image(); img.alt = ''; img.src = src; pick.prepend(img); }
      pick.classList.toggle('has-photo', !!src);
      pick.querySelector('.pick-label span').textContent = src ? 'Mettre ma photo' : 'Prendre ou choisir ma photo';
      progress();
    };
    const unselectRefs = () => $$('#ref-strip button', root).forEach((x) => x.setAttribute('aria-selected', 'false'));

    fileInput.onchange = () => {
      const f = fileInput.files[0];
      if (!f) return;
      setRef(null); unselectRefs();
      showPreview(URL.createObjectURL(f));
      creditEl.textContent = '';
      form.elements.remove_photo.value = '0';
    };
    $('#rm-photo', root)?.addEventListener('click', (e) => {
      form.elements.remove_photo.value = '1';
      fileInput.value = ''; setRef(null); unselectRefs();
      showPreview(null);
      creditEl.textContent = '';
      e.currentTarget.remove();
    });

    // Photos de référence (iNaturalist)
    let lastQuery = null, photos = [];
    const strip = $('#ref-strip', root), taxaEl = $('#ref-taxa', root);
    const loadRefs = async ({ q, taxonId } = {}) => {
      const query = q ?? (form.elements.species.value.trim() || form.elements.name.value.trim());
      if (!taxonId) {
        if (query.length < 2) { strip.innerHTML = `<span class="refs-msg">Saisissez un nom ou une espèce pour voir des photos.</span>`; taxaEl.innerHTML = ''; lastQuery = null; return; }
        if (query === lastQuery) return;
        lastQuery = query;
      }
      strip.innerHTML = `<span class="refs-msg">Recherche…</span>`;
      try {
        const r = await api(`/api/photo-search?${taxonId ? `taxon_id=${taxonId}` : `q=${encodeURIComponent(query)}`}`);
        if (r.taxa?.length) {
          taxaEl.innerHTML = r.taxa.map((t, i) => `<button type="button" class="chip" data-taxon="${t.id}" data-name="${esc(t.name)}" aria-pressed="${i === 0}">${t.common ? `${esc(cap(t.common))} · ` : ''}<i>${esc(t.name)}</i></button>`).join('');
          $$('[data-taxon]', taxaEl).forEach((b) => (b.onclick = () => {
            $$('[data-taxon]', taxaEl).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
            loadRefs({ taxonId: b.dataset.taxon });
          }));
        } else if (!taxonId) taxaEl.innerHTML = '';
        photos = r.photos || [];
        if (!photos.length) { strip.innerHTML = `<span class="refs-msg">Aucune photo libre trouvée${query && !taxonId ? ` pour « ${esc(query)} »` : ''}. Essayez le nom scientifique.</span>`; return; }
        strip.innerHTML = photos.map((ph, i) => `<button type="button" role="option" aria-selected="${form.elements.ref_photo_url.value === ph.url}" data-i="${i}" title="${esc(ph.attribution)}"><img src="${esc(ph.thumb)}" alt="Photo ${i + 1} de ${esc(ph.taxon || '')}" loading="lazy"></button>`).join('');
        $$('button', strip).forEach((b) => (b.onclick = () => {
          const ph = photos[Number(b.dataset.i)];
          fileInput.value = '';
          setRef(ph);
          form.elements.remove_photo.value = '0';
          showPreview(ph.preview);
          creditEl.textContent = creditText(ph);
          unselectRefs(); b.setAttribute('aria-selected', 'true');
          if (!form.elements.species.value.trim() && ph.taxon) { form.elements.species.value = ph.taxon; lastQuery = ph.taxon; progress(); loadCare(); }
        }));
      } catch (err) {
        strip.innerHTML = `<span class="refs-msg">${esc(err.message)}</span>`;
        lastQuery = null;
      }
    };
    $('#ref-search', root).onclick = () => { lastQuery = null; loadRefs(); };
    let refTimer;
    for (const n of ['name', 'species']) form.elements[n].addEventListener('change', () => { clearTimeout(refTimer); refTimer = setTimeout(() => loadRefs(), 300); });
    if (form.elements.name.value.trim() || form.elements.species.value.trim()) { loadRefs(); loadCare(); }

    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!form.elements.name.value.trim()) { form.elements.name.focus(); toast('Donnez un nom à la plante'); return; }
      const btn = $('#save', root);
      btn.disabled = true; btn.textContent = 'Enregistrement…';
      try {
        const fd = new FormData(form);
        if (!fileInput.files.length) fd.delete('photo');
        if (!fd.get('ref_photo_url')) ['ref_photo_url', 'ref_photo_attribution', 'ref_photo_license', 'ref_photo_page'].forEach((k) => fd.delete(k));
        const saved = await api(editing ? `/api/plants/${p.id}` : '/api/plants', { method: editing ? 'PUT' : 'POST', body: fd });
        await loadPlants();
        sheet.close();
        toast(editing ? 'Modifications enregistrées' : `${saved.name} ajoutée`);
        if (editing) renderDetail(p.id); else location.hash = `#/plante/${saved.id}`;
      } catch (err) {
        toast(err.message);
        btn.disabled = false; btn.textContent = editing ? 'Enregistrer' : 'Ajouter la plante';
      }
    };
    if (focusSensors) setTimeout(() => $('#sensors-section', root)?.scrollIntoView({ block: 'start' }), 60);
    else if (!editing) setTimeout(() => form.elements.name.focus(), 60);
  });
}

function openWaterDate(p) {
  const iso = (d) => dayKey(d);
  openSheet(`<form method="dialog" id="date-form">
    <div class="sheet-head"><h2 id="sheet-title">Arrosée un autre jour</h2><button class="icon-btn" type="button" data-close aria-label="Fermer">${icon('close')}</button></div>
    <div class="sheet-body">
      <label class="field" style="margin-top:0"><span>Date de l'arrosage de ${esc(p.name)}</span>
        <input class="input" type="date" name="d" value="${iso(addDays(new Date(), -1))}" max="${iso(new Date())}" required></label>
      <small class="muted" style="font-size:12.5px">Pratique si vous avez oublié de le noter.</small>
    </div>
    <div class="sheet-foot"><button class="btn block" type="submit">${icon('drop')}Enregistrer l'arrosage</button></div>
  </form>`, (root) => {
    $('#date-form', root).onsubmit = async (e) => {
      e.preventDefault();
      const v = e.target.elements.d.value;
      if (!v) return;
      const at = new Date(`${v}T12:00:00`);
      if (at > new Date()) at.setTime(Date.now());
      await water(p, { at: at.toISOString(), quiet: true });
      sheet.close();
      toast(`Arrosage du ${fmtDM.format(at)} enregistré`);
      render();
    };
  });
}

function confirmDelete(p) {
  openSheet(`<div class="sheet-inner">
    <div class="sheet-head"><h2 id="sheet-title">Supprimer ${esc(p.name)} ?</h2><button class="icon-btn" type="button" data-close aria-label="Fermer">${icon('close')}</button></div>
    <div class="sheet-body"><p class="muted" style="margin:0">La fiche, la photo et l'historique d'arrosage seront définitivement effacés. Les capteurs restent dans Home Assistant.</p></div>
    <div class="sheet-foot" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <button class="btn secondary" type="button" data-close>Garder</button>
      <button class="btn solid-danger" type="button" id="confirm-del">Supprimer</button>
    </div></div>`, (root) => {
    $$('[data-close]', root).forEach((b) => (b.onclick = () => sheet.close()));
    $('#confirm-del', root).onclick = async () => {
      await api(`/api/plants/${p.id}`, { method: 'DELETE' });
      await loadPlants();
      sheet.close();
      toast(`${p.name} supprimée`);
      plantQuery = ''; plantFilter = 'all';
      location.hash = '#/plantes';
    };
  });
}

// ================= ROUTEUR =================
function bindAdd() { $$('[data-add]').forEach((b) => (b.onclick = () => openPlantForm())); }
function currentRoute() {
  const h = location.hash || '#/';
  if (/^#\/plante\/\d+/.test(h)) return 'detail';
  if (h.startsWith('#/plantes')) return 'plants';
  if (h.startsWith('#/calendrier')) return 'calendar';
  if (h.startsWith('#/capteurs')) return 'sensors';
  if (h.startsWith('#/parametres')) return 'settings';
  if (h.startsWith('#/connexion')) return 'login';
  return 'home';
}
async function render() {
  document.body.classList.remove('logged-out');
  view.classList.remove('flush-top');
  const h = location.hash || '#/';
  const params = new URLSearchParams(h.split('?')[1] || '');
  const r = currentRoute();
  if (r === 'detail') await renderDetail(h.match(/^#\/plante\/(\d+)/)[1]);
  else if (r === 'plants') renderPlants(params);
  else if (r === 'calendar') await renderCalendar();
  else if (r === 'sensors') await renderSensors();
  else if (r === 'settings') await renderSettings();
  else if (r === 'login') {
    if (state.me?.auth === false || (state.me?.auth && state.me.user)) { location.hash = '#/'; return; }
    renderLogin(); return;
  }
  else await renderHome();
  bindAdd();
}

window.addEventListener('hashchange', async () => {
  if (sheet.open) sheet.close();
  if (!state.me && currentRoute() !== 'login') { location.reload(); return; }
  await render();
  window.scrollTo(0, 0);
});
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && !sheet.open) { await loadPlants(); render(); }
});
$('#global-q').addEventListener('input', (e) => {
  plantQuery = e.target.value;
  if (currentRoute() !== 'plants') location.hash = '#/plantes';
  else window.__drawPlants?.();
});

(async function init() {
  view.innerHTML = `<div class="skeleton">Chargement…</div>`;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then((r) => (swReg = r)).catch(() => {});
  try {
    try { state.me = await api('/api/me'); }
    catch (e) {
      if (e.status === 401) { state.me = null; if (currentRoute() !== 'login') location.replace('#/connexion'); renderLogin(); return; }
      throw e;
    }
    await Promise.all([loadPlants(), loadSettings()]);
    await render();
    api('/api/ha/status').then(updateSideHA).catch(() => {});
    loadVersion();
  } catch {
    view.innerHTML = `<div class="card empty"><h2>Serveur injoignable</h2><p>Vérifiez que vous êtes sur le réseau de la maison ou connecté au VPN, puis réessayez.</p><button class="btn" type="button" id="retry">Réessayer</button></div>`;
    $('#retry').addEventListener('click', () => location.reload());
  }
})();
