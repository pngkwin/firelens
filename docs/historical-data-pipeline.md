# Historical data pipeline

Implemented 2026-11-15. This is preprocessing of detection records, not a harmonization model. Original NASA files are read only. The existing gzip-verified demo and browser CSV imports remain independent and unchanged.

## Run with future archives

Use Node 22.18+ (native TypeScript stripping and `node:sqlite`); measured here with Node 26.13.1. Run from the project root:

```powershell
npm ci
# Extract approved NASA CSV archives into additional nested folders under data/raw/.
# Keep supplied Readme.txt next to each CSV. Never edit an original CSV.
npm run history:prepare
npm run history:analyze
npm run history:verify
npm test
npm run history:test
npm run build
npm run test:e2e
```

`history:prepare` discovers CSVs recursively, in deterministic relative-path order. It does not download new observations or extract ZIPs automatically. Extract future ZIPs into their own folders first. Symlinks are not followed. Dates, region, year, and platform are not pinned to the development subset. Canonical validation supports years 1900–2100. Unknown future instrument identifiers require an explicit parser update, not a guessed classification.

Configuration: `scripts/history/config.json` specifies resolutions 4/5/6, default 5, and one explicitly excluded filename: the previous NASA training sample `sample_viirs_snpp_071223.csv`. That file remains untouched. Every exclusion and its reason appear in the manifest. New archive CSVs are included automatically; review the source inventory before publishing. Empty CSVs and invalid headers are reported as file errors, with no accepted rows; malformed data rows are counted as rejected. Disk/read/database failures stop processing rather than being disguised as rejected NASA rows.

Custom directories/configuration:

```powershell
node scripts/history/prepare.mjs --raw data/raw --out public/data/history --work data/processed --config scripts/history/config.json
```

Output and work directories must be outside the raw source tree. Make sure the work disk has room for canonical points, all source-row associations, H3 assignments, indexes and temporary SQL sorting. File size, not browser limits, determines preprocessing capacity. There is no claim that global/multi-decade throughput has been measured.

## Processing and deduplication

1. Hash each original file (SHA-256), preserve relative filename, byte size, original header schema and adjacent readme text/hash.
2. Stream PapaParse rows into disk-backed SQLite. Reuse `src/data/normalize.ts` exactly: finite WGS84 coordinates, valid calendar date, valid HHMM acquisition time interpreted in UTC, normalized instrument/platform aliases. VIIRS archive `instrument=SNPP` remains VIIRS even when its thermal column is named `brightness`. Source instrument/satellite strings remain in the payload.
3. Deduplicate on `sensor|platform|UTC timestamp|latitude|longitude`, the same identity used by browser imports. First relative-path file, then first data row wins, including revised source versions. This is an explicit operational rule, not an assertion that the oldest product is scientifically preferable. Resolution or FRP is not part of the key; future reprocessing studies should deliberately choose a version policy and rebuild.
4. Store every valid row in SQLite `provenance`, including source ID, data-row ordinal (excluding header), version, original attributes, duplicate flag, and conflicting-payload flag. Canonical `observations` has one retained point per identity; `cells` holds direct H3 assignments at every selected resolution. Conflicting payloads do not silently replace the winner. Original CSVs remain the ultimate lossless source, including rejected rows.
5. Commit in 10,000-row batches, with disk indexes/deduplication and disk temporary storage. Hash sources again after reading; a changed input aborts the run. Optional supplied confidence, FRP, thermal, day/night, scan/track and type attributes have separate missing/invalid tallies. Invalid optional fields do not reject an otherwise valid geolocated/time-stamped detection, matching browser normalization. Missing whole columns are visible in the preserved schema; missing tallies concern columns actually supplied. The first 50 row errors per source are retained as diagnostic examples; total rejection counts are complete.
6. Aggregate each retained record once at each resolution. Group by UTC day, sensor, platform, version, winning source, original day/night flag and H3 cell. Monthly/yearly summaries retain sensor/platform identity. Count reconciliation is required separately at each resolution; never sum across resolutions to obtain observations.

## Spatial interpretation

H3 is a spherical hierarchical index, **not an equal-area projection**. Resolutions 4, 5 and 6 have average hexagon areas about 1,770.35, 252.90 and 36.13 km², respectively. Actual cell areas vary, and pentagons exist. Each monthly geometry partition provides actual `areaKm2` from H3. Direct `latLngToCell` is calculated independently at each resolution; geometric containment is not inferred from a truncated child index. These sizes were chosen as exploratory sensitivity scales, not validated fire-event matching distances. See [H3 cell statistics](https://h3geo.org/docs/core-library/restable/) and [hierarchical containment limitations](https://h3geo.org/docs/3.x/highlights/indexing/).

All loaded points without a region restriction reconcile exactly to the point totals. A historical bounds query includes entire cells **whose centers fall inside the bounds**. It is approximate at boundaries: it can omit interior points in a cell centered outside, and include exterior points in a cell centered inside. Antimeridian bounds are supported. No fractional area weighting or density interpretation is applied. The existing map uses individual point bounds and remains exact for loaded coordinates.

Exact local point queries stream NDJSON without loading all results in memory:

```powershell
$firelensDb = (Get-Content data/processed/latest-benchmark.json | ConvertFrom-Json).database
node scripts/history/query.mjs --database $firelensDb --start 2024-02-01 --end 2024-03-01 --sensor MODIS --platform Terra --bounds=-105,25,-93,37 > data/processed/focused.ndjson
```

Bounds order is west,south,east,north; endpoints are inclusive, and acquisition dates are UTC. Use `--bounds=...` with the equals sign for negative coordinates. The local database also supports inspecting duplicate source rows. It is not shipped to Vercel. Detailed browser point fetching from this database is **not implemented**: the existing browser workspace still uses its verified demo/imported CSVs, with the original 100,000-point guard.

## Static format and repository

`public/data/history/latest.json` points to an immutable content-version directory and SHA-256 manifest. The version includes input filenames/hashes/readmes, configuration, pipeline/normalizer implementation hashes, rules version and H3 library version. Timestamps, runtime measurements and machine-specific database paths are intentionally outside deterministic assets.

Each month/resolution has:

- A gzip JSON daily-count array, sorted by all aggregation keys.
- A separate gzip cell-center/area registry for that month/resolution.
- Compressed and decoded SHA-256, byte size and row count in the manifest.

The manifest retains source metadata, quality tallies, monthly/yearly summaries, record extents, available resolutions, caveats and source-specific distributions. A count row references its winning source; the local source-row association table preserves additional duplicate/revised-file contributors. The public file hashes and original relative paths allow tracing back to each retained source. Raw duplicate payloads are deliberately not replicated into the public bundle.

`StaticHistoryRepository` reads a manifest and queries relevant monthly partitions sequentially. Date, sensor and platform filtering are exact for stored count keys; bounds filtering uses the disclosed center approximation. It verifies decoded integrity even if a server auto-decompresses gzip. Each compressed/decoded response is limited to 32 MiB; metadata to 8 MiB. No unbounded partition cache or point inflation is used. The result is compatible with separate-sensor activity rows, including null unknown/excluded periods and partial-interval status. Zero means no retained records in the loaded record-date interval; it does not assert coverage.

The Methods & provenance preview uses this repository for a monthly-by-year calendar and timeline, independently of browser imports. Shared study filters apply; a selected month focuses its chart. A separate platform selector and H3 selector apply to this preview. Precomputed sensor-analysis tables explicitly retain their full archive-study scope. The primary map/calendar and all existing detailed exports remain on loaded points, avoiding mixed-source or phantom point inspection.

For much larger global archives, month-only partitions may exceed the 32 MiB query budget. A spatially partitioned manifest or a query backend is a future extension; current code fails clearly rather than raising browser limits. The pipeline streams raw points, but SQL aggregation/sorting still needs disk and runtime; public manifests and per-month buffers grow with the collection. H3 geometry is partitioned to avoid a mandatory global in-memory registry.

## Integrity, reproducibility and deployment

`history:verify` verifies every referenced compressed/decoded partition, row counts, per-sensor totals at all spatial scales, monthly/yearly reconciliation, manifest SHA, and analysis version/integrity. It runs before production builds. The existing demo verifier still verifies original NASA bytes. `build:clean` copies only code and public assets to a temporary tree, verifies both datasets before/after building, and has no `data/raw` dependency. Vercel serves static JSON/gzip alongside the current deployment strategy; no new service, secret or backend is required.

Only the active generated version should be prepared for source control/deployment; remove obsolete generated versions deliberately after verifying the active pointer. Never commit local SQLite/WAL/SHM files or raw archives. They are ignored. No commits, pushes, or deployment were performed during this iteration.

Tests: `history:test` uses tiny synthetic fixtures only in temporary test directories, including multiple years/platforms, revised duplicate products, malformed dates/coordinates, empty/invalid files, source preservation, exact antimeridian filtering, daily/cell reconciliation and byte-identical repeated output. A separate authentic-archive integration test reconciles all 54,191 observations at every H3 resolution. Browser repository tests cover original-point date reconciliation, missing periods, platform selection, approximate regions, auto-decompression and integrity rejection. Existing tests continue to cover imports, point filters, calendar selections and exports.

## Measured development run

Current sources: 4,416,196 original CSV bytes, 54,191 retained records. Final preparation measurement: 45.43 s, process peak RSS 104.14 MiB; compressed count plus geometry partitions: 1,078,672 bytes across all three resolutions. The first concurrent pipeline/integration-test run took 55.74 s; this illustrates machine/load dependence, not a speed guarantee. Sensor analysis took 30.76 s, peak RSS 82.74 MiB. Runtime details are in ignored `data/processed/latest-benchmark.json` and `analysis-benchmark.json`; deterministic results are in versioned public assets. Browser interaction measurements are recorded by the production research browser test in `.impeccable/review/history-browser-benchmark.json`. Do not extrapolate these regional one-year measurements to millions of points.

## Primary definitions

[FIRMS downloads](https://firms.modaps.eosdis.nasa.gov/download/), [MODIS attributes](https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_MODIS_Firehotspots.html), [VIIRS attributes](https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_VIIRS_Firehotspots.html). Processing records documents what was supplied; a NASA-shaped CSV is not cryptographic proof of origin. The study archives were supplied by the user following approved NASA archive requests.

## Final verification evidence

The final production browser suite passed all seven tests in 51.8 seconds. It verified the existing map clicks, region drawing, removal/reimport, source validation, linked filters and downloads, plus the aggregate preview, platform totals, unknown periods, integrity failure and responsive widths. The last browser measurement was 3,595 ms to load the original 54,191-point study, 415 ms for a full-year aggregate query, and 344 ms for a platform query including the control change. These end-to-end timings are machine/network/load dependent; the UI's displayed query timing excludes the browser automation overhead.

All 24 Vitest data/repository/baseline tests passed. Pipeline checks passed for empty/invalid-only sources, multi-year deterministic fixtures, and authentic-archive reconciliation at every resolution. The exact CLI query was also exercised against the local source store (805 Aqua records for the documented regional/date validation selection). TypeScript and production build passed; the clean-source build verified both static datasets with no raw directory. The existing large MapLibre chunk warning remains. The historical research desktop/mobile captures are `.impeccable/review/history-desktop.png` and `history-mobile.png`; no design-rule suppressions were added.
