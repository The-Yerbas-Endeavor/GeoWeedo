# GeoWeedo

GeoWeedo is a dispensary geography guessing game inspired by location-guessing games such as OpenGuessr.

## Current gameplay layer

- Next.js + TypeScript application shell
- Five-round single-player game flow
- 25,000-point scoring structure
- Interactive Google Street View panorama
- Interactive Google Maps guessing map
- Click-to-place and move guesses
- Real Haversine distance calculation
- Distance-based scoring up to 5,000 points per round
- Reveal map with guess, actual location, and connecting line
- Daily Challenge entry point
- Typed dispensary data model with demo seed locations
- Responsive dark map/game UI

## Google Maps setup

GeoWeedo expects a browser Google Maps API key in `.env.local`.

```bash
cp .env.example .env.local
nano .env.local
```

Set:

```env
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_key_here
```

Enable the Google Maps JavaScript API for that key. Street View is rendered through the Maps JavaScript API. Restrict the browser key by HTTP referrer in Google Cloud, including your production hostname, for example:

```text
https://geoweedo.yerbas.org/*
```

Do not commit `.env.local` or an unrestricted API key.

## Development

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Production update

```bash
cd ~/GeoWeedo
git pull
npm install
npm run build
sudo systemctl restart geoweedo
```

## Next implementation layer

1. Replace demo coordinates with curated real dispensaries and verified panorama positions.
2. Move dispensaries into PostgreSQL/PostGIS.
3. Add admin CRUD/import tools and panorama validation.
4. Add deterministic daily challenge generation and leaderboard persistence.
5. Add difficulty modes: Easy, Normal, Hard, and No Move.
6. Add panorama offsets so difficult rounds can begin away from the storefront.

## Dispensary record

The model supports identity, coordinates, locality, website/photo metadata, panorama placement, recreational/medical flags, verification, and active status.

The current demo records are placeholders and should be replaced with curated real dispensaries after panorama coverage is verified.
