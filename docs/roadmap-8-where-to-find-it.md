# Roadmap #8 — Where to find it

Weedo Facts product cards consume `/api/weedo-facts/availability` and display current GeoWeedo-linked dispensary menu listings.

Behavior:
- exact tested-batch listings are labeled separately from product-level matches;
- price, package, variant/category, inventory status and listing verification are shown when available;
- each result links back to the GeoWeedo dispensary profile and original menu source when supplied;
- zero results are described as “no linked dispensary listings yet,” not as proof that a product is unavailable;
- no synthetic inventory is created.
