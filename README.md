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

## Agenda Google (sans VPN)

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
| `PHOTO_LOOKUP` | `1` | `0` désactive l'attribution automatique d'une photo de référence |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | générées | Pour imposer tes propres clés |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | vides | Authentification HTTP. Le flux `/cal/` en est exempté : il est protégé par son jeton |
| `PORT` / `DATA_DIR` | `3000` / `/data` | Port d'écoute et dossier des données |

## Sauvegarde

Sauvegarde tout le dossier `data/` (`rosee.db`, `photos/`, `vapid.json`). Si `vapid.json` est perdu, tous les appareils doivent se réabonner aux rappels.

## API

| Requête | Effet |
|---|---|
| `GET /api/plants` | Plantes avec `days_left`, `health`, `alerts` et les mesures des capteurs |
| `POST /api/plants/:id/water` | Arrosage (`{ "at": "ISO" }` en option) |
| `GET /api/plants/:id/history?metric=moisture&hours=168` | Série agrégée d'une mesure |
| `GET /api/waterings?from=&to=` | Arrosages réalisés sur une période |
| `POST /api/push/test` | Envoie la notification du jour |
