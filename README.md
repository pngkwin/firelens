# FireLens

A scientific workspace for exploring authentic NASA FIRMS active-fire observations across geography, time, and sensor. Raw MODIS and VIIRS observations remain separate; no scientific harmonization or anomaly model is applied.

## Run locally

Use Node.js 22.12 or newer (verified here with Node 26).

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The default study loads a versioned, hash-verified bundle of the complete supplied historical archives. Both development and production builds verify this bundle; no data/raw directory or judge upload is needed.

```sh
npm test
npm run test:e2e
npm run build
npm run preview
```

Browser tests use installed Microsoft Edge in headless mode. To use another Playwright browser, change `channel` in `playwright.config.ts` and install the corresponding browser. Archive tests use the byte-identical versioned bundle, so the original files are not required in a clean checkout.

## Current real observations

| Source file                   | Instrument                | Platforms               | Retained records | UTC record extent     |
| ----------------------------- | ------------------------- | ----------------------- | ---------------: | --------------------- |
| fire_archive_M-C61_850214.csv | MODIS Collection 6.1      | Terra 3,596; Aqua 3,231 |            6,827 | 2024-01-01–2024-12-31 |
| fire_archive_SV-C2_850215.csv | VIIRS Collection 2, 375 m | S-NPP                   |           47,364 | 2024-01-01–2024-12-31 |

Both validated with zero rejected rows and zero duplicate observations. These are user-supplied approved FIRMS archive downloads. Originals are unchanged. Full schemas, coordinates, hashes, and monthly/platform counts are in `docs/data-inventory.json`.

The current regional subset is not a product restriction. Other regions, dates, and VIIRS platform identities can be imported through the same pipeline. The application starts with empty import guidance when no historical files are available.

## Data semantics

- FIRMS archive and near-real-time CSV variants are supported. The archive uses `instrument=SNPP` and `satellite=SNPP` for VIIRS S-NPP and labels its thermal columns `brightness` and `bright_t31`; the normalization layer preserves these original labels and the source identity alongside canonical VIIRS/S-NPP identity.
- Latitude and longitude are WGS84 geographic coordinates. `acq_date` and zero-padded `acq_time` are interpreted as UTC. Invalid coordinates, times, dates, incompatible satellite/instrument pairs, and structurally malformed rows are rejected and reported.
- Confidence stays source-specific. No common numerical confidence threshold is applied. FRP, thermal fields, day/night, source version, and type code are retained when supplied. All supplied source type codes are included; no vegetation-only filter is applied.
- Calendar cells count records for one instrument. Timeline series and comparison totals remain separate. The common comparison interval is the intersection of loaded sensor record extents and study dates, not proof of matched satellite coverage.
- A zero is a count of matching records in the loaded dataset, never evidence that no fire occurred. Coverage is unknown; periods outside loaded record extents are marked separately.
- Exact-file SHA-256 checks prevent repeated imports. Observation keys combine instrument, platform, UTC timestamp, and coordinates. First imported observations win even across versions; overlapping records are reported rather than added twice. If you remove the first dataset, skipped overlaps are not automatically restored; reimport the later original if needed.
- User imports are schema-validated but are not authenticated as NASA-origin files. Bundled files are checked against inspected SHA-256 hashes at runtime.

Official sources: [FIRMS archive](https://firms.modaps.eosdis.nasa.gov/download/), [archive README and disclaimer](https://firms.modaps.eosdis.nasa.gov/download/Readme.txt), [active-fire products](https://firms.modaps.eosdis.nasa.gov/content/active_fire/), [NASA data-ingest tutorial](https://firms.modaps.eosdis.nasa.gov/content/academy/data_ingest/firms_data_ingest.html). Basemap: [OpenFreeMap](https://openfreemap.org/quick_start/), with OpenMapTiles/OpenStreetMap attribution retained by MapLibre. Maps need network access and WebGL; the observation table provides a non-map inspection path.

## Architecture and limits

`src/data/` owns parsing, normalization, a replaceable data repository, filtering, and time aggregation. CSV validation runs in a Web Worker. `src/state/StudyContext.tsx` owns one shared study state. Reusable views in `src/components/` consume its scoped and focused observations. MapLibre renders clustered GeoJSON, without individual React markers. Map and chart code are loaded separately from the shell; fonts are self-hosted.

Limits: 25 MB per CSV, 100,000 retained records per workspace. The entire supported regional dataset remains in memory; large multi-decade work needs preprocessing or a backend query repository. Imports and removals last for the browser session; reloading restores bundled archives. Region drawing currently uses a two-corner bounding box, with manual coordinate entry and antimeridian support as an accessible alternative. Polygon workflows and persistent project storage remain outside this version. Current-scope CSV, provenance JSON and calendar PNG exports are implemented.

## Research refinements and exports

The established workspace remains intact. Map clusters show actual numeric record counts and zoom on selection. Calendar cells use labeled linear count ranges and strong selected-month outlines. Partial record/date intervals have an asterisk; zero matching records, unavailable intervals, and instrument-not-loaded states remain distinct. Up to 25 calendar years render per page, with automatic expansion as date ranges or datasets change.

Sensor comparison honors the global sensor filter. Its monthly disclosure provides aligned instrument counts, within-instrument monthly shares, platform counts, and highest loaded monthly counts. Comparisons use the overlapping record-date intervals and the same geographical scope; they are descriptive and do not calibrate sensors. No scatter regression, correction coefficient or historical anomaly is calculated.

Export opens an in-flow panel. Observations CSV contains exactly the active region/date/sensor/selected-month records, with original confidence values, thermal attributes, acquisition UTC time, source names/hashes, and filter metadata. Monthly CSV has separate sensor counts and explicit unavailable/excluded/partial statuses. Provenance JSON captures the full study metadata. Calendar PNG includes its instrument, date range, count scale, sources, hashes and scientific limitations; its instrument defaults to the calendar selection. CSV strings are protected against spreadsheet formula injection.

## Deployment and source preservation

The application loads `public/data/demo/v1/manifest.json` and two compressed original CSVs. The **0.95 MiB** versioned demonstration contains all **54,191** observations, never a smaller sample: MODIS 6,827 and VIIRS S-NPP 47,364. Original and compressed SHA-256 hashes, original schema, date/geographic limits, platforms and provenance are recorded. Runtime checks original bytes, parse counts, rejected rows and duplicates before accepting a bundle. It supports both explicit gzip files and hosting servers that transparently decode gzip.

Large originals stay in ignored `data/raw/`; uncompressed public copies have been removed. The small compressed distribution bundle and its manifest are deliberately eligible for source control. **Include the versioned bundle when you commit the application yourself. No commit or deployment was performed automatically.** The bundle contains public NASA observations and source metadata, no credentials. A fresh checkout that includes these versioned files opens with the full demonstration; a missing/corrupt bundle causes verification to fail rather than quietly shipping an empty demo.

`npm run data:verify` checks the public bundle. `npm run build` runs that verification before building, and `node scripts/verify-demo.mjs --dist` checks production bytes. `npm run build:clean` copies only application source and the versioned bundle into a temporary checkout with **no data/raw or uncompressed archives**, builds it, and verifies the output. Installed dependencies are reused by a local junction; this is a clean source/data build, not a separate dependency install.

Vercel: Vite framework, build command `npm run build`, output `dist`. See [deployment verification](docs/deployment.md). No backend or key is needed for the demonstration. Preserve immutable bundle versions; future imported records work through the same pipeline without changing the interface.

To deliberately regenerate v1 from the inspected originals, use `npm run data:bundle` (tested with Node 26); it checks the original hashes against the inventory. Do not change a published version's scope silently. Prepare a new version for a different demonstration. `data:prepare` is retained as a verification alias and no longer regenerates data from ignored files.

Remaining limits: session-only imports, 25 MB per file, 100,000 retained observations, network/WebGL for the basemap, unknown satellite observation coverage, and no validated harmonization. Physical-device and assistive-technology certification are not claimed.

Historical preprocessing is now available: `npm run history:prepare`, `npm run history:analyze`, and `npm run history:verify`. It streams nested archive CSVs into a local SQLite store and publishes hash-verified daily H3 partitions plus monthly/yearly summaries. Methods & provenance contains real-data sensor analysis and a separate aggregate calendar/timeline preview. It does not load aggregate cells as individual hotspots or mix them into point exports.

See [historical pipeline and future-archive instructions](docs/historical-data-pipeline.md), [quality audit and measured findings](docs/data-quality.md), and [harmonization research plan](docs/harmonization-methodology.md). Node 22.18+ is required for preprocessing. Run `npm run history:test` for multi-file/determinism and authentic-archive reconciliation tests; `npm test` covers browser data/repository and baseline utilities. Additional historical years and exposure metadata are still needed before validating calibration or historical anomalies.
