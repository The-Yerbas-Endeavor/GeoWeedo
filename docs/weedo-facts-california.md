# Weedo Facts — California data plan

## Goal

Build a free consumer-facing cannabis product scanner that resolves a package to the exact tested batch whenever possible, normalizes the Certificate of Analysis (COA), and displays a consistent "Weedo Facts" panel while linking back to the original report.

## California data anchors

California is a strong first state because the Department of Cannabis Control (DCC) requires compliance testing before cannabis goods may be sold. Regulatory COAs are batch-specific and include identifying and testing metadata useful to GeoWeedo.

Key identifiers and fields to preserve:

- Product barcode / UPC when a brand or retailer exposes one.
- Lab QR URL or lab sample identifier.
- California track-and-trace UID when visible on the package.
- Batch / lot number.
- COA number or external lab sample identifier.
- Testing laboratory name and DCC license number.
- Producer / cultivator / manufacturer name and license number.
- Sample collected, received, and analyzed/tested dates.
- Cannabinoid and terpene measurements.
- Required contaminant/compliance test results.
- Original COA URL and immutable/raw-source metadata when available.

## Match policy

GeoWeedo must never silently substitute one batch for another.

1. **Exact batch verified** — identifier resolves to a specific batch and the source is an original lab/COA or another verified source.
2. **Product match — batch needed** — product identity is known, but the package batch has not been resolved. Do not display another batch's lab values as current.
3. **Community record — unverified** — submitted data exists but has not yet been verified against an original source.

## Source priority

1. Original licensed-lab result page / official COA.
2. Direct laboratory API or structured export if partnership/access is available.
3. Brand/manufacturer COA page that links or reproduces an original lab report.
4. Retailer-provided exact-batch COA.
5. User-submitted original COA or package capture, queued for verification.

## Initial lab-adapter strategy

Create one adapter per source and normalize into the same GeoWeedo schema. The first California investigation should prioritize laboratories whose result pages or QR links can be accessed by consumers. SC Labs is a useful first adapter candidate because its platform provides sample detail pages, COA PDFs, and QR codes for sample detail pages; partnership/API access can be evaluated separately.

## Safety and presentation rules

- Core lab and compliance information stays free.
- Preserve a link to the original COA whenever possible.
- Clearly display the match/verification level.
- Do not convert terpene/cannabinoid data into medical claims or guaranteed subjective effects.
- Do not label a product "safe" based solely on a COA; present the laboratory's reported pass/fail result and source.
- Store values and units as reported rather than forcing all labs into a lossy conversion.

## Future menu integration

The target relationship is:

`Dispensary -> Menu Listing -> Product -> Exact Batch -> COA -> Weedo Facts`

A menu may identify only the product initially. Exact batch data should be attached only when the retailer/menu source supplies a batch/UID/COA identifier or when a consumer scan resolves it.

## Framework status

The initial implementation adds normalized tables for products, product identifiers, batches, batch identifiers, analytes, and COA sources; a lookup service; a lookup API; and a prototype `/weedo-facts` page. Camera scanning, lab adapters, ingestion/admin review, and user submissions are intentionally left for follow-up layers.
