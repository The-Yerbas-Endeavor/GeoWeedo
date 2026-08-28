# Dispensary location data sources

GeoWeedo tracks provenance for dispensary records so the game can grow without depending on a source whose terms do not permit bulk reuse.

## Weedmaps

Do not scrape, crawl, or bulk-extract Weedmaps business listings from the public website. Weedmaps' current acceptable-use and developer terms prohibit automated extraction/scraping of site data and business listings.

GeoWeedo may ingest Weedmaps-sourced records only when one of these applies:

1. GeoWeedo has authorized Weedmaps API access that permits the intended use.
2. A dispensary supplies its own listing/location data to GeoWeedo and has the right to do so.
3. A human admin manually records independently verifiable business facts and retains the source URL only as a review reference, subject to applicable terms.

Do not copy Weedmaps descriptions, photos, menus, reviews, pricing, or other protected listing content into GeoWeedo.

## Preferred scalable sources

Use official state/provincial cannabis-license registries, dispensary-provided submissions, and compatible open data for bulk candidate creation. Every candidate should still pass GeoWeedo's imagery validation workflow before becoming playable.

Suggested provenance fields:

- `dataSource`
- `sourceUrl`
- `sourceLicense`
- `verifiedAt`
- `verifiedBy`

The production workflow should remain:

candidate data -> coordinate validation -> KartaView/GeoWeedo imagery review -> starting-frame approval -> live game pool.
