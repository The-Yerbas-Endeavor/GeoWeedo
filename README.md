# GeoWeedo

GeoWeedo is a dispensary geography guessing game inspired by location-guessing games such as OpenGuessr.

## Current gameplay layer

- Next.js + TypeScript application shell
- Five-round single-player game flow
- 25,000-point scoring structure
- MapLibre GL JS guessing map using OpenFreeMap/OpenStreetMap data
- KartaView street-level imagery provider with no Google dependency
- Interactive 360 panorama rendering when KartaView supplies spherical imagery
- Step-through sequence navigation for ordinary street-level photos
- Click-to-place and move guesses
- Real Haversine distance calculation
- Distance-based scoring up to 5,000 points per round
- Reveal map with guess, actual location, and connecting line
- Cached server-side KartaView lookups to reduce public API traffic
- Daily Challenge entry point
- Typed dispensary data model with demo seed locations
- Responsive dark map/game UI

## Zero-Google stack

GeoWeedo v0.2 does not require a Google Maps API key, Google Cloud project, or Google billing account.

The guessing map uses MapLibre GL JS with the OpenFreeMap public style. Street-level imagery uses KartaView's public read API. KartaView coverage is crowdsourced and therefore less complete than Google Street View, so rounds should only become active after imagery coverage is verified.

When KartaView reports spherical/360 imagery, GeoWeedo renders it through the open-source Photo Sphere Viewer. Otherwise, players can move forward and backward through the nearby KartaView image sequence.

No environment variable is required for this stack.

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

1. Replace demo coordinates with curated real dispensaries that have verified KartaView or GeoWeedo-hosted imagery.
2. Add an admin imagery-validation workflow that searches KartaView before activating a dispensary.
3. Add a GeoWeedo-hosted imagery fallback for important dispensaries without KartaView coverage.
4. Move dispensaries into PostgreSQL/PostGIS.
5. Add deterministic Daily Challenge generation and leaderboard persistence.
6. Add difficulty modes: Easy, Normal, Hard, and No Move.
7. Store an imagery provider and starting frame/panorama reference per dispensary so live rounds never depend on an unverified nearest-image search.

## Dispensary record

The model supports identity, coordinates, locality, website/photo metadata, panorama placement, recreational/medical flags, verification, and active status.

The current demo records are placeholders. Before a real dispensary is admitted to the live game pool, GeoWeedo should verify that its street imagery exists, is close enough to the storefront, and provides a fair playable starting view.
