# FireLens

A scientific workspace for NASA FIRMS active-fire observations from November 2000 to the present. It has two parts:

- **Fire calendar** (default view): a harmonized MODIS-equivalent calendar of fire-cell-days for the United States and the Iberian Peninsula. It is built from a static, hash-verified v2 bundle (`public/data/v2/<region>`), with near-real-time days added by an optional Convex backend. Raw per-sensor scales stay available next to the harmonized ones. The harmonization method and its validation are in [docs/harmonization-method.md](docs/harmonization-method.md) and [docs/harmonization-validation.md](docs/harmonization-validation.md).
- **CSV workspace** (`#workspace`, plus the `#datasets` and `#methods` tabs): the original point-level workspace for FIRMS CSV files. Raw MODIS and VIIRS observations stay separate there; no harmonization is applied. The v1 demonstration bundle (`public/data/demo/v1`) loads only when you open one of these tabs.

Stack: Vite 7, React 19, TypeScript, Tailwind 4, MapLibre, Recharts, h3-js, Convex (optional backend).

## Run locally

Use Node.js 22.18 or newer (`engines` in `package.json`; the ingest and history scripts need it).

```sh
npm install
npm run dev        # http://127.0.0.1:5173; runs data:verify first
```

The calendar works with no backend and no key: it reads the committed v2 bundle. To show live near-real-time days and enable the hotspot point export, put the Convex URLs in `.env.local`:

```sh
VITE_CONVEX_URL=https://<deployment>.convex.cloud
VITE_CONVEX_SITE_URL=https://<deployment>.convex.site
```

These two URLs are public; they are the only environment values the browser bundle reads (`src/data/v2/live.ts`). Without them the app shows "live backend not configured" and keeps working from the static bundle.

If `node_modules` was installed on another OS (for example Linux in a VM), delete it and reinstall on the machine you run from; native binaries are platform-specific.

**Windows line endings.** The calendar checks that `calibration.json` was fitted on the exact bytes of `manifest.json` (SHA-256), and the history preview checks its manifests the same way. A checkout with `core.autocrlf=true` rewrites these JSON files with CRLF, so the hashes no longer match: the calendar refuses to load ("calibration was fitted on a different manifest") and 21 vitest tests fail. Until the repo has a `.gitattributes` rule for `public/data/**`, clone with `git -c core.autocrlf=false clone …` (or set `core.autocrlf false` and re-checkout `public/data`). Never deploy a build made from a CRLF checkout.

## Views

| View | URL | Data |
|---|---|---|
| Fire calendar (default) | `/` with query state, e.g. `?r=us&aoi=preset:us-06&from=2012-01&to=2026-11&scale=modis-eq&focus=2026-11` | `public/data/v2/<region>`, `public/data/presets/<region>.json`, live days from Convex |
| CSV workspace | `#workspace` | v1 demo bundle and user-imported FIRMS CSVs (browser session only) |
| Datasets | `#datasets` | loaded CSV datasets and their provenance |
| Methods & provenance | `#methods` | method notes and the `public/data/history` aggregate preview |

Fire calendar scales: MODIS-equivalent (harmonized, primary), VIIRS-level (harmonized, S-NPP scale), raw fire-cell-days (any sensor, MODIS, VIIRS) and raw hotspot counts (MODIS, VIIRS). Areas: whole region, a state (US) or country (Iberia) preset, a bounding box, a point and radius, or a polygon drawn on the map. Exports: harmonized monthly CSV, provenance JSON, calendar PNG, and (with the backend) a capped hotspot point CSV.

## npm scripts

### App and checks

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on 127.0.0.1:5173 (runs `data:verify` first) |
| `npm run build` | `data:verify`, `history:verify`, `ingest:verify`, then `tsc -b` and `vite build` to `dist/` |
| `npm run preview` | serve `dist/` on 127.0.0.1:4173 |
| `npm test` | vitest: `src/**/*.test.ts` and `convex/**/*.test.ts` |
| `npm run test:e2e` | Playwright (`tests/*.spec.ts`); builds first, uses installed Microsoft Edge (`playwright.config.ts`) |
| `npm run build:clean` | builds from a temporary source-only copy and verifies the output |

### v1 demo and history preview (CSV workspace)

| Script | What it does |
|---|---|
| `npm run data:verify` | checks the immutable v1 demo bundle (`public/data/demo/v1`) |
| `npm run data:bundle` | deliberately regenerates a demo bundle from the inspected originals (new version only) |
| `npm run data:prepare` | verification alias kept for compatibility |
| `npm run history:prepare` / `history:analyze` / `history:verify` | historical SQLite preprocessing into `public/data/history` ([docs](docs/historical-data-pipeline.md)) |
| `npm run history:test` | `node --test` pipeline tests |

### v2 ingest pipeline (Fire calendar)

| Script | What it does |
|---|---|
| `npm run ingest:download -- --region <id>` | resumable FIRMS area-API download into `data/raw/firms-api/<region>/` (one gzip CSV per source × box × ≤5-day window; budgeted against the 10-minute transaction limit; writes `progress.log`, `ledger.jsonl`, `failures.jsonl`, and freezes `availability.json` + `plan-end.json`; `--replan` extends the plan). Needs `FIRMS_MAP_KEY`. |
| `npm run ingest:supervise -- --regions us,iberia` | runs the downloader per region, restarting it until no window failed; logs counts to `data/raw/firms-api/supervisor.log` |
| `npm run ingest:aggregate -- --region <id>` | aggregates downloaded windows (and imported archive windows, if present) into fire-cell-day histograms in `data/processed/agg/<region>/` (static-source mask, region clip, per-month status) |
| `npm run ingest:publish -- --region <id>` | writes the hash-listed v2 bundle to `public/data/v2/<region>/` (replaces the whole directory, including `calibration.json`); refuses incomplete months unless `--allow-partial` |
| `npm run ingest:verify` | `scripts/ingest/verify-v2.mjs`: file sizes and SHA-256 hashes, row counts, and exact reconciliation (shards = region totals, daily = monthly, zones, cell index, overview) for every published region |
| `npm run ingest:test` | `node --test` for `plan.mjs` and `aggregate-core.mjs` |

Other scripts (no npm alias):

| Command | What it does |
|---|---|
| `node scripts/build-presets.mjs` | writes `public/data/presets/<region>.json` (US states + DC from us-atlas; Spain and Portugal from world-atlas). `ingest:publish` reads it to build `aoi/<preset>.json.gz`. |
| `node scripts/ingest/import-archive.mjs --region <id>` | optional: splits FIRMS Archive Download CSVs (`data/raw/firms-archive/<region>/DL_FIRE_*`) into the downloader's window layout so `aggregate` uses them for science-quality sources |
| `node scripts/ingest/compare-archive.mjs --region <id>` | optional: checks archive rows against API windows on overlapping dates |
| `node scripts/harmonize/fit.mjs --region <id> [--train 2012-2021] [--kappa 20]` | fits and validates the harmonization; writes `public/data/v2/<region>/calibration.json` and `data/processed/harmonize/<region>-validation.json` |

### Convex backend

| Script | What it does |
|---|---|
| `npm run convex:region-data` | regenerates `convex/regionData/<id>.json` (boxes, compacted res-7 clip, static mask, `bundleEnd`) from the published bundle and `data/processed/agg/<id>/static-cells.json` |
| `npm run convex:set-key` | copies `FIRMS_MAP_KEY` to the Convex deployment over stdin (`-- --prod` for production); output redacted |
| `npm run convex:push` | `convex dev --once`: type-checks and deploys the functions to the dev deployment |
| `npm run convex:pull` | `convex run pull:pullAll`: runs the near-real-time pull now instead of waiting for the daily cron |

See [docs/convex.md](docs/convex.md) for tables, limits and the export endpoint.

### Typical order for a new or extended region

1. Add or edit the region in `config/regions.json`; run `node scripts/build-presets.mjs` once if presets change.
2. `npm run ingest:download -- --region <id>` (or `ingest:supervise`). Optionally `import-archive` for archive downloads.
3. `npm run ingest:aggregate -- --region <id>`
4. `npm run ingest:publish -- --region <id>`
5. `npm run ingest:verify`
6. `node scripts/harmonize/fit.mjs --region <id>`. Always refit after publishing: publish deletes the old `calibration.json`, and the app rejects a calibration whose `inputManifestSha256` does not match the manifest.
7. `npm run convex:region-data`, then `npm run convex:push`, so the backend's `bundleEnd`, clip and mask match the new bundle.

Steps 2–4 and 7 need `data/raw` and `data/processed`, which are not in Git.

## v2 data layout

`public/data/v2/<region>/` (written by `scripts/ingest/publish.mjs`, except `calibration.json`):

| File | Contents |
|---|---|
| `manifest.json` | region and boxes, product definition (unit, platform bits, static mask, clip rule, zero meaning), sources with availability, `planEnd`, archive provenance, per-month status and tallies, code hashes, and every file with `bytes`, `sha256` (gzip), `decodedSha256` (JSON) and `rows` |
| `calibration.json` | harmonization coefficients, method selection, intervals and the fit's own `regionSeries` (written by `fit.mjs`; bound to the manifest by `inputManifestSha256`) |
| `region-monthly.json.gz` | whole-region totals per month |
| `region-daily.json.gz` | whole-region totals per UTC day |
| `zone-monthly.json.gz` | res-1 zone × month totals (the calibration's spatial unit) |
| `cells.json.gz` | res-5 cell index per res-1 shard (plans AOI downloads) |
| `overview.json.gz` | res-3 cell × year raw fire-cell-days (any sensor, MODIS, VIIRS) for the map |
| `monthly/<res1>.json.gz` | res-5 cells × months, one file per res-1 shard |
| `daily/<res1>/<year>.json.gz` | res-5 cells × days, per shard and year |
| `aoi/<preset>.json.gz` | zone × month aggregates for each state/country preset |

`public/data/presets/<region>.json` holds the preset polygons. Each partition is `{v: 2, region, kind, res, shard, periods, cells, rows}`; rows are wire rows (`src/data/v2/codec.ts`) with day, night and any-time platform-mask histograms plus detections and FRP per platform. The browser (`src/data/v2/bundle.ts`) checks every partition against the manifest hash and row count before use. Current bundles: US 1,029 files (~49 MB), Iberia 119 files (~3.3 MB), both 2000-11 to 2026-11-14.

The unit is the **fire-cell-day**: one H3 resolution-8 cell (~0.74 km²) on one UTC day with at least one detection. Sensors are combined as a union of platform masks, never a sum of detections. Detections belong to a region when the centre of their H3 res-7 cell lies inside the boundary polygon; persistent static sources (volcanoes, industry, offshore) are masked. A zero is no matching records in the loaded data, never evidence that no fire occurred.

## Live layer and the FIRMS key

The Convex backend (`convex/`) pulls FIRMS near-real-time data daily at 07:15 UTC, aggregates it exactly like the offline pipeline, and stores only aggregates for days after the bundle's `planEnd`. It also serves a capped point export at `{VITE_CONVEX_SITE_URL}/hotspots.csv`. Details: [docs/convex.md](docs/convex.md).

Key rules:

- The FIRMS MAP_KEY lives only in `.env.local` as `FIRMS_MAP_KEY` (gitignored) and as the Convex deployment environment variable `FIRMS_MAP_KEY`. Local scripts read `process.env.FIRMS_MAP_KEY` first, then `.env.local`.
- Never print, log, commit or paste the key, and never give it a `VITE_` prefix (that would ship it to every browser). Scripts and Convex functions pass error text through `redact()`; `convex:set-key` sends it over stdin.
- The browser never sees the key: it reads public aggregates from Convex queries and fetches points through the Convex HTTP endpoint.

## Tests

| Command | Count (Windows, LF checkout, no `data/raw`) |
|---|---|
| `npm test` (vitest) | 18 files, 137 tests: 136 pass, 1 skipped (the NRT-vs-bundle equality test in `convex/lib/nrtCore.test.ts` needs `data/raw/firms-api/us`). `src/data/v2/perf.test.ts` asserts sub-second AOI queries and can fail on a loaded machine. |
| `npx tsc -b` | type check, no errors |
| `npm run ingest:test` | 14 tests |
| `npm run history:test` | 3 tests: 2 pass, 1 skipped without the original 2024 archive CSVs in `data/raw` |
| `npm run ingest:verify` | US and Iberia: 313/313 complete months, OK |
| `npm run test:e2e` | 4 spec files, 12 tests: `tests/calendar.spec.ts` (5: default calendar and keyboard grid, preset AOI, Iberia quantile mapping, exports, bounding-box form and invalid URL), `workspace.spec.ts` (3), `enhancements.spec.ts` (2), `history.spec.ts` (2) |

## CSV workspace (v1) data semantics

The CSV workspace keeps the original point-level behaviour.

| Source file | Instrument | Platforms | Retained records | UTC record extent |
|---|---|---|---:|---|
| fire_archive_M-C61_850214.csv | MODIS Collection 6.1 | Terra 3,596; Aqua 3,231 | 6,827 | 2024-01-01–2024-12-31 |
| fire_archive_SV-C2_850215.csv | VIIRS Collection 2, 375 m | S-NPP | 47,364 | 2024-01-01–2024-12-31 |

Both validated with zero rejected rows and zero duplicate observations. Full schemas, coordinates, hashes and monthly/platform counts are in `docs/data-inventory.json`.

- FIRMS archive and near-real-time CSV variants are supported. The archive uses `instrument=SNPP` and `satellite=SNPP` for VIIRS S-NPP and labels its thermal columns `brightness` and `bright_t31`; the normalization layer keeps these labels and the source identity alongside the canonical VIIRS/S-NPP identity.
- Latitude and longitude are WGS84. `acq_date` and zero-padded `acq_time` are UTC. Invalid coordinates, times, dates, incompatible satellite/instrument pairs and malformed rows are rejected and reported.
- Confidence stays source-specific; no common numerical threshold is applied. FRP, thermal fields, day/night, source version and type code are kept when supplied. No vegetation-only filter is applied.
- Calendar cells count records for one instrument. The common comparison interval is the intersection of loaded sensor record extents and study dates, not proof of matched satellite coverage.
- A zero is a count of matching records in the loaded dataset, never evidence that no fire occurred. Periods outside loaded record extents are marked separately.
- Exact-file SHA-256 checks prevent repeated imports. Observation keys combine instrument, platform, UTC timestamp and coordinates; first imported observations win, and overlaps are reported rather than added twice.
- User imports are schema-validated but not authenticated as NASA-origin files. Bundled files are checked against inspected SHA-256 hashes at runtime.

Architecture: `src/data/` owns parsing, normalization, the replaceable repository, filtering and time aggregation; CSV validation runs in a Web Worker; `src/state/StudyContext.tsx` owns the study state; views live in `src/components/`. Limits: 25 MB per CSV, 100,000 retained records per workspace, session-only imports, two-corner bounding boxes with manual coordinate entry. Exports: observations CSV, monthly CSV, provenance JSON and calendar PNG, with CSV strings protected against spreadsheet formula injection.

The v1 bundle (`public/data/demo/v1/manifest.json` plus two compressed original CSVs, 0.95 MiB, all 54,191 observations) is immutable. `npm run data:verify` checks it, `node scripts/verify-demo.mjs --dist` checks production bytes, and `npm run data:bundle` regenerates a bundle from the inspected originals for a **new** version only.

## Deployment

Vercel: Vite framework, build command `npm run build`, output `dist`. `vercel.json` sets long cache lifetimes for `/data/v2/**` (the client re-fetches with `cache: "reload"` when a hash does not match) and revalidation for each region's `manifest.json` and `calibration.json`. See [deployment verification](docs/deployment.md). The calendar needs no backend; set `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` in the hosting environment to enable the live layer and point export.

Official sources: [FIRMS archive](https://firms.modaps.eosdis.nasa.gov/download/), [archive README and disclaimer](https://firms.modaps.eosdis.nasa.gov/download/Readme.txt), [active-fire products](https://firms.modaps.eosdis.nasa.gov/content/active_fire/), [NASA data-ingest tutorial](https://firms.modaps.eosdis.nasa.gov/content/academy/data_ingest/firms_data_ingest.html). Basemap: [OpenFreeMap](https://openfreemap.org/quick_start/), with OpenMapTiles/OpenStreetMap attribution kept by MapLibre. Maps need network access and WebGL; the area forms, tables and calendars work without them.

## Further documentation

- [Harmonization method](docs/harmonization-method.md) and [validation](docs/harmonization-validation.md)
- [Convex backend](docs/convex.md)
- [Historical pipeline](docs/historical-data-pipeline.md), [data quality](docs/data-quality.md), [earlier harmonization research plan](docs/harmonization-methodology.md)
- [Review findings: security and accessibility](docs/review-findings.md)
