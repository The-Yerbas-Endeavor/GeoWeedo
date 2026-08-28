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
- Real Haversine distance calculation and scoring
- Admin dispensary imagery-validation workflow
- Admin-selected starting frame per approved dispensary
- Runtime approved game pool with activate/deactivate controls
- Address lookup through a server-side OpenStreetMap Nominatim proxy
- GeoWeedo-hosted imagery provider field reserved for fallback coverage

## Zero-Google stack

GeoWeedo does not require a Google Maps API key, Google Cloud project, or Google billing account.

The guessing map uses MapLibre GL JS with the OpenFreeMap public style. Street-level imagery uses KartaView's public read API. KartaView coverage is crowdsourced and therefore less complete than Google Street View, so real dispensaries are admitted to gameplay only after an admin reviews and approves a starting image.

## Admin imagery validation

The admin workflow lives at:

```text
/admin/dispensaries
```

Set a strong server-side secret in `.env.local`:

```env
GEOWEEDO_ADMIN_SECRET=replace_with_a_long_random_value
```

The workflow is:

1. Enter the real dispensary name and address.
2. Resolve coordinates with the admin-only OpenStreetMap address search, or enter coordinates manually.
3. Search KartaView near the storefront.
4. Step through the returned sequence or inspect a 360 view.
5. Choose the exact starting frame.
6. Approve it.
7. The dispensary is saved as verified and active and becomes eligible for the live game pool.
8. It can later be deactivated without deleting the validation record.

Approved records are stored in `data/runtime/dispensaries.json`. That directory is gitignored so normal `git pull` and rebuilds do not overwrite production approvals. The current runtime JSON store is intentionally simple for the first production layer; the Prisma schema is already extended so these records can later move into PostgreSQL without redesigning the imagery model.

The public Nominatim service is used only for deliberate admin-triggered address searches through a server proxy with caching and an identifying User-Agent. Do not turn it into autocomplete or bulk geocoding.

## Development

```bash
cp .env.example .env.local
nano .env.local
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

The systemd service should continue to run as the `geo` user so it can create and update `data/runtime/dispensaries.json`.

## Next implementation layer

1. Add GeoWeedo-hosted imagery upload/storage for important dispensaries without KartaView coverage.
2. Add CSV/import review queue for batches of candidate dispensaries.
3. Migrate the runtime approval store to PostgreSQL/PostGIS once the curation workflow is stable.
4. Add deterministic Daily Challenge generation and leaderboard persistence.
5. Add difficulty modes: Easy, Normal, Hard, and No Move.
6. Add admin users/roles instead of the initial shared admin secret.
