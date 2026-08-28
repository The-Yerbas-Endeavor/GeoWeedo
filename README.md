# GeoWeedo

GeoWeedo is a dispensary geography guessing game inspired by location-guessing games such as OpenGuessr.

## v0.1 foundation

- Next.js + TypeScript application shell
- Five-round single-player game flow
- 25,000-point scoring structure
- Daily Challenge entry point
- Provider-neutral panorama stage ready for Street View integration
- Typed dispensary data model with demo seed locations
- Responsive dark map/game UI
- Result screen and round scoring

## Development

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Next implementation layer

1. Add a real panorama provider adapter.
2. Add an interactive guessing map and haversine distance scoring.
3. Move dispensaries into PostgreSQL/PostGIS.
4. Add admin CRUD/import tools for dispensaries and panorama validation.
5. Add deterministic daily challenge generation and leaderboard persistence.
6. Add difficulty modes: Easy, Normal, Hard, and No Move.

## Dispensary record

The initial model supports identity, coordinates, locality, website/photo metadata, panorama placement, recreational/medical flags, verification, and active status.

The demo records are placeholders and should be replaced with curated real dispensaries after panorama coverage is verified.
