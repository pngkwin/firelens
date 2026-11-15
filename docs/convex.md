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
| `runs` | pull | outcome, range, counts, key-redacted error |

No raw FIRMS rows are written anywhere. Days ≤ `bundleEnd` are deleted after each pull (the bundle is authoritative for them), so storage stays at a few MB.

## Daily pull (`convex/pull.ts`, Node runtime)

Cron `firms-nrt-pull`, 07:15 UTC daily → `pull:pullAll` → `pull:pullRegion` for each region (failures are isolated per region).

- **Days:** `pullRange` = every day missing since `bundleEnd` or the newest stored day, plus the last 3 days again (NRT keeps filling for hours), never a bundle day, at most 30 days per run.
- **Products:** NRT sources from `config/regions.json` with the offline stitch rule (`sourceSpans`): MODIS_NRT, VIIRS_NOAA20_NRT, VIIRS_NOAA21_NRT; VIIRS_SNPP_NRT stops at its end of production (2026-11-02).
- **Aggregation:** `dayAggregator` wraps the offline `CellDayAccumulator`, the same H3 res-7 region clip (losslessly compacted, `convex/regionData/<id>.json`) and the same static-source mask. `convex/lib/nrtCore.test.ts` aggregates the raw API windows for 2026-11-12 and reproduces the published US bundle's region total **and every res-5 cell row exactly**.
- **All-or-nothing:** any failed FIRMS window aborts the region's run before anything is written.
- **Provisional:** a day is flagged `provisional` until 36 h after it starts.
- **Cost:** 2 transactions per window-day; a normal run is 3 products × boxes × 3 days × 2 = 72 transactions for the US (4 boxes) and 18 for Iberia (1 box).

## Point export (`convex/http.ts`)

```
GET {VITE_CONVEX_SITE_URL}/hotspots.csv?bbox=west,south,east,north&start=YYYY-MM-DD[&end=YYYY-MM-DD][&sensors=modis,viirs]
```

- Science-quality (SP) products where available, NRT after, by the same stitch rule, so no date is fetched from both.
- Columns: `source, platform, instrument, latitude, longitude, acq_date, acq_time, daynight, confidence, frp, bright_mir_k, bright_tir_k, scan, track, version, type`. MODIS and VIIRS keep their own confidence scales (numeric vs l/n/h); `type` is empty for NRT.
- Rows are FIRMS records **as published**: not region-clipped and not static-masked (the aggregate products are).
- Response headers: `X-FireLens-Rows`, `X-FireLens-Sources`, `X-FireLens-Transactions`. CORS: `ALLOWED_ORIGINS` env var (comma list), default `*`.

| Limit | Value | Response |
|---|---|---|
| Date span | ≤ 31 days, 2000-11-01 … today (UTC) | 400 |
| Bounding box | valid WGS84, west < east (split antimeridian boxes) | 400 |
| Rows | ≤ 50,000 (counted before conversion) | 413 |
| FIRMS budget | `FIRMS_TX_PER_10MIN` (default 1,500 of FIRMS's 5,000) | 429 + `Retry-After` |
| Daily export budget | `EXPORT_TX_PER_DAY` (default 10,000) | 429 |

Responses are built inside the 64 MB default runtime: 1-day windows (same transaction cost), at most 3 responses in memory, line-by-line conversion. Measured: a 3-day California NRT export (1,855 rows) and a one-day Iberia export with all four 2025 SP products (3,473 rows) return in about 1 s; a CONUS-wide 10-day request returns 413 in about 1 s.

## Key handling

- Set with `npm run convex:set-key` (pipes `.env.local`'s value to `npx convex env set FIRMS_MAP_KEY` over stdin; output redacted). The key is never on a command line, in code, in a table or in a response.
- Every error string from FIRMS passes `redact()`; tests assert the key cannot appear in an export error.
- Public functions (`live:status`, `live:dayTotals`, `live:dayCells`) validate their arguments and only read aggregates. Everything that spends FIRMS transactions is internal or behind the ledger.
- Verified 2026-11-15: a scan of all 15,537 repo files (including `dist/`, logs and decompressed `.gz` archives, excluding `node_modules` and `.env.local`) found the key in 0 files.

## Operations

```sh
npm run convex:region-data   # after republishing a v2 bundle: regenerate convex/regionData
npm run convex:push          # typecheck + deploy functions to the dev deployment
npm run convex:set-key       # copy FIRMS_MAP_KEY to the deployment (once)
npm run convex:pull          # run the NRT pull now instead of waiting for the cron
npx convex run live:status   # last run per region
```

Free-tier budget: ≈ 25 function calls per daily run (≈ 750/month of 1 M); storage a few MB of 0.5 GB.
