// Rosée — soins autres que l'arrosage : engrais, rempotage, taille, rotation.
// Chaque soin a un rythme et, souvent, une saison (mois où il a du sens). Les calculs se font
// sur des clés de jour « AAAA-MM-JJ » dans le fuseau local, pour éviter les surprises d'heure d'été.

const DAY = 86400000;
// Mois indexés de 0 (janvier) à 11, hémisphère nord
export const CARE_TYPES = {
  engrais: {
    label: 'Engrais', verb: 'Donner de l’engrais', short: 'Engrais', emoji: '🌱', season: [2, 3, 4, 5, 6, 7, 8], defaultOn: true,
    help: 'Engrais liquide pour plantes vertes, dilué selon l’étiquette, versé sur une terre déjà humide. Pas d’engrais d’octobre à février : la plante se repose.',
  },
  rempotage: {
    label: 'Rempotage', verb: 'Vérifier s’il faut rempoter', short: 'Rempotage', emoji: '🪴', season: [2, 3, 4], defaultOn: false,
    help: 'À rempoter si les racines sortent par les trous, si l’eau traverse le pot sans être retenue, si la terre se décolle des bords ou si la plante ne pousse plus au printemps. Sinon, pas besoin : remplacer les 2–3 cm de terre du dessus suffit. Choisir un pot à peine plus grand (2–4 cm de plus), percé.',
  },
  taille: {
    label: 'Taille', verb: 'Tailler', short: 'Taille', emoji: '✂️', season: [2, 3, 4, 5], defaultOn: false, every: 365,
    help: 'Couper les feuilles jaunies ou abîmées à la base, et les tiges trop longues juste au-dessus d’un nœud. Les tiges coupées se bouturent souvent dans l’eau.',
  },
  rotation: {
    label: 'Rotation', verb: 'Tourner le pot d’un quart de tour', short: 'Rotation', emoji: '🔄', season: null, defaultOn: false, every: 14,
    help: 'Un quart de tour régulier évite que la plante penche vers la fenêtre et garde un port équilibré.',
  },
};
export const CARE_KEYS = Object.keys(CARE_TYPES);

const keyDate = (k) => new Date(`${k}T12:00:00Z`);
export const addKey = (k, n) => { const d = keyDate(k); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const diffKeys = (a, b) => Math.round((keyDate(b) - keyDate(a)) / DAY);
const monthOf = (k, south) => { const m = Number(k.slice(5, 7)) - 1; return south ? (m + 6) % 12 : m; };

// Premier jour de saison à partir de k (k lui-même s'il est déjà en saison)
function intoSeason(k, season, south) {
  if (!season) return k;
  let cur = k;
  for (let i = 0; i < 13; i++) {
    if (season.includes(monthOf(cur, south))) return cur;
    cur = `${addKey(`${cur.slice(0, 8)}01`, 32).slice(0, 8)}01`; // 1er du mois suivant
  }
  return k;
}

// Réglages effectifs d'un soin pour une plante (préférences de l'utilisateur > repères de l'espèce > défaut)
export function careSettings(stored = {}, profile = null) {
  const out = {};
  for (const t of CARE_KEYS) {
    const s = stored[t] || {};
    const def = CARE_TYPES[t];
    let every = def.every;
    if (t === 'engrais') every = profile?.fert || 21;
    if (t === 'rempotage') every = (profile?.repot || 2) * 365;
    const userEvery = Number(s.every);
    out[t] = {
      on: typeof s.on === 'boolean' ? s.on : def.defaultOn,
      every: Number.isFinite(userEvery) && userEvery >= 1 ? Math.min(t === 'rempotage' ? 365 * 5 : 365, Math.round(userEvery)) : every,
      custom: Number.isFinite(userEvery) && userEvery >= 1,
    };
  }
  return out;
}

// État de chaque soin : prochaine date, retard, dates à venir sur l'horizon
// created : jour d'arrivée de la plante, point de départ du premier engrais (les plantes achetées en sont souvent pourvues)
export function careStatus({ settings, last, today, created = null, south = false, horizon = 70 }) {
  const out = [];
  for (const t of CARE_KEYS) {
    const def = CARE_TYPES[t];
    const s = settings[t];
    const l = last[t]; // { key, note } du dernier soin
    // Après un « pas besoin cette année », le rempotage est revu dans un an seulement
    const step = t === 'rempotage' && l?.note === 'skip' ? 365 : s.every;
    const base = l ? addKey(l.key, step) : (t === 'engrais' && created ? addKey(created, step) : today);
    let next = intoSeason(base < today && !l ? today : base, def.season, south);
    // Une échéance passée hors saison n'est pas « en retard » : elle attend la saison
    if (next < today && def.season && !def.season.includes(monthOf(today, south))) next = intoSeason(today, def.season, south);
    const dates = [];
    if (s.on) {
      let d = next < today ? today : next;
      for (let i = 0; i < 40 && diffKeys(today, d) <= horizon; i++) {
        dates.push(d);
        d = intoSeason(addKey(d, s.every), def.season, south);
      }
    }
    out.push({
      type: t,
      label: def.label,
      verb: def.verb,
      emoji: def.emoji,
      help: def.help,
      on: s.on,
      every: s.every,
      custom: s.custom,
      last_at: l?.at || null,
      last_note: l?.note || null,
      next,
      days_left: diffKeys(today, next),
      in_season: !def.season || def.season.includes(monthOf(today, south)),
      season: def.season,
      months: def.season ? def.season.map((m) => (south ? (m + 6) % 12 : m)) : null, // mois réels de la saison
      dates,
    });
  }
  return out;
}
