# Rosée V2

Rosée est une appli web installable (PWA) auto-hébergée pour gérer tes plantes, dans un style « Greenhouse » : un tableau de bord végétal, avec une mise en page mobile et une mise en page web à sidebar.

**Fonctions**
- **Accueil** : indicateurs clés, tâches du jour, conditions de la pièce, plantes à surveiller, activité récente.
- **Mes plantes** : recherche et filtres (à arroser, alertes, connectées, par pièce).
- **Fiche plante** : jauge avant arrosage, conseils, mesures actuelles, graphiques 24 h / 7 jours, historique.
- **Calendrier** : vue mensuelle avec les arrosages faits, prévus et en retard, plus un abonnement Google Agenda.
- **Capteurs** : capteurs lus dans **Home Assistant**, avec leur statut, leur batterie et leur dernière mesure.
- **Rappels push** : un rappel quotidien qui couvre les plantes à arroser **et** celles dont un capteur signale un problème.

**Technique** : Node 22, Express, SQLite, `sharp` et `web-push`. Pas de framework front ni d'étape de build. Toutes les données sont dans `./data`.

## Déploiement

### Option A : image construite par GitHub Actions (recommandé)

À chaque push sur `main`, le workflow `.github/workflows/docker.yml` publie `ghcr.io/sir22io/rosee:latest`.

```bash
# Sur l'hôte Docker, une seule fois
git clone https://github.com/Sir22io/rosee.git /opt/rosee && cd /opt/rosee
cp .env.example .env && nano .env        # VAPID_SUBJECT, HA_URL, HA_TOKEN…
mkdir -p data && chown 1000:1000 data    # le conteneur tourne en uid 1000
# Dépôt privé : l'image l'est aussi -> jeton GitHub (classic) avec le seul droit read:packages
echo "<jeton>" | docker login ghcr.io -u Sir22io --password-stdin
docker compose pull && docker compose up -d
```

Mise à jour : `git pull && docker compose pull && docker compose up -d`.

### Option Portainer

1. **Registre** : seulement si l'image est privée. Va dans *Registries → Add registry → Custom registry*, avec l'URL `ghcr.io`, l'utilisateur `Sir22io` et comme mot de passe un jeton GitHub (classic) qui n'a que le droit `read:packages`.
2. **Stack** : va dans *Stacks → Add stack → Repository*.
   - Repository URL : `https://github.com/Sir22io/rosee`
   - Reference : `refs/heads/main`
   - Compose path : `portainer-stack.yml`
   - Dépôt privé : active *Authentication*, avec un jeton qui a le droit `repo`.
3. **Environment variables** : renseigne `VAPID_SUBJECT`, `HA_URL`, `HA_TOKEN` et, si besoin, `FEED_BASE_URL`. Si le port 3000 de l'hôte est déjà pris, ajoute `ROSEE_PORT` avec un autre port (ex. `3010`).
4. **Mises à jour automatiques** (facultatif) : active *GitOps updates* (polling 5 min) avec *Re-pull image*.

Les données sont dans le volume Docker `rosee-data`. Sauvegarde ce volume.

### Option B : construire sur l'hôte

Même chose sans `docker login` : `git pull && docker compose up -d --build`.

**Depuis la V1** : garder `data/`, créer `.env` à partir de `.env.example`. La base est migrée automatiquement.

## Reverse proxy

1. Proxy host `plantes.<ton-domaine>` → `http://<ip-hôte>:3000`, certificat valide, HTTPS forcé.
2. Restreindre l'accès au réseau local et au VPN (Access List).

Le HTTPS est obligatoire pour le service worker et les notifications.

## Rappels

- Chaque jour à l'heure choisie, si une plante a besoin d'eau :
  - **jusqu'à 3 plantes**, une notification par plante, avec sa photo et le type d'arrosage ;
  - **au-delà**, une seule notification groupée.
- Les notifications portent deux boutons : **« Arrosée »** (ou « Tout est arrosé ») et **« Dans 3 h »**. Ils marchent depuis l'écran verrouillé, sans ouvrir l'appli, grâce à un jeton signé valable 3 jours et limité aux plantes concernées. Un double appui ne crée pas de doublon. Les boutons s'affichent sur Android, Windows et macOS. Sur iPhone, iOS ne les affiche pas : toucher la notification ouvre la plante.
- Les plantes signalées par un capteur font l'objet d'une notification « À surveiller » à part.

## Repères d'entretien et saisons

- **Repères par espèce** (`care.js`) : la base couvre une cinquantaine de plantes d'intérieur et d'aromatiques. Elle donne le rythme d'arrosage en été et en hiver, la lumière, la température et l'humidité, avec quelques conseils. La correspondance se fait sur l'espèce, puis sur le genre, puis sur le nom commun. Les repères sont proposés dans le formulaire (appliqués d'office pour une nouvelle plante) et affichés sur la fiche. Ils servent aussi de seuils par défaut pour les alertes des capteurs.
- **Arrosage saisonnier** : chaque plante a un rythme d'été et un rythme d'hiver. Si le rythme d'hiver n'est pas renseigné, il vaut 1,6 fois celui d'été. Entre les deux, Rosée interpole mois par mois : plein été de juin à août, plein hiver de décembre à janvier. Le calendrier, l'agenda et les rappels suivent ce rythme. L'option se désactive plante par plante. Pour l'hémisphère sud, mets `SEASONS=south`.
- Le nom scientifique trouvé avec la photo automatique est enregistré comme espèce s'il n'était pas renseigné.

## Photos des plantes

Chaque plante peut avoir :
- **ta photo** : prise avec le téléphone ou importée ;
- **une photo de référence de l'espèce**, à choisir dans le formulaire parmi les photos d'[iNaturalist](https://www.inaturalist.org) sous licence Creative Commons. Seules les licences CC0, BY, BY-SA, BY-NC et BY-NC-SA sont retenues, et l'auteur est toujours cité sur la fiche.

Une plante créée sans photo reçoit automatiquement la première photo de référence de son espèce. Si tu modifies ensuite l'espèce, la recherche est relancée. Si tu retires la photo à la main, elle ne revient pas. Les photos sont téléchargées et stockées dans `data/photos`, donc l'appli fonctionne même si iNaturalist est indisponible.

La recherche se fait sur le nom scientifique, ou à défaut sur le nom commun en français. Seuls les végétaux sont proposés : « Basilic » ne renvoie pas le lézard.

## Home Assistant

1. Dans HA, va dans **Profil → Sécurité → Jetons d'accès longue durée → Créer un jeton**.
2. Dans `.env`, renseigne `HA_URL` (adresse interne de HA) et `HA_TOKEN`.
3. Dans Rosée, ouvre la fiche d'une plante puis **Connecter un capteur**. Choisis les entités pour l'humidité du sol, la température, la luminosité et l'humidité de l'air.

Rosée ne fait que **lire** l'API REST de HA (`/api/states`, `/api/history`). Les capteurs Bluetooth de plantes de type « Flower Care » (Xiaomi), intégrés à HA, conviennent bien.

- **Batterie** : elle est détectée automatiquement quand une entité `device_class: battery` partage le même préfixe que le capteur (ex. `sensor.ficus_moisture` → `sensor.ficus_battery`).
- **Alertes** :
  - sol hors de la plage cible (20–60 % par défaut, réglable par plante),
  - température hors plage (15–28 °C par défaut),
  - air trop sec (< 40 %),
  - lumière faible, mesurée sur le **pic des dernières 24 h** et non sur une valeur instantanée,
  - capteur hors ligne ou muet depuis plus de 12 h,
  - batterie ≤ 15 %.

## Comptes Google et Google Agenda

La connexion Google est **facultative**. Sans configuration, l'appli reste ouverte, comme avant. Une fois activée :
- la **serre est partagée** : tous les comptes listés dans `ALLOWED_EMAILS` voient les mêmes plantes, et l'historique indique qui a arrosé ;
- chacun peut **connecter son Google Agenda** : Rosée y crée un agenda « Rosée — arrosages » et le tient à jour, avec un événement par arrosage prévu. Le rythme saisonnier est pris en compte, et un arrosage fait est marqué « ✓ » ;
- dans **Paramètres → Agenda**, chacun règle l'heure, la durée, les alertes (au moment même, 10 min, 30 min, 1 h, 2 h, 3 h ou la veille, jusqu'à 5) et leur type (notification ou e-mail) ;
- Rosée ne demande que la portée `calendar.app.created` : elle accède aux seuls agendas qu'elle a créés, **pas à tes rendez-vous**. Le jeton Google est chiffré dans la base (AES-256-GCM) ;
- tout passe par des connexions **sortantes**, sans rien exposer sur Internet. Rosée a besoin d'un accès en 443 vers `accounts.google.com`, `oauth2.googleapis.com` et `www.googleapis.com`.

### Créer l'identifiant Google (une fois, ~10 min)

1. Sur [console.cloud.google.com](https://console.cloud.google.com), crée un projet, par ex. « Rosée ».
2. Dans **APIs et services → Bibliothèque**, active **Google Calendar API**.
3. Dans **Écran de consentement OAuth** (Google Auth Platform) :
   - type **Externe**, nom « Rosée », ton adresse en contact ;
   - **Accès aux données** : ajoute les portées `openid`, `email`, `profile` et `…/auth/calendar.app.created` ;
   - **Audience** : clique sur **Publier l'application** (statut *En production*). En mode *Test*, Google coupe l'accès à l'agenda au bout de 7 jours. Une application personnelle non validée affiche un écran d'avertissement : choisis *Paramètres avancés → Accéder à Rosée*.
4. Dans **Identifiants → Créer → ID client OAuth → Application Web** :
   - URI de redirection autorisé : `https://plantes.<ton-domaine>/auth/google/callback`. Il doit être en HTTPS et correspondre exactement à `PUBLIC_URL`. Le domaine n'a pas besoin d'être joignable depuis Internet : c'est ton navigateur qui suit la redirection.
5. Reporte l'ID et le secret dans la stack :
   ```
   PUBLIC_URL=https://plantes.<ton-domaine>
   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
   ALLOWED_EMAILS=toi@gmail.com,autre@gmail.com
   ```

## Agenda par lien .ics (sans compte)

**Calendrier → Google Agenda** donne un lien `.ics` secret. Dans Google Agenda, fais *Autres agendas → + → À partir de l'URL*. Les arrosages prévus sur 60 jours apparaissent sur tous tes appareils. Google rafraîchit ce type d'agenda toutes les quelques heures.

⚠️ **Les serveurs de Google doivent pouvoir lire ce lien depuis Internet.** Si ton reverse proxy n'est pas déjà joignable depuis l'extérieur, cela implique d'ouvrir le port 443. C'est un vrai changement de surface d'exposition : décide-le en connaissance de cause. Pour limiter l'exposition au seul flux :

1. Crée un second Proxy Host, par ex. `agenda-plantes.<ton-domaine>`, vers le même `http://<ip-hôte>:3000`, avec un certificat valide et **sans** Access List.
2. Dans l'onglet *Advanced*, ajoute :
   ```nginx
   if ($request_uri !~ ^/cal/[A-Za-z0-9_-]+\.ics$) { return 404; }
   ```
3. Dans `.env`, mets `FEED_BASE_URL=https://agenda-plantes.<ton-domaine>`, puis relance.

Ce qui est exposé : un flux en lecture seule, avec les noms des plantes, les pièces et les dates. Le jeton fait 192 bits aléatoires et le bouton « Nouveau lien » le régénère, ce qui coupe l'ancien.

## Installer sur les appareils

- **Android (Chrome)** : menu ⋮ → *Installer l'application*.
- **iPhone (iOS 16.4+)** : *Partager* → *Sur l'écran d'accueil*. Il faut ensuite ouvrir Rosée **depuis l'icône** pour activer les rappels.
- **PC** : Chrome ou Edge, avec l'icône d'installation dans la barre d'adresse. La mise en page web avec sidebar s'affiche à partir de 1024 px de large.

Pour activer les rappels sur chaque appareil : **Paramètres → Rappels → Activer**.

## Pare-feu

- **Rosée → Home Assistant** : port 8123 en interne.
- **Rosée → Internet en 443** : nécessaire pour les push (`fcm.googleapis.com`, `web.push.apple.com`, `updates.push.services.mozilla.com`) et les photos de référence (`api.inaturalist.org`, `inaturalist-open-data.s3.amazonaws.com`, `static.inaturalist.org`).

## Variables d'environnement (`.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `TZ` | `Europe/Paris` | Fuseau du rappel quotidien |
| `VAPID_SUBJECT` | — | Contact `mailto:` transmis aux services push |
| `HA_URL` / `HA_TOKEN` | vides | Connexion à Home Assistant |
| `FEED_BASE_URL` | vide | Adresse publique utilisée dans le lien d'agenda |
| `PUBLIC_URL` | vide | Adresse HTTPS de l'appli (obligatoire pour la connexion Google) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | vides | Identifiant OAuth : active les comptes et Google Agenda |
| `ALLOWED_EMAILS` | vide | Comptes Google autorisés, séparés par des virgules |
| `SESSION_SECRET` | généré | Clé de chiffrement des jetons (sinon `data/secret.key`) |
| `UPDATE_CHECK` | `1` | `0` désactive la vérification des mises à jour |
| `SEASONS` | `north` | `south` pour inverser les saisons |
| `PHOTO_LOOKUP` | `1` | `0` désactive l'attribution automatique d'une photo de référence |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | générées | Pour imposer tes propres clés |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | vides | Authentification HTTP. Le flux `/cal/` en est exempté : il est protégé par son jeton |
| `PORT` / `DATA_DIR` | `3000` / `/data` | Port d'écoute et dossier des données |

## Tests

`npm test` lance une trentaine de tests automatiques : API, saisons, capteurs Home Assistant, photos de référence et protection contre les URL piégées, flux d'agenda, connexion Google et synchronisation de l'agenda (services simulés), export et restauration, en-têtes de sécurité et vérifications de l'interface. Dans GitHub Actions, ils passent avant chaque construction : **si un test échoue, aucune image ni release n'est publiée**.

## Sécurité et sauvegardes

- **En-têtes** : politique de sécurité du contenu stricte (aucun script en ligne), `X-Frame-Options`, `nosniff`, `Referrer-Policy`.
- **Limitation de débit** : 600 requêtes/min par adresse sur l'API, 30/min sur la connexion et l'agenda (`RATE_LIMIT=0` pour désactiver). L'adresse réelle n'est lue dans `X-Forwarded-For` que si la requête vient d'un proxy du réseau local (`TRUST_PROXY` pour changer).
- **Sauvegarde automatique** de la base une fois par jour dans `data/backups/` (14 conservées, `BACKUP_KEEP`), et juste avant chaque restauration.
- **Export et restauration** dans Paramètres → Sauvegarde : un fichier JSON avec les plantes, les photos et l'historique.

## Versions et mises à jour

- La version est celle de `package.json`. **Tout est automatique** : à chaque push sur `main`, GitHub Actions construit et publie l'image (`latest` et `sha-<commit>`). Si la version de `package.json` est nouvelle, il crée aussi le tag `vX.Y.Z`, la release GitHub (notes générées) et les étiquettes d'image `X.Y.Z` et `X.Y`. Pour publier une version, il suffit d'augmenter le numéro dans `package.json`.
- Pour figer une version dans Portainer, remplace `latest` par `2.1.0` dans `portainer-stack.yml` (ou dans une copie de la stack).
- **Paramètres → À propos** affiche la version, le commit et la date de construction. Rosée compare son commit à celui de la dernière image construite avec succès par GitHub Actions et signale « Mise à jour disponible » avec la liste des changements. La vérification a lieu toutes les 6 h, ou à la demande, et passe par l'API publique de GitHub (`api.github.com`). `UPDATE_CHECK=0` la désactive.

## Sauvegarde

Sauvegarde tout le dossier `data/` (`rosee.db`, `photos/`, `vapid.json`, `secret.key`). Si `vapid.json` est perdu, tous les appareils doivent se réabonner aux rappels.

## API

| Requête | Effet |
|---|---|
| `GET /api/plants` | Plantes avec `days_left`, `health`, `alerts` et les mesures des capteurs |
| `POST /api/plants/:id/water` | Arrosage (`{ "at": "ISO" }` en option) |
| `GET /api/plants/:id/history?metric=moisture&hours=168` | Série agrégée d'une mesure |
| `GET /api/waterings?from=&to=` | Arrosages réalisés sur une période |
| `POST /api/push/test` | Envoie la notification du jour |
