// Rosée — repères d'entretien par espèce ou par genre.
// Valeurs indicatives pour une culture en intérieur sous climat tempéré :
//   summer / winter : jours entre deux arrosages en pleine saison / au repos hivernal
//   light : ombre | mi-ombre | lumineux | soleil
//   temp : [min, max] °C   moisture : [min, max] % d'humidité du sol (capteurs)   humidity : humidité de l'air minimale (%)
// La correspondance se fait sur l'espèce exacte, puis sur le genre, puis sur un nom commun.

const C = (o) => o;

export const CARE = [
  // ---- Aracées et feuillages tropicaux
  C({ keys: ['monstera deliciosa', 'monstera'], label: 'Monstera', water: 'copieux', dry: 'tiers', names: ['monstera', 'faux philodendron'], summer: 7, winter: 12, light: 'lumineux', temp: [18, 27], moisture: [30, 60], humidity: 50,
    tips: ['Arroser quand les 3 premiers centimètres de terre sont secs.', 'Lumière vive mais sans soleil direct de midi.', 'Engrais tous les 15 jours au printemps et en été.'] }),
  C({ keys: ['epipremnum aureum', 'epipremnum'], label: 'Pothos', water: 'copieux', dry: 'moitie', names: ['pothos', 'scindapsus'], summer: 7, winter: 12, light: 'mi-ombre', temp: [16, 27], moisture: [25, 60], humidity: 40,
    tips: ['Laisser sécher la moitié supérieure du pot entre deux arrosages.', 'Supporte la mi-ombre, panache moins marqué si trop sombre.', 'Tailler les tiges trop longues pour densifier.'] }),
  C({ keys: ['philodendron'], label: 'Philodendron', water: 'copieux', dry: 'tiers', names: ['philodendron'], summer: 7, winter: 12, light: 'lumineux', temp: [16, 27], moisture: [30, 60], humidity: 50,
    tips: ['Arroser quand le dessus de la terre est sec.', 'Lumière vive indirecte.', 'Apprécie un tuteur pour les espèces grimpantes.'] }),
  C({ keys: ['zamioculcas zamiifolia', 'zamioculcas'], label: 'Zamioculcas', water: 'copieux', dry: 'sec', names: ['zz', 'zamioculcas'], summer: 14, winter: 30, light: 'mi-ombre', temp: [15, 28], moisture: [10, 40], humidity: 30,
    tips: ['Laisser sécher complètement la terre : les rhizomes stockent l’eau.', 'Très tolérant à la faible lumière.', 'L’excès d’eau est la première cause de perte.'] }),
  C({ keys: ['spathiphyllum'], label: 'Spathiphyllum', water: 'copieux', dry: 'dessus', names: ['fleur de lune', 'spathiphyllum'], summer: 5, winter: 8, light: 'mi-ombre', temp: [16, 26], moisture: [40, 70], humidity: 50,
    tips: ['Garder la terre légèrement humide.', 'Les feuilles tombantes signalent la soif.', 'Pas de soleil direct.'] }),
  C({ keys: ['aglaonema'], label: 'Aglaonema', water: 'copieux', dry: 'tiers', names: ['aglaonema'], summer: 7, winter: 12, light: 'mi-ombre', temp: [18, 27], moisture: [30, 60], humidity: 50,
    tips: ['Laisser sécher le dessus de la terre.', 'Craint le froid sous 15 °C.', 'Supporte une lumière modérée.'] }),
  C({ keys: ['dieffenbachia'], label: 'Dieffenbachia', water: 'copieux', dry: 'tiers', names: ['dieffenbachia'], summer: 6, winter: 10, light: 'mi-ombre', temp: [18, 27], moisture: [35, 65], humidity: 50,
    tips: ['Terre légèrement humide en été, plus sèche en hiver.', 'Sève irritante : porter des gants pour tailler.', 'Tourner le pot pour une pousse régulière.'] }),
  C({ keys: ['alocasia'], label: 'Alocasia', water: 'modere', dry: 'dessus', names: ['alocasia', 'oreille d’éléphant'], summer: 5, winter: 9, light: 'lumineux', temp: [18, 28], moisture: [40, 70], humidity: 60,
    tips: ['Terre fraîche mais jamais détrempée.', 'Aime l’air humide : éviter les radiateurs.', 'Peut perdre ses feuilles en hiver puis repartir.'] }),
  C({ keys: ['anthurium'], label: 'Anthurium', water: 'modere', dry: 'tiers', names: ['anthurium'], summer: 6, winter: 10, light: 'lumineux', temp: [18, 27], moisture: [35, 65], humidity: 60,
    tips: ['Arroser quand le dessus sèche, eau non calcaire.', 'Lumière vive sans soleil direct pour fleurir.', 'Brumiser les feuilles en air sec.'] }),
  C({ keys: ['syngonium'], label: 'Syngonium', water: 'copieux', dry: 'tiers', names: ['syngonium'], summer: 6, winter: 10, light: 'mi-ombre', temp: [16, 27], moisture: [35, 65], humidity: 50,
    tips: ['Terre légèrement humide.', 'Pincer les tiges pour un port compact.', 'Lumière indirecte.'] }),

  // ---- Marantacées (calatheas)
  C({ keys: ['goeppertia', 'calathea', 'maranta', 'ctenanthe', 'stromanthe'], label: 'Calathea / Maranta', water: 'modere', dry: 'dessus', names: ['calathea', 'maranta', 'plante qui prie'], summer: 4, winter: 7, light: 'mi-ombre', temp: [18, 27], moisture: [45, 75], humidity: 60,
    tips: ['Garder la terre toujours légèrement humide.', 'Eau douce ou de pluie : sensible au calcaire et au chlore.', 'Air humide indispensable : plateau de billes d’argile mouillées.'] }),

  // ---- Ficus
  C({ keys: ['ficus elastica'], label: 'Caoutchouc', water: 'copieux', dry: 'tiers', names: ['caoutchouc', 'ficus elastica'], summer: 8, winter: 14, light: 'lumineux', temp: [16, 27], moisture: [25, 55], humidity: 40,
    tips: ['Laisser sécher le dessus entre deux arrosages.', 'Dépoussiérer les feuilles avec un chiffon humide.', 'Lumière vive, quelques heures de soleil doux possibles.'] }),
  C({ keys: ['ficus lyrata'], label: 'Ficus lyrata', water: 'copieux', dry: 'tiers', names: ['ficus lyrata', 'figuier lyre'], summer: 7, winter: 12, light: 'lumineux', temp: [16, 27], moisture: [30, 60], humidity: 45,
    tips: ['Arroser abondamment puis laisser sécher les premiers centimètres.', 'N’aime pas être déplacé.', 'Beaucoup de lumière indirecte.'] }),
  C({ keys: ['ficus benjamina'], label: 'Ficus benjamina', water: 'copieux', dry: 'tiers', names: ['ficus benjamina', 'figuier pleureur'], summer: 6, winter: 10, light: 'lumineux', temp: [16, 26], moisture: [30, 60], humidity: 45,
    tips: ['Perd ses feuilles en cas de changement de place ou de courant d’air.', 'Terre légèrement humide en été.', 'Lumière vive.'] }),
  C({ keys: ['ficus'], label: 'Ficus', water: 'copieux', dry: 'tiers', names: ['ficus'], summer: 7, winter: 12, light: 'lumineux', temp: [16, 27], moisture: [30, 60], humidity: 45,
    tips: ['Laisser sécher le dessus de la terre.', 'Lumière vive indirecte.', 'Éviter les courants d’air.'] }),

  // ---- Succulentes et cactus
  C({ keys: ['aloe vera', 'aloe'], label: 'Aloe', water: 'copieux', dry: 'sec', names: ['aloe', 'aloès'], summer: 14, winter: 30, light: 'soleil', temp: [10, 30], moisture: [5, 30], humidity: 20,
    tips: ['Laisser sécher complètement la terre entre deux arrosages.', 'Plein soleil ou très lumineux.', 'Terreau drainant pour cactées.'] }),
  C({ keys: ['dracaena trifasciata', 'sansevieria'], label: 'Sansevieria', water: 'copieux', dry: 'sec', names: ['sansevieria', 'langue de belle-mère'], summer: 14, winter: 30, light: 'mi-ombre', temp: [12, 30], moisture: [5, 30], humidity: 20,
    tips: ['Arroser seulement quand la terre est totalement sèche.', 'Ne pas mouiller le cœur de la rosette.', 'Tolère l’ombre comme le soleil.'] }),
  C({ keys: ['crassula ovata', 'crassula'], label: 'Crassula', water: 'copieux', dry: 'sec', names: ['arbre de jade', 'crassula'], summer: 12, winter: 25, light: 'soleil', temp: [10, 28], moisture: [5, 30], humidity: 20,
    tips: ['Terre sèche entre deux arrosages.', 'Plein soleil pour des feuilles bien rouges sur les bords.', 'Hiver frais et presque sec favorise la floraison.'] }),
  C({ keys: ['echeveria', 'sedum', 'graptopetalum', 'pachyphytum', 'kalanchoe'], label: 'Succulente', water: 'copieux', dry: 'sec', names: ['succulente', 'plante grasse'], summer: 10, winter: 25, light: 'soleil', temp: [8, 30], moisture: [5, 30], humidity: 20,
    tips: ['Arroser par trempage puis laisser sécher complètement.', 'Le maximum de lumière.', 'Éviter l’eau stagnante dans la soucoupe.'] }),
  C({ keys: ['haworthiopsis', 'haworthia', 'gasteria'], label: 'Haworthia', water: 'copieux', dry: 'sec', names: ['haworthia'], summer: 12, winter: 25, light: 'lumineux', temp: [10, 28], moisture: [5, 30], humidity: 20,
    tips: ['Terre sèche entre deux arrosages.', 'Lumière vive sans soleil brûlant.', 'Terreau très drainant.'] }),
  C({ keys: ['curio rowleyanus', 'senecio rowleyanus', 'curio'], label: 'Plante chapelet', water: 'modere', dry: 'moitie', names: ['plante chapelet', 'senecio'], summer: 10, winter: 20, light: 'lumineux', temp: [10, 27], moisture: [10, 35], humidity: 25,
    tips: ['Laisser sécher entre deux arrosages.', 'Les perles fripées signalent la soif.', 'Lumière vive.'] }),
  C({ keys: ['cactaceae', 'mammillaria', 'echinocactus', 'opuntia', 'cereus', 'echinopsis', 'gymnocalycium', 'astrophytum', 'schlumbergera'], label: 'Cactus', water: 'copieux', dry: 'sec', names: ['cactus'], summer: 14, winter: 40, light: 'soleil', temp: [5, 32], moisture: [5, 25], humidity: 15,
    tips: ['Arroser rarement mais abondamment en saison.', 'Presque aucun arrosage en hiver, au frais.', 'Plein soleil.'] }),

  // ---- Dracaenas, palmiers et arbustes
  C({ keys: ['dracaena'], label: 'Dracaena', water: 'copieux', dry: 'moitie', names: ['dragonnier', 'dracaena'], summer: 10, winter: 18, light: 'mi-ombre', temp: [16, 27], moisture: [20, 50], humidity: 40,
    tips: ['Laisser sécher la moitié de la terre.', 'Sensible au fluor : eau reposée ou filtrée.', 'Pointes brunes = air trop sec ou excès d’eau.'] }),
  C({ keys: ['chamaedorea elegans', 'chamaedorea'], label: 'Palmier nain', water: 'copieux', dry: 'dessus', names: ['palmier nain', 'chamaedorea'], summer: 6, winter: 10, light: 'mi-ombre', temp: [16, 26], moisture: [35, 65], humidity: 50,
    tips: ['Terre légèrement humide.', 'Tolère la mi-ombre.', 'Brumiser en air sec.'] }),
  C({ keys: ['dypsis lutescens', 'dypsis', 'howea', 'livistona', 'phoenix', 'rhapis'], label: 'Palmier', water: 'copieux', dry: 'tiers', names: ['areca', 'palmier', 'kentia'], summer: 6, winter: 12, light: 'lumineux', temp: [16, 27], moisture: [30, 60], humidity: 50,
    tips: ['Arroser quand le dessus sèche.', 'Beaucoup de lumière indirecte.', 'Couper les palmes sèches à la base.'] }),
  C({ keys: ['strelitzia'], label: 'Strelitzia', water: 'copieux', dry: 'tiers', names: ['oiseau de paradis', 'strelitzia'], summer: 6, winter: 12, light: 'soleil', temp: [15, 28], moisture: [30, 60], humidity: 45,
    tips: ['Arroser généreusement en été, peu en hiver.', 'Plein soleil pour fleurir.', 'Feuilles fendues : normal.'] }),
  C({ keys: ['schefflera', 'heptapleurum'], label: 'Schefflera', water: 'copieux', dry: 'tiers', names: ['schefflera', 'arbre ombrelle'], summer: 7, winter: 14, light: 'lumineux', temp: [15, 27], moisture: [25, 55], humidity: 40,
    tips: ['Laisser sécher le dessus.', 'Lumière vive indirecte.', 'Tailler pour garder une forme compacte.'] }),
  C({ keys: ['yucca', 'beaucarnea'], label: 'Yucca / Beaucarnea', water: 'copieux', dry: 'sec', names: ['yucca', 'pied d’éléphant'], summer: 12, winter: 25, light: 'soleil', temp: [10, 30], moisture: [10, 35], humidity: 25,
    tips: ['Terre sèche entre deux arrosages.', 'Le plus de lumière possible.', 'Craint surtout l’excès d’eau.'] }),
  C({ keys: ['citrus'], label: 'Agrume', water: 'copieux', dry: 'tiers', names: ['citronnier', 'oranger', 'agrume', 'calamondin'], summer: 4, winter: 10, light: 'soleil', temp: [8, 30], moisture: [35, 65], humidity: 50,
    tips: ['Arroser quand le dessus sèche, eau non calcaire.', 'Hiver lumineux et frais (10–15 °C).', 'Engrais spécial agrumes en saison.'] }),
  C({ keys: ['olea europaea'], label: 'Olivier', water: 'copieux', dry: 'moitie', names: ['olivier'], summer: 5, winter: 14, light: 'soleil', temp: [0, 35], moisture: [20, 50], humidity: 30,
    tips: ['En pot, arroser dès que le dessus est sec en été.', 'Plein soleil.', 'Hiver au frais, arrosages espacés.'] }),
  C({ keys: ['coffea arabica', 'coffea'], label: 'Caféier', water: 'modere', dry: 'dessus', names: ['caféier'], summer: 5, winter: 9, light: 'lumineux', temp: [16, 27], moisture: [40, 70], humidity: 55,
    tips: ['Terre fraîche en permanence en été.', 'Lumière vive sans soleil direct.', 'Air humide.'] }),

  // ---- Fougères, plantes retombantes, petites plantes
  C({ keys: ['nephrolepis', 'asplenium', 'adiantum', 'davallia', 'platycerium', 'pteris'], label: 'Fougère', water: 'modere', dry: 'dessus', names: ['fougère'], summer: 3, winter: 6, light: 'mi-ombre', temp: [16, 26], moisture: [50, 80], humidity: 60,
    tips: ['Terre toujours humide, jamais détrempée.', 'Air humide : idéale en salle de bain lumineuse.', 'Pas de soleil direct.'] }),
  C({ keys: ['chlorophytum comosum', 'chlorophytum'], label: 'Plante araignée', water: 'copieux', dry: 'tiers', names: ['plante araignée', 'chlorophytum', 'phalangère'], summer: 6, winter: 12, light: 'mi-ombre', temp: [12, 27], moisture: [30, 60], humidity: 40,
    tips: ['Arroser quand le dessus est sec.', 'Les rejets se bouturent facilement dans l’eau.', 'Pointes brunes : eau calcaire ou air sec.'] }),
  C({ keys: ['tradescantia'], label: 'Tradescantia', water: 'modere', dry: 'dessus', names: ['misère', 'tradescantia'], summer: 5, winter: 10, light: 'lumineux', temp: [12, 27], moisture: [35, 65], humidity: 40,
    tips: ['Terre légèrement humide.', 'Lumière vive pour garder les couleurs.', 'Pincer régulièrement.'] }),
  C({ keys: ['hoya'], label: 'Hoya', water: 'copieux', dry: 'moitie', names: ['fleur de porcelaine', 'hoya'], summer: 8, winter: 16, light: 'lumineux', temp: [15, 27], moisture: [20, 50], humidity: 45,
    tips: ['Laisser sécher entre deux arrosages.', 'Ne pas couper les tiges florales.', 'Lumière vive pour fleurir.'] }),
  C({ keys: ['peperomia'], label: 'Peperomia', water: 'modere', dry: 'moitie', names: ['peperomia'], summer: 8, winter: 14, light: 'mi-ombre', temp: [16, 27], moisture: [20, 50], humidity: 40,
    tips: ['Feuilles charnues : laisser sécher la terre.', 'Lumière indirecte.', 'Petit pot, terreau léger.'] }),
  C({ keys: ['pilea peperomioides', 'pilea'], label: 'Pilea', water: 'copieux', dry: 'tiers', names: ['plante à monnaie', 'pilea'], summer: 7, winter: 12, light: 'lumineux', temp: [15, 26], moisture: [30, 60], humidity: 40,
    tips: ['Arroser quand le dessus sèche.', 'Tourner le pot chaque semaine.', 'Lumière vive sans soleil fort.'] }),
  C({ keys: ['begonia'], label: 'Bégonia', water: 'modere', dry: 'tiers', names: ['bégonia'], summer: 5, winter: 9, light: 'lumineux', temp: [16, 26], moisture: [35, 65], humidity: 50,
    tips: ['Arroser par le dessous ou au pied, sans mouiller les feuilles.', 'Lumière vive indirecte.', 'Craint l’excès d’eau.'] }),
  C({ keys: ['saintpaulia', 'streptocarpus'], label: 'Violette africaine', water: 'dessous', dry: 'dessus', names: ['violette africaine', 'saintpaulia'], summer: 5, winter: 8, light: 'lumineux', temp: [18, 26], moisture: [35, 65], humidity: 50,
    tips: ['Arroser par la soucoupe avec une eau tiède.', 'Ne pas mouiller les feuilles.', 'Lumière vive sans soleil direct.'] }),
  C({ keys: ['phalaenopsis', 'orchidaceae', 'cattleya', 'dendrobium', 'oncidium'], label: 'Orchidée', water: 'trempage', dry: 'racines', names: ['orchidée'], summer: 7, winter: 12, light: 'lumineux', temp: [16, 28], moisture: [20, 60], humidity: 50,
    tips: ['Tremper le pot 10 minutes puis bien égoutter.', 'Arroser quand les racines sont argentées.', 'Lumière vive sans soleil direct.'] }),

  // ---- Aromatiques
  C({ keys: ['ocimum basilicum', 'ocimum'], label: 'Basilic', water: 'modere', dry: 'dessus', names: ['basilic'], summer: 2, winter: 4, light: 'soleil', temp: [15, 30], moisture: [45, 75], humidity: 40,
    tips: ['Terre fraîche en permanence, arroser le matin au pied.', 'Pincer les fleurs pour prolonger la récolte.', 'Craint le froid sous 12 °C.'] }),
  C({ keys: ['mentha'], label: 'Menthe', water: 'modere', dry: 'dessus', names: ['menthe'], summer: 2, winter: 5, light: 'mi-ombre', temp: [5, 28], moisture: [50, 80], humidity: 40,
    tips: ['Terre toujours humide.', 'Très envahissante : à garder en pot.', 'Rabattre après floraison.'] }),
  C({ keys: ['petroselinum crispum', 'petroselinum'], label: 'Persil', water: 'modere', dry: 'dessus', names: ['persil'], summer: 3, winter: 6, light: 'mi-ombre', temp: [5, 25], moisture: [45, 75], humidity: 40,
    tips: ['Terre fraîche.', 'Couper les tiges extérieures en premier.', 'Mi-ombre en été.'] }),
  C({ keys: ['salvia rosmarinus', 'rosmarinus officinalis', 'rosmarinus'], label: 'Romarin', water: 'copieux', dry: 'moitie', names: ['romarin'], summer: 7, winter: 14, light: 'soleil', temp: [0, 30], moisture: [10, 40], humidity: 25,
    tips: ['Laisser sécher entre deux arrosages.', 'Plein soleil.', 'Terre très drainante.'] }),
  C({ keys: ['thymus'], label: 'Thym', water: 'copieux', dry: 'moitie', names: ['thym'], summer: 7, winter: 14, light: 'soleil', temp: [0, 30], moisture: [10, 40], humidity: 25,
    tips: ['Craint surtout l’humidité stagnante.', 'Plein soleil.', 'Tailler après floraison.'] }),
  C({ keys: ['allium schoenoprasum'], label: 'Ciboulette', water: 'modere', dry: 'dessus', names: ['ciboulette'], summer: 3, winter: 7, light: 'mi-ombre', temp: [5, 25], moisture: [40, 70], humidity: 40,
    tips: ['Terre fraîche.', 'Couper à 3 cm du sol pour la faire repousser.', 'Supporte la mi-ombre.'] }),
];

// Comment arroser : quantité selon le rendu du terreau, et quand recommencer
export const WATERING = {
  copieux: { short: 'Arrosage copieux', text: "Mouiller tout le terreau : arroser lentement jusqu'à ce que l'eau s'écoule par les trous du pot, puis vider la soucoupe au bout de 15 minutes." },
  modere: { short: 'Arrosage modéré', text: "Humidifier toute la motte sans la détremper : s'arrêter dès les premières gouttes sous le pot." },
  dessous: { short: 'Par la soucoupe', text: "Verser l'eau dans la soucoupe, laisser la motte boire 20 minutes, puis jeter le reste. Ne pas mouiller les feuilles." },
  trempage: { short: 'Par trempage', text: "Plonger le pot 10 minutes dans une eau à température ambiante, puis le laisser bien s'égoutter avant de le remettre en place." },
};
export const DRYNESS = {
  dessus: "Dès que la surface du terreau sèche au toucher : il doit rester légèrement humide en profondeur.",
  tiers: "Quand le tiers supérieur du pot est sec : un doigt enfoncé sur 3 à 5 cm ne doit plus sentir d'humidité.",
  moitie: "Quand la moitié du terreau est sèche : le pot est nettement plus léger.",
  sec: "Quand le terreau est sec sur toute la hauteur. En hiver, attendre même quelques jours de plus.",
  racines: "Quand le substrat est sec et que les racines sont devenues argentées.",
};

const DEFAULT = { label: null, summer: 7, winter: 12, light: null, temp: [15, 28], moisture: [20, 60], humidity: 40, tips: [] };

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['"‘’“”].*$/, '') // cultivar entre guillemets
    .replace(/\b(var|subsp|ssp|f|cv)\.?\s+\S+/g, '')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const BY_KEY = new Map();
for (const c of CARE) for (const k of c.keys) BY_KEY.set(norm(k), c);
const BY_NAME = [];
for (const c of CARE) for (const n of c.names || []) BY_NAME.push([norm(n), c]);
BY_NAME.sort((a, b) => b[0].length - a[0].length);

function shape(c, match, key) {
  return {
    match, // 'species' | 'genus' | 'name'
    key,
    label: c.label,
    summer: c.summer,
    winter: c.winter,
    light: c.light,
    temp: c.temp,
    moisture: c.moisture,
    humidity: c.humidity,
    tips: c.tips,
    water: c.water ? { kind: c.water, ...WATERING[c.water] } : null,
    dry: c.dry ? DRYNESS[c.dry] : null,
  };
}

// Recherche un profil d'entretien pour une plante
export function findCare(species, name) {
  const s = norm(species);
  if (s) {
    const words = s.split(' ');
    const binomial = words.slice(0, 2).join(' ');
    if (BY_KEY.has(binomial)) return shape(BY_KEY.get(binomial), words.length > 1 ? 'species' : 'genus', binomial);
    if (BY_KEY.has(words[0])) return shape(BY_KEY.get(words[0]), 'genus', words[0]);
  }
  for (const txt of [s, norm(name)]) {
    if (!txt) continue;
    for (const [n, c] of BY_NAME) if (` ${txt} `.includes(` ${n} `)) return shape(c, 'name', n);
  }
  return null;
}

export const CARE_DEFAULT = DEFAULT;
