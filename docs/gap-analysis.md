# Gap analysis: FireLens vs. NASA Space Apps 2026 "Harmonization of MODIS and VIIRS Hot Spots"

2026-11-15. Baseline: commit `bd5173e`. Challenge requirements are taken from the user brief (the challenge URL returned HTTP 502 earlier; see `harmonization-methodology.md`).

## Baseline measured today

| Check | Result |
|---|---|
| `npm test` | 24/24 pass |
| `npx tsc -b` | clean |
| `npm run history:test` | **1 failure**: authentic-archive reconciliation expects 54,191 rows, finds 0. `data/raw/` holds only the two `Readme.txt` files; the original CSVs are not on this machine. The test must become data-optional or point at re-downloaded data. |
| FIRMS key | present in ignored `.env.local`; `mapkey_status` OK, limit 5,000 tx / 10 min |

### Real source availability (FIRMS `data_availability`, queried 2026-11-15)

| Source | Start | End | Notes |
|---|---|---|---|
| MODIS_SP | 2000-11-01 | 2026-08-31 | Terra + Aqua, C6.1 |
| MODIS_NRT | 2026-09-01 | 2026-11-15 | stitch after SP end |
| VIIRS_SNPP_SP | 2012-01-20 | 2026-07-31 | historical sensor |
| VIIRS_SNPP_NRT | 2026-08-01 | **2026-11-02** | S-NPP production ended |
| VIIRS_NOAA20_SP | 2018-04-01 | 2026-07-31 | |
| VIIRS_NOAA20_NRT | 2026-08-01 | 2026-11-15 | |
| VIIRS_NOAA21_SP | 2023-03-01 | 2026-07-31 | |
| VIIRS_NOAA21_NRT | 2024-01-17 | 2026-11-15 | **overlaps SP by 2.5 years**: cutover must be at SP max_date, not NRT min_date |

## Requirement-by-requirement

| # | Requirement | Current state | Gap | Severity |
|---|---|---|---|---|
| 1 | Harmonized MODIS+VIIRS calendar, 2000 → present | Only sensor-specific raw counts. 2024 only, one Texas-area box, S-NPP only. Methodology doc explicitly says no harmonization. | No multi-decade data; no harmonized product; no NOAA-20/21 at all. | **Critical** |
| 2 | User-selected AOI by map draw | Two-corner bbox draw on map. | No polygon or circle; no state presets. | High |
| 3 | AOI by lat/lon entry | Manual W/S/E/N entry, antimeridian supported. | No point+radius entry; no paste-GeoJSON. | Medium |
| 4 | Date range | Start/end inputs on loaded points. | Limited to loaded 2024 data; must range over 2000 → present via aggregates. | High |
| 5 | Which months/years had most fire | Calendar years × months; "highest loaded monthly counts" list. | No ranking over the harmonized series; no day-of-year view. | High |
| 6 | Current month vs. historical median | `anomalies.ts` utility (prior-same-month median, quantiles, ≥3 years guard) exists, unit-tested, **never displayed** (always "insufficient history"). | Needs the multi-year harmonized series + UI; percentile rank. Partial current month must be handled (to-date vs same-days-of-prior-months). | **Critical** |
| 7 | Anomaly vs multi-year mean/median | Median + IQR + relative deviation only. | z-score vs mean/SD, % of median, trend (Theil-Sen + Mann-Kendall). | High |
| 8 | Accessible colour ramps | Single 5-step orange sequential ramp (`heat1..5`), linear bins. | Colour-vision-deficiency-safe sequential (e.g. viridis/cividis-like) and diverging (e.g. BrBG / PuOr) ramps; legends with values; non-colour encoding of flags. | Medium |
| 9 | CSV of hotspots | Observations CSV of loaded points (formula-injection safe). | Only for the 2024 demo; needs on-demand AOI × date points from FIRMS (backend, capped). | High |
| 10 | Downloadable analytics/visualisations | Monthly CSV, provenance JSON, calendar PNG for loaded data. | Harmonized monthly CSV with uncertainty + flags; provenance with method version and calibration coefficients; PNG of new calendars. | Medium |
| 11 | Raw sensors kept separate; harmonized product labelled | Raw separation is excellent. | Raw-vs-harmonized toggle; harmonized product clearly labelled. | High |
| 12 | Current/NRT data | None. Static bundle only. | Daily NRT pull (NOAA-20, NOAA-21, MODIS; S-NPP ends 2026-11-02). | High |
| 13 | World-ready architecture | Pipeline is region-agnostic but month-only partitions hit a 32 MiB budget at scale (documented). | Region config + spatially partitioned static data; prove with one non-US region. | High |
| 14 | Shareable state | None. | URL-encoded AOI/date/sensor/mode. | Medium |
| 15 | Performance | 54k points in memory; 100k-point cap; aggregate query 415 ms for 1 year. | AOI query < 1 s over 26 years for the US. Point data cannot be shipped; aggregates must be. | High |
| 16 | Validation of harmonization | Protocol written, no numbers. | Held-out-year validation, overlap agreement statistics, documented limits. | **Critical** |

## What is reusable

- `src/data/normalize.ts`: FIRMS CSV normalization (archive + NRT variants, S-NPP aliasing). Needs NOAA-20/21 aliases checked (`N20`, `N21`, `NOAA-20`, `NOAA-21`, `J1`, `J2` in NRT `satellite` column).
- `src/data/anomalies.ts`: baseline/quantile utility, keyed series discipline.
- `StaticHistoryRepository`: hash-verified static partition reader pattern. Extend with spatial partitioning.
- `exports.ts`: CSV injection protection, provenance shape.
- History pipeline concepts (hashing, determinism, verify-before-build). Its per-row SQLite provenance (~1,200 rows/s measured) is **too slow for ~40 M rows**; the new aggregator must stream to in-memory/disk cell-day aggregates instead.

## Key risks

1. **API truncation or transaction weighting** for large boxes: must measure before committing to the API path (fallback: FIRMS Archive Download via the browser).
2. **Volume**: rough order of 30–50 M VIIRS + ~5 M MODIS detections for US 2000–2026 → several GB of raw CSV (743 GB free).
3. **Observing-system changes**: number of VIIRS platforms changes (1 → 2 → 3 → 2); Terra and Aqua orbits drift (Terra from 2020, lowered Oct 2022; Aqua after leaving the A-Train in 2022). Any harmonized series that ignores these will show artificial trends.
4. **Convex** requires an interactive login and deployment on the user's account.

## Plan additions (2026-11-15, approved after reviewing the NASA challenge brief)

Source: `nasawebchallengeinfo.pdf` (challenge text). Gaps against the brief, in build order (small first):

1. **Anomaly vs multi-year average**: brief: "anomalies against multi-year averages". Show % of mean next to % of median and z-score, in the focus card and exports.
2. **Hotspot-count scale**: brief: "number of hotspots" / "number of fires detected and reported". Add raw detection counts per sensor, and name the harmonized unit "MODIS-equivalent hotspots (~1 km fire-cell-days)".
3. **Early-warning view**: brief: "anticipate critical periods", "early warning". Last 7 / 30 days vs the same window in every prior year; typical fire-season critical periods marked on the calendar; "next 4 weeks historically" outlook.
4. **Performance**: browser cache for the immutable bundle; fetch/verify/parse in a Web Worker; per-zone daily totals (`zone-daily`) for large areas.
5. **Current fire vs past fires**: brief: "how a current fire compares with previous ones". Group detections into fire events (space–time connected fire-cell-days) and rank recent events against historical ones in the AOI.

Coverage decision: stay with US + Iberia (calibrated and validated per region); other regions are a config entry through the same pipeline.

### Refinements (2026-11-15, user-approved)

- **Caching:** long-lived browser cache for `/data/v2/**` through hosting headers (`vercel.json`); `manifest.json` and `calibration.json` revalidate. Bundle paths are not content-hashed, so the client refetches once with `cache: "reload"` on a checksum mismatch.
- **Web Worker:** dropped for now (1 s target met); revisit during visual polish if the page feels sluggish.
- **Per-zone daily totals** are published together with the fire-event data (one republish, one round of checks and refits).
- **Fire-event rules (agreed defaults):** an event is a set of fire cells that touch in space (H3 res-5 neighbours, ~250 km² cells) and occur within 1 day of each other; ranked by total fire-cell-days, duration and peak day; compared with the area's past events.
- **Testing:** only the relevant e2e specs while building; the full suite once in Phase 6. E2e tests are written per feature as it is built.
