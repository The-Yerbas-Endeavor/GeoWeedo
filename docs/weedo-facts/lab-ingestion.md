# Weedo Facts automatic lab ingestion

GeoWeedo's lab ingestion pipeline is provider-based. SC Labs is the first provider.

## SC Labs public discovery

The provider only reads public `client.sclabs.com` resources. Discovery checks:

1. sitemap URLs declared by `https://client.sclabs.com/robots.txt`;
2. standard SC Labs sitemap locations;
3. optional public catalog URLs configured in `SC_LABS_PUBLIC_CATALOG_URLS`;
4. optional known public sample URLs configured in `SC_LABS_PUBLIC_SAMPLE_URLS`.

Comma-separate multiple values in `.env.local`:

```bash
SC_LABS_PUBLIC_CATALOG_URLS=https://client.sclabs.com/coldfire/,https://client.sclabs.com/redwood-roots-family/
SC_LABS_PUBLIC_SAMPLE_URLS=https://client.sclabs.com/redwood-roots-family/the-pearls-2/phytofacts/
```

Private CSP samples are not accessed or guessed.

## Manual bulk run

```bash
npm run weedo:ingest:labs -- --provider=sc-labs --max=500 --refresh-hours=24
```

The importer records run history and per-source fingerprints. Unchanged samples are skipped until the refresh window expires. Changed public records are re-ingested idempotently.

## Hourly automatic run

Install the included systemd timer once on the GeoWeedo server:

```bash
npm run weedo:ingest:timer:install
```

The timer runs hourly with a randomized delay of up to five minutes, imports up to 500 discovered public SC Labs samples per run, and rechecks a source at most once every 24 hours by default.

Inspect it with:

```bash
systemctl status geoweedo-lab-ingestion.timer
journalctl -u geoweedo-lab-ingestion.service -n 100 --no-pager
```

## Admin API

Authenticated administrators can inspect recent runs with:

```text
GET /api/admin/weedo-facts/lab-ingestion
```

or trigger a bounded run with:

```json
POST /api/admin/weedo-facts/lab-ingestion
{"provider":"sc-labs","maxItems":100,"refreshHours":24}
```

Additional labs should implement the `LabProvider` interface and register in `lib/labProviders/index.ts`.
