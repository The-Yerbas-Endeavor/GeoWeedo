# GeoWeedo

GeoWeedo is a dispensary geography guessing game built on an open map/imagery stack with Yerbas rewards and dispensary sponsorships.

## Current application layer

- Next.js + TypeScript
- Five-round single-player gameplay and 25,000-point scoring
- MapLibre GL JS + OpenFreeMap/OpenStreetMap guessing map
- KartaView street imagery and interactive spherical panoramas
- GeoWeedo-hosted JPEG/PNG/WebP imagery fallback, including equirectangular 360 panoramas
- Human-reviewed starting frame before a real dispensary becomes playable
- Official/open-data candidate import queue with provenance tracking
- Direct Oregon OLCC Open Data retailer import plus generic regulator CSV import
- Player account page with Yerbas message-signature ownership verification
- Auditable YERB reward ledger with pending/held/paid/failed states
- Isolated YERB payout worker: dry-run by default and explicitly enabled for sends
- Dispensary YERB sponsorship dashboard with campaign txid, dates, and priority
- Maximum one sponsored location per standard five-round game
- Sponsored placement never changes distance, score, or player reward rate

## Routes

Public:

```text
/
/how-to-play
/about
/rewards
/for-dispensaries
/account
```

Admin:

```text
/admin/data
/admin/dispensaries
/admin/rewards
/admin/sponsorships
```

## Zero-Google map and imagery stack

GeoWeedo does not require a Google Maps API key, Google Cloud project, or Google billing account. MapLibre/OpenFreeMap powers the guessing map. KartaView is the default street-imagery source; GeoWeedo-hosted imagery fills important coverage gaps.

Approved real dispensaries are stored in `data/runtime/dispensaries.json`. Hosted production imagery is stored under `public/uploads/dispensaries/`. Both locations are gitignored so application pulls/rebuilds do not overwrite production curation.

## Official dispensary data

`/admin/data` supports generic licensing/open-data CSV imports. Imported records enter a candidate queue and cannot become playable until imagery is reviewed.

Oregon also has a direct admin import using the official **OLCC Cannabis Business Licenses & Endorsements** Oregon Open Data dataset.

Do not scrape public Weedmaps listings. Weedmaps-derived records may only be used when GeoWeedo has authorization/API rights for the intended use or a business supplies data it has the right to provide.

See:

```text
docs/dispensary-data-sources.md
docs/official-dispensary-imports.md
```

## Player wallet verification

`/account` verifies ownership without collecting a private key. GeoWeedo creates a one-time message and the player signs it with their Yerbas wallet. The server checks the signature using the Yerbas RPC `verifymessage` method and records the public address as verified/reward-eligible.

Never submit wallet seed phrases or private keys to GeoWeedo.

## YERB rewards

Default development policy:

```env
NEXT_PUBLIC_YERB_PER_POINT=0.0004
NEXT_PUBLIC_YERB_DAILY_CAP=25
```

At the default rate, a perfect 25,000-point game estimates to 10 YERB. Score remains a pure geography score; reward economics are separate.

The admin reward ledger is at `/admin/rewards`. The actual sender is intentionally outside the web request path:

```bash
npm run rewards:dry-run
npm run rewards:pay
```

`rewards:pay` still sends nothing unless `YERB_PAYOUTS_ENABLED=true` is set. The worker checks verified addresses, applies the daily cap, sends pending ledger entries one at a time, and records each txid.

Gameplay does **not** automatically create paid reward entries yet because the current game is still client-authoritative. The next security layer is server-authoritative game sessions and anti-cheat validation; validated completed games can then create pending reward entries automatically.

See `docs/yerb-reward-operations.md`.

## Dispensary sponsorships

`/admin/sponsorships` records the dispensary, YERB amount, payment txid, start/end dates, status, and priority weight. Active campaigns can affect selection frequency in ordinary games, but GeoWeedo caps selection at one sponsored round per five-round game. Daily competitive challenges should remain unsponsored.

## Environment

Start from `.env.example`. Important values:

```env
GEOWEEDO_ADMIN_SECRET=
GEOWEEDO_SESSION_SECRET=
NEXT_PUBLIC_YERB_PER_POINT=0.0004
NEXT_PUBLIC_YERB_DAILY_CAP=25
NEXT_PUBLIC_YERB_SPONSOR_ADDRESS=
YERB_RPC_URL=http://127.0.0.1:YOUR_RPC_PORT
YERB_RPC_USER=
YERB_RPC_PASSWORD=
YERB_PAYOUTS_ENABLED=false
```

RPC credentials stay server-side. Confirm the actual Yerbas RPC port and credentials from the wallet/daemon configuration rather than assuming the example port.

## Development

```bash
cp .env.example .env.local
npm install
npm run dev
```

## Production update

```bash
cd ~/GeoWeedo
git pull
npm install
rm -rf .next
npm run build
sudo systemctl restart geoweedo
```

For hosted-image uploads, configure Nginx to permit the application upload size, for example:

```nginx
client_max_body_size 25M;
```

The systemd service should continue running as the `geo` user so it can update `data/runtime/` and `public/uploads/dispensaries/`.

## Next security/persistence layer

1. Server-authoritative game sessions and round tokens.
2. Anti-cheat/duplicate-account/rate-limit rules and automatic pending reward creation.
3. Player authentication/session restoration beyond the current wallet-verification record.
4. Dispensary claim/ownership verification and self-service sponsorship funding.
5. PostgreSQL/PostGIS migration for players, games, rewards, sponsorships, and curated locations.
6. Deterministic Daily Challenge and leaderboard persistence.
7. Easy, Normal, Hard, and No-Move modes.
8. Admin users/roles replacing the initial shared admin secret.
