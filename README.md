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
- Clickable site navigation with How to Play, About, YERB Rewards, and For Dispensaries pages
- Configurable YERB reward estimate displayed during and after games
- Prisma models for players, verified Yerbas wallet addresses, reward payouts, and sponsored dispensary listings
- Dispensary provenance fields for source URL/license tracking

## Yerbas integration

GeoWeedo keeps the map score independent from payments. A game still scores only by distance.

Default development reward policy:

```env
NEXT_PUBLIC_YERB_PER_POINT=0.0004
NEXT_PUBLIC_YERB_DAILY_CAP=25
```

At that default rate, a perfect 25,000-point game estimates to 10 YERB. This is a configurable development policy, not a promise of payment.

Automatic payouts are intentionally not enabled yet. The next payout layer must require a player account, verified Yerbas address, completed-game persistence, anti-abuse review, daily-cap enforcement, and a server-side wallet/RPC worker. RPC credentials must never be exposed to browser code.

The Prisma model now supports:

- `Player`
- `Game.rewardYerb` and reward state
- `RewardPayout` with status and transaction ID
- `SponsoredListing` with YERB amount, payment txid, priority weight, and campaign dates

Sponsored placement must never change score calculation. Priority should be capped to a small share of ordinary games and clearly labeled where surfaced.

## Dispensary data sourcing

GeoWeedo tracks `dataSource`, `sourceUrl`, and `sourceLicense` so every imported location has provenance.

Do not scrape or bulk-extract Weedmaps listings from the public Weedmaps site. Their current acceptable-use and developer terms prohibit scraping/crawling/extracting site and business-listing data. Weedmaps-sourced data should only be ingested when GeoWeedo has explicit authorized access/permission for the intended use.

For scalable population, prefer official state/provincial cannabis-license registries, dispensary-provided submissions, and compatible open datasets. See `docs/dispensary-data-sources.md`.

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
2. Record the data source/provenance.
3. Resolve coordinates with the admin-only OpenStreetMap address search, or enter coordinates manually.
4. Search KartaView near the storefront.
5. Step through the returned sequence or inspect a 360 view.
6. Choose the exact starting frame.
7. Approve it.
8. The dispensary is saved as verified and active and becomes eligible for the live game pool.
9. It can later be deactivated without deleting the validation record.

Approved records are stored in `data/runtime/dispensaries.json`. That directory is gitignored so normal `git pull` and rebuilds do not overwrite production approvals. The current runtime JSON store is intentionally simple for the first production layer; the Prisma schema is already extended so these records can later move into PostgreSQL without redesigning the imagery model.

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

1. Add GeoWeedo-hosted imagery upload/storage for dispensaries without KartaView coverage.
2. Add CSV/import review queue for official/open dispensary datasets.
3. Build player accounts + Yerbas address verification + persisted game sessions.
4. Add anti-cheat/reward review and server-side Yerbas payout worker.
5. Add dispensary claim flow and YERB-funded sponsored campaigns with a one-sponsored-round-per-game cap.
6. Migrate runtime approvals and rewards to PostgreSQL/PostGIS.
7. Add deterministic Daily Challenge generation and leaderboard persistence.
8. Add difficulty modes: Easy, Normal, Hard, and No Move.
9. Add admin users/roles instead of the initial shared admin secret.
