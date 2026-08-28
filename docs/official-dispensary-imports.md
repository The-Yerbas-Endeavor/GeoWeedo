# Official dispensary candidate imports

GeoWeedo treats regulator data as a candidate source, not an automatic game-pool source.

## Workflow

1. Import an official regulator feed or CSV.
2. Review the candidate name, license, address, and coordinates.
3. Open the imagery validator.
4. Check KartaView or upload authorized GeoWeedo-hosted imagery.
5. Choose the exact starting frame.
6. Approve the dispensary into the live pool.

## Oregon

`/admin/data` includes a direct Oregon OLCC import using the official Oregon Open Data dataset **OLCC Cannabis Business Licenses & Endorsements**.

The direct import filters for retailer license types and stores the official source URL and license number with each candidate.

## Nevada and Washington

Use the regulator's current downloadable license/open-data export and the CSV importer. The importer recognizes common column names for business name, address, city, state/region, latitude, longitude, website, and license number.

## Weedmaps

Do not use the public Weedmaps site as a scraping source. Only use Weedmaps-derived data when GeoWeedo has authorization/API rights for that use or a business supplies data it has the right to provide.

## Provenance

Each imported candidate keeps:

- `dataSource`
- `sourceUrl`
- `sourceLicense`
- `licenseNumber` when available

These fields follow the record into the imagery-review workflow.
