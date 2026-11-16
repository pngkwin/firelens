# Reproducible FireLens demonstration

No deployment or commit is performed by these commands.

The application ships the complete supplied regional 2024 NASA FIRMS archives: 6,827 MODIS Terra/Aqua and 47,364 VIIRS S-NPP records. `public/data/demo/v1/` holds two byte-identical-original gzip files, an explicit versioned manifest, and a provenance README. Total compressed payload is 0.95 MiB. The originals in `data/raw/` remain unchanged and ignored. No credentials, private download URLs, or synthetic observations are packaged.

Before committing, include the versioned distribution files, source, lockfile and scripts. Keep large raw originals and generated build output out of Git. This task prepares these files only; you decide when to commit and publish.

## Verify locally

```sh
npm ci
npm run data:verify
npm test
npm run build
node scripts/verify-demo.mjs --dist
npm run test:e2e
npm run build:clean
```

`test:e2e` builds and runs browser tests against production preview, including downloads and the genuine archives. The configured browser is Microsoft Edge; adjust `playwright.config.ts` for another installed Playwright browser on other operating systems.

`build:clean` makes a temporary source tree containing no raw directory or generated uncompressed CSVs. It includes only application files, scripts and the versioned compressed bundle, reuses the installed dependencies via a junction, builds the app, and verifies both decompressed original SHA-256 hashes and all 54,191 rows. Its evidence is written to `.impeccable/review/clean-build.json`. This verifies a clean source/data checkout, not an independent lockfile installation.

To inspect that clean output in a browser, use the temporary directory printed by the command:

```sh
npx vite preview --host 127.0.0.1 --port 4174 --outDir "<printed temporary directory>/dist"
```

Expect two datasets: MODIS 6,827 (Terra 3,596; Aqua 3,231) and VIIRS 47,364 (S-NPP). Both original record-date extents are 2024-01-01–2024-12-31 UTC. These are the limits of this supplied regional demonstration, not a restriction on future imported datasets or evidence of observation coverage.

## Vercel preparation

Select the Vite framework, `npm run build` as the build command and `dist` as output. Include `public/data/demo/v1` in the source you publish; both archive gzip files and the manifest are required. Build-time verification fails on missing files, wrong hashes, row-count mismatches, or altered bundle totals. Runtime verifies host-decoded or explicitly compressed responses, then validates original file hashes, instrument schemas and exact parsed counts. It never silently substitutes a sample.

The static bundle requires no backend or secret. Basemap tiles remain a network dependency; observation tables and exported counts do not depend on successful map rendering. A production visit should open the verified study without a CSV upload. Check this after publishing yourself.

## Future data

Import additional official CSVs in the application without altering the bundled demo or interface. Dataset identities, UTC handling, filters and monthly availability are shared. To change the default demonstration, prepare a new explicit bundle version from inspected originals, retain source hashes/provenance, and update the manifest URL and verification expectations together. Do not silently overwrite a published version's geographic or temporal scope.

This section covers the v1 CSV workspace (`#workspace`): its comparisons are raw descriptive counts of the 2024 sample, with no harmonization, correction coefficient, prediction or anomaly values. The harmonized calendar (the default view) is a separate product with its own bundle (`public/data/v2`), method and validation: see [harmonization-method.md](harmonization-method.md) and [harmonization-validation.md](harmonization-validation.md).

## Historical aggregate assets

Include `public/data/history/latest.json`, `analysis-latest.json`, and the active version directory they reference alongside the unchanged demo. `npm run build` now verifies historical partition hashes, decoded bytes, daily/monthly/yearly count reconciliation and analysis version consistency as well as the original demo. `build:clean` includes and verifies both static datasets without raw CSVs or local databases.

Generate the history assets locally with `npm run history:prepare` then `npm run history:analyze`; commit only the deliberately selected active static version when publishing yourself. Do not run preprocessing over absent raw archives in a Vercel build. No SQLite file, raw archive or NASA credential needs to be deployed. Select a supported Node version >=22.18 for the project. The static historical repository loads monthly aggregate partitions on demand with integrity checks; individual hotspot inspection/exports continue to use the loaded-point workspace. Full processing, size budgets and future scaling limitations are documented in [historical-data-pipeline.md](historical-data-pipeline.md).
