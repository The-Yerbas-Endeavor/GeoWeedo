# GeoWeedo branding

This folder is the single source of truth for GeoWeedo website branding.

## Live assets

- `geoweedo-favicon-32.png` — browser favicon.
- `geoweedo-icon-96.png` — current visible GeoWeedo brand icon used by the site header, desktop play card, mobile Search/Play splash, app metadata, Apple icon metadata, manifest and Open Graph metadata.
- `site.webmanifest` — installable web-app metadata.

The previous `geoweedo-mascot.png` in this repository was not the correct source image from the supplied branding package and has been removed so it cannot accidentally be used again.

When the full-resolution transparent mascot/source artwork is added, keep it in this folder and use it only for layouts large enough to preserve its detail. Small UI positions should continue using a purpose-built icon asset rather than scaling or cropping a large mascot image.

Tagline: **WEEDO SEARCH. WEEDO FIND. WEEDO PLAY.**

Do not scatter GeoWeedo logo, icon, social, hero or branding assets through `app/`, `components/`, or the public root. Keep them here and reference them as `/assets/geoweedo/<filename>`.
