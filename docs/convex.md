# Convex backend (live NRT layer + point export)

The deep history (2000-11 → bundle `planEnd`) ships as the static, hash-verified `public/data/v2/<region>` bundle. Convex adds only what a static bundle cannot do:

1. a **daily near-real-time pull** that extends each region past the bundle end, and
2. a **capped HTTP export** of raw hotspot points, so the FIRMS key never reaches the browser.

Deployment: project `firelens`, dev deployment `vivid-mammoth-378` (URLs in `.env.local` as `VITE_CONVEX_URL` / `VITE_CONVEX_SITE_URL`; not secret). The FIRMS key exists only as the Convex environment variable `FIRMS_MAP_KEY`.

## What is stored (aggregates only)

| Table | One row per | Contents |
|---|---|---|
| `nrtDayTotals` | region × UTC day after `bundleEnd` | whole-region `WireRow` (same codec as v2), fine cell-days, retained detections, products fetched, `fetchedAt` |
| `nrtDayCells` | region × day | res-5 `V2Partition` JSON for AOI queries (~70 bytes per fire cell; 11.6 KB for 2026-11-15 US) |
| `meta` | key | FIRMS `data_availability` (refreshed by each pull) |
| `firmsLedger` | reservation | FIRMS transactions spent from Convex (kept 24 h) |
| `runs` | pull | outcome, range, days, detections, transactions, key-redacted error, aggregation `stats` (JSON) |

No raw FIRMS rows are written anywhere. Days ≤ `bundleEnd` are deleted after each successful pull (`ingest:prune`, up to 500 rows per table per run; the bundle is authoritative for them), so storage stays at a few MB.

## Daily pull (`convex/pull.ts`, Node runtime)

Cron `firms-nrt-pull`, 07:15 UTC daily → `pull:pullAll` → `pull:pullRegion` for each region (failures are isolated per region).

- **Days:** `pullRange` = every day missing since `bundleEnd` or the newest stored day, plus the last 3 days again (NRT keeps filling for hours), never a bundle day, at most 30 days per run.
- **Products:** NRT sources from `config/regions.json` with the offline stitch rule (`sourceSpans`): MODIS_NRT, VIIRS_NOAA20_NRT, VIIRS_NOAA21_NRT; VIIRS_SNPP_NRT stops at its end of production (2026-11-02).
- **Aggregation:** `dayAggregator` wraps the offline `CellDayAccumulator`, the same H3 res-7 region clip (losslessly compacted, `convex/regionData/<id>.json`) and the same static-source mask. `convex/lib/nrtCore.test.ts` aggregates the raw API windows for 2026-11-12 and reproduces the published US bundle's region total **and every res-5 cell row exactly**. That test is skipped unless `data/raw/firms-api/us` and `convex/regionData/us.json` exist, so it does not run in a clean checkout.
- **All-or-nothing:** any failed FIRMS window aborts the region's run before anything is written. The run (with its key-redacted error) is recorded in `runs`; the next run refetches every missing day.
- **Budget:** the pull reserves its transactions from the same `firmsLedger` 10-minute budget as exports (`purpose: "pull"`). If exports have used it up, the pull fails and the next cron run catches up.
- **Provisional:** a day is flagged `provisional` until 36 h after it starts.
- **Cost:** 2 transactions per window-day; a normal run is 3 products × boxes × 3 days × 2 = 72 transactions for the US (4 boxes) and 18 for Iberia (1 box).

## Point export (`convex/http.ts`)

```
GET {VITE_CONVEX_SITE_URL}/hotspots.csv?bbox=west,south,east,north&start=YYYY-MM-DD[&end=YYYY-MM-DD][&sensors=modis,viirs]
```

- Science-quality (SP) products where available, NRT after, by the same stitch rule, so no date is fetched from both.
- Columns: `source, platform, instrument, latitude, longitude, acq_date, acq_time, daynight, confidence, frp, bright_mir_k, bright_tir_k, scan, track, version, type`. MODIS and VIIRS keep their own confidence scales (numeric vs l/n/h); `type` is empty for NRT.
- Rows are FIRMS records **as published**: not region-clipped and not static-masked (the aggregate products are).
- Response headers: `X-FireLens-Rows`, `X-FireLens-Sources`, `X-FireLens-Transactions`. CORS: `ALLOWED_ORIGINS` env var (comma list), default `*`; a request from an unlisted origin gets the first listed origin back. CORS only restrains browsers: the endpoint has no authentication, so its spending is limited by the ledger instead (per-client hourly limit, an export share of the 10-minute budget that always leaves room for the pull, and a daily cap; see the limits table).

| Limit | Value | Response |
|---|---|---|
| Date span | ≤ 31 days, 2000-11-01 … today (UTC) | 400 |
| Bounding box | valid WGS84, west < east and south < north (split antimeridian boxes) | 400 |
| Sensors | `modis`, `viirs` or both (default both) | 400 |
| Rows | ≤ 50,000 (counted before conversion). Transactions for the whole request are reserved before fetching, so a 413 still counts against both budgets. | 413 |
| FIRMS budget | `FIRMS_TX_PER_10MIN` (default 1,500 of FIRMS's 5,000), shared with the daily pull | 429 + `Retry-After` |
| Export share of that budget | `EXPORT_TX_PER_10MIN` (default 1,000): exports can never take the last 500, so the daily pull (72 US / 18 Iberia) always gets its budget | 429 + `Retry-After` |
| Per-client limit | `EXPORT_TX_PER_CLIENT_HOUR` (default 1,000, rolling hour), keyed by a SHA-256 hash of the first `X-Forwarded-For` address (the address itself is never stored) | 429 + `Retry-After` |
| Daily export budget | `EXPORT_TX_PER_DAY` (default 10,000, rolling 24 h) | 429 + `Retry-After` (24 h) |
| Key missing or FIRMS error | n/a | 502 with a key-redacted message (≤ 300 characters) |

Responses are built inside the 64 MB default runtime: 1-day windows (same transaction cost), at most 3 responses in memory, line-by-line conversion. Measured: a 3-day California NRT export (1,855 rows) and a one-day Iberia export with all four 2025 SP products (3,473 rows) return in about 1 s; a CONUS-wide 10-day request returns 413 in about 1 s.

## Key handling

- Set with `npm run convex:set-key` (add `-- --prod` for the production deployment). It reads the key like the ingest scripts (`FIRMS_MAP_KEY` from the shell environment if set, otherwise `.env.local`) and pipes it to `npx convex env set FIRMS_MAP_KEY` over stdin; CLI output is redacted. The key is never on a command line, in code, in a table or in a response.
- `firmsKey()` and the scripts' `loadKey()` reject a key that is not 32 hexadecimal characters (without printing it).
- Every error string from FIRMS passes `redact()`: the exact key in any letter case, plus any standalone 32-hex token, becomes `<MAP_KEY>` (64-hex SHA-256 values are left alone). `convex/functions.test.ts` asserts this for export errors, availability errors and case-changed echoes.
- CSV cells that start with `= + - @`, tab or CR and are not numbers get a leading `'` (spreadsheet formula guard); negative coordinates are unchanged.
- Public functions (`live:status`, `live:dayTotals`, `live:dayCells`) validate their arguments (known region, `YYYY-MM-DD` dates, at most 16 days per `dayCells` call, at most 400 rows per `dayTotals` result) and only read aggregates. `live:status` also returns each region's last run with a short error class only ("FIRMS unavailable", "FIRMS transaction budget reached", "backend not configured", "pull failed"); the full key-redacted text stays in the internal `runs` table. Everything that spends FIRMS transactions is internal, except the HTTP export, which is public and limited only by the ledger.
- Recorded 2026-11-15 (the scan needs the key, so rerun it before each release): a scan of all 15,537 repo files (including `dist/`, logs and decompressed `.gz` archives, excluding `node_modules` and `.env.local`) found the key in 0 files.

## Operations

```sh
npm run convex:region-data   # after republishing and refitting a v2 bundle: regenerate convex/regionData
                             # (needs data/processed/agg/<id>/static-cells.json; regions without it are skipped)
npm run convex:push          # convex dev --once: typecheck + deploy functions to the dev deployment
npm run convex:set-key       # copy FIRMS_MAP_KEY to the deployment (once; -- --prod for production)
npm run convex:pull          # convex run pull:pullAll: run the NRT pull now instead of waiting for the cron
npx convex run live:status   # last run per region
```

Free-tier budget: about 20 function calls per daily run (1 `pullAll`, then per region `pullRegion`, `setMeta`, `latestDay`, `reserve`, one `writeDay` per day, `prune` and `recordRun`; ≈ 600/month of 1 M). Each export request adds an HTTP action, a query and a mutation. Storage: a few MB of 0.5 GB.
