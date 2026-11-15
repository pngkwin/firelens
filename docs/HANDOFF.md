# FireLens handoff

Written 2026-11-15 so that a teammate's Claude can pick up where this session stopped. It may be a different account or a different machine.

## Start here

> Read `CLAUDE.md`, `docs/HANDOFF.md` and `docs/gap-analysis.md`, then continue from where it stopped.

- **Branch:** work is on the local branch `wip/phase5-snapshot`, snapshot commit `4d16ca3`.
  - Never commit to `main`. Never push. Commits are allowed only when the user asks.
- **Newer work:** there may be uncommitted work in the working tree that is newer than the snapshot. Run `git status` first.
- **The FIRMS key:** it lives only as FIRMS_MAP_KEY in `.env.local` and as a Convex deployment env var. Never print, log, commit or hardcode it.

## The brief, condensed

**Goal:** the strongest web app for the NASA Space Apps 2026 challenge "Harmonization of MODIS and VIIRS Hot Spots" (`nasawebchallengeinfo.pdf`). It needs a harmonized MODIS+VIIRS burning-activity calendar from 2000 to now, for a user-chosen area and date range. It should show the months and years with the most fire, the current month against the historical median, CSV downloads and analytics.

| Phase | Content | Status |
|---|---|---|
| 0 | Install the selected skills (`.claude/skills`, see `SOURCES.md`) | done |
| 1 | Gap analysis and plan (`docs/gap-analysis.md`) | done |
| 2 | Resumable FIRMS ingestion, all sources, SP + NRT stitched, aggregated to H3 fire-cell-days | done |
| 3 | Harmonization to a MODIS-equivalent scale with validation and uncertainty | done (v2) |
| 4 | Convex: daily NRT pull plus a capped point-CSV export | done (dev deployment) |
| 5 | Product: AOI tools, calendars, comparisons, anomalies, trend, exports, URL state | done; plan additions in progress |
| 6 | Quality gate: tests, e2e, security, perf < 1 s, accessibility, docs | pending (run once at the end) |

**User decisions and constraints:**
- **Regions:** the US (lower 48, Alaska and Hawaii) plus Iberia (Spain and Portugal) as the non-US proof. Coverage stays US + Iberia.
- **Main scale:** MODIS-equivalent, with VIIRS-level as a secondary toggle. Estimated periods must be clearly labelled in the UI and in exports.
- **Combining sensors:** a cell counts as burning on a day if any sensor detected fire there. Sensors are a union, never a sum. Raw sensors stay separate, and the harmonized series is a separate, labelled product.
- **Zeros:** a zero means "no matching records in the loaded data", never that no fire occurred.
- **FIRMS budget:** at most 4,500 transactions per 10 minutes. The API limit is 5,000; the user raised our budget from 3,000.
- **Convex:** stores aggregates only. Deep history ships as static, hash-verified partitions.
- **Bundles:** `public/data/demo/v1` is immutable. New data is published as v2.
- **S-NPP:** stopped FIRMS production on 2026-11-02. Current VIIRS comes from NOAA-20 and NOAA-21.

## Where things stand (verified)

**Phase 2: data.**
- `public/data/v2/{us,iberia}`: 313 months each (2000-11 to 2026-11-14), 0 incomplete.
- `node scripts/ingest/verify-v2.mjs` reports OK for both regions.
- **US history** came from the FIRMS Archive Download; all four sources matched the API row for row (100%). Near-real-time data came from the area API.
- **Iberia** came from the area API only (3,886 windows, 0 failed).
- **Clip:** H3 res-7 cell-centre-in-polygon, using us-atlas for the US and world-atlas countries 724 and 620 for Iberia.
- **Static mask:** a persistence rule that drops industrial and volcanic cells (US 5,618 cells, Iberia 575).

**Phase 3: harmonization `fcd-harmonize-v2`.** See `docs/harmonization-method.md` and `-validation.md`.
- **Method selection:** pre-registered per region by held-out (leave-one-year-out) MAE.
  - **US:** stratified ratio (zone × month-of-year × day/night). MAE 490, against 871 for quantile mapping. 90% interval ×[0.890, 1.133], measured coverage 89.1%.
  - **Iberia:** quantile mapping. MAE 54, against 74 for the stratified ratio. Interval ×[0.763, 1.316], coverage 88.2%. Extreme years are fixed (2017: 0.821 → 1.012).
- **Periods:**

  | Period | Source |
  |---|---|
  | before 2002-07 | Terra-only, estimated |
  | 2002-07 to 2021-12 | MODIS observed |
  | 2022 onward | estimated from VIIRS (MODIS orbit drift) |

- **Browser engine:** `src/data/v2/series.ts` reproduces the fit's `regionSeries` for all months to within a relative error of 10⁻⁴ (tested).

**Phase 4: Convex.**
- **Deployment:** project `firelens`, dev deployment.
- **Cron:** `firms-nrt-pull` runs daily at 07:15 UTC (`convex/pull.ts`, Node runtime) and refreshes the last 3 days.
- **Export:** `GET <site>/hotspots.csv` with caps (≤ 31 days, ≤ 50k rows, FIRMS transaction ledger).
- Details are in `docs/convex.md`.

**Phase 5: Fire calendar.** `src/fire/*` is now the default view; the old CSV workspace lives at `#workspace`.
- **AOI:** draw a polygon, rectangle or circle; enter a bbox or point + radius; or pick a state/country preset.
- **Calendars:** a years × months grid (keyboard roving focus) and a day-of-year grid.
- **Focus month vs history:** month-to-date for the current month; median, % of median, % of the multi-year average, percentile, z-score.
- **Rankings and trend:** Theil–Sen + Mann–Kendall.
- **Exports:** monthly CSV with anomaly columns, provenance JSON, PNG, AOI points CSV.
- **Colour:** CVD-safe ramps (viridis and PuOr).

**Measured AOI query times** (cold, `src/data/v2/perf.test.ts`):

| AOI | Time |
|---|---|
| Whole US | 116 ms |
| CONUS box | 109 ms |
| 50 km circle | 102 ms |
| California | 316 ms |
| Alaska | 395 ms |
| Texas | 798 ms |

Since then, presets load a single precomputed file (`aoi/<id>.json.gz`; Texas 60 KB), and live data merges after the first render.

**Tests at the snapshot:**
- 137 unit tests (vitest), `tsc -b` clean.
- Calendar e2e (`tests/calendar.spec.ts`) 5/5.
- Existing e2e 7/7, after renaming the nav button to "CSV workspace" and pointing the specs at `/#workspace`.

## In progress right now

These are the plan additions in the approved order: `docs/gap-analysis.md`, sections "Plan additions" and "Refinements".

| # | Item | Status |
|---|---|---|
| 1 | Anomaly vs multi-year average (UI + CSV columns) | DONE |
| 2 | Hotspot-count scale (raw FIRMS detections per sensor; harmonized unit named "MODIS-equivalent hotspots (~1 km fire-cell-days)") | DONE |
| 3 | Early-warning view (last 7/30 days vs the same window in earlier years, critical periods, next-4-weeks outlook) | DONE + e2e |
| 4 | Performance: `vercel.json` cache headers + refetch on checksum mismatch | DONE |
| 4 | Web Worker | DROPPED (target met) |
| 4 | zone-daily totals | REPUBLISH WAS RUNNING; verify it |
| 5 | Fire events ("current fire vs past fires") | logic + unit tests DONE; integration remaining |

**Finish item 4 (zone-daily).**
- `scripts/ingest/publish.mjs` now emits `zone-daily.json.gz`, and `verify-v2` has a matching check 6d.
- Confirm the republish finished:
  1. Run `node scripts/ingest/verify-v2.mjs`. Both regions should print OK, and `zone-daily.json.gz` should exist in each region folder.
  2. If it is not OK, rerun `node scripts/ingest/publish.mjs --region us` and `--region iberia`, then verify.
  3. Refit both regions with `node scripts/harmonize/fit.mjs --region us` and `--region iberia`, because the calibration is tied to the manifest sha.
  4. Check that `convex/regionData/index.json` is unchanged after `npm run convex:region-data`.
- **Still to do:** use zone-daily in `src/fire/useFireData.ts` for the daily values of shards fully inside a drawn AOI.

**Finish item 5 (fire events).**
- `src/data/v2/events.ts` has `buildEvents`, `eventSize` and `rankEvents`, with tests.
- **Remaining:**
  - **Hook:** compute episodes in the browser from the AOI's daily cell partitions plus the live NRT partitions.
    - The whole-region view asks the user to pick an area.
    - Drawn AOIs above a cell threshold get a message; ~8,000 res-5 cells is the working value.
  - **EventsPanel:** episodes active in the last 7 days before the data end, ranked against the area's past episodes by size, duration and peak-day percentiles, plus the top 10 past episodes (click one to focus its month).
  - **E2e test:** for example, the California preset with Convex blocked.
- **Design decision: episodes are not published.**
  - Live NRT days must merge before clustering.
  - Clustering is clipped to the area, so activity outside the area cannot bridge in-area episodes.
  - The one republish therefore carries zone-daily only.
- **Prototype finding:** US-wide clustering chains spring agricultural and prescribed burning into 2,000–3,500-cell episodes. The real large fires come out correctly: August Complex 2020 (66 days), Dixie 2021, Iberia Aug 2025, Galicia Oct 2017. Hence per-area clustering, and the label "fire episodes" with cell count and duration always shown.

## Fire-event rules (agreed with the user)

- **Event:** H3 res-5 cells (~250 km²) that touch in space (`gridDisk` k=1 neighbours) and occur within 1 day of each other.
- **Size:** total fire-cell-days on the selected scale.
  - On harmonized scales, each day = the month's estimate × that day's share of the month's reference sensor, so days sum to the monthly value.
- **Ranking:** by total size, duration and peak day, against the same area's past episodes.

## Parallel helper (review)

A helper agent was working in a separate git worktree branch (expected name `helper/docs-review`). Its scope:
- updating README.md and CLAUDE.md (commands, v2 layout, test counts, calendar as the default view);
- checking `docs/convex.md` and the method/validation docs against the code;
- a security review for key leakage;
- a keyboard/accessibility review of `src/fire`. Its findings go in `docs/review-findings.md`, report only.

**Next steps:**
1. Merge its branch into `wip/phase5-snapshot`.
2. Fix every finding, with a test where possible. If a finding is not fixed, say why.
3. Run the Phase 6 gate once:
   ```sh
   npm test && npx tsc -b && npm run history:test && npm run ingest:test && npm run build && npm run test:e2e
   npx vitest run src/data/v2/perf.test.ts
   ```
   Stop and report if anything fails.

If the helper's branch or findings aren't visible (`git branch -a`, `git worktree list`), rerun that review.

## Commands

The environment is Windows with Git Bash and PowerShell. Shell heredocs and backslashes get mangled easily (regex `\d` and `\r` were lost several times). Prefer the Edit tool, or small node scripts that read and write files.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server at 127.0.0.1:5173 (runs `data:verify` first) |
| `npm run build` | `data:verify` + `history:verify` + `ingest:verify`, then `tsc -b` and the Vite build |
| `npm run preview -- --port 4173 --strictPort` | Production preview; Playwright reuses this server |
| `npm test` | All vitest unit tests (src + convex) |
| `npm run test:e2e` | Playwright (builds first; uses installed Microsoft Edge). Run single specs while building, e.g. `npx playwright test tests/calendar.spec.ts` |
| `npm run ingest:test` / `npm run history:test` | Node pipeline tests |
| `npm run ingest:download -- --region <id>` | Resumable FIRMS area-API download (budgeted, checkpointed, keeps the machine awake) |
| `npm run ingest:supervise` | Reruns the download per region until complete |
| `npm run ingest:aggregate -- --region <id>` | Raw windows → monthly/daily res-5 aggregates in `data/processed` |
| `npm run ingest:publish -- --region <id>` | Writes the v2 bundle (rewrites `public/data/v2/<id>` entirely) |
| `npm run ingest:verify` | Hashes and exact reconciliation of every v2 bundle |
| `node scripts/harmonize/fit.mjs --region <id>` | Fits and validates the calibration; writes `calibration.json` and `data/processed/harmonize/<id>-validation.json` |
| `node scripts/build-presets.mjs` | State/country preset polygons → `public/data/presets/<region>.json` |
| `npm run convex:region-data` | Regenerates `convex/regionData` (clip, static mask, bundleEnd) |
| `npm run convex:push` | Type-checks and deploys Convex functions to the dev deployment |
| `npm run convex:set-key` | Copies FIRMS_MAP_KEY from `.env.local` to Convex via stdin (never printed) |
| `npm run convex:pull` / `npx convex run live:status` | Runs the NRT pull now / shows the last run per region |

**Pipeline order:** download → aggregate → publish → verify → fit (both regions) → `convex:region-data` (+ `convex:push` if it changed).

## Gotchas

- No commits to `main`, no push. Local commits only on `wip/...` branches, and only when the user asks.
- `public/data/demo/v1` is immutable.
- **Never print the key.** To check for leaks, use a script that prints file paths only, never values.
- **`.env.local`** also holds CONVEX_DEPLOYMENT, VITE_CONVEX_URL and VITE_CONVEX_SITE_URL (not secret). Only `VITE_*` values reach the browser.
- **Republishing** rewrites `public/data/v2/<region>`. Afterwards, always:
  1. run `verify-v2`;
  2. refit both regions (`calibration.json` stores `inputManifestSha256`, and the browser rejects a mismatch);
  3. confirm `convex/regionData/index.json` is unchanged.
- **E2e:** the specs block `*.convex.cloud` for deterministic data (ending 2026-11-14) and mock `*.convex.site/hotspots.csv`, so no FIRMS quota is spent. The old specs navigate to `/#workspace`.
- **Local-only data:** `data/raw` and `data/processed` are gitignored and take hours to rebuild. FIRMS archive requests were placed by email (US requests 850633/850636/850637/850638).
- **Missing v1 CSVs:** the original 2024 v1 CSVs are absent in `data/raw`, so tests use the hash-verified v1 demo copies in `public/data/demo/v1`.
- **Background processes** (preview server, test runs, downloads) stop when a session ends. Restart them.
- **Test artifacts:** `.impeccable/review/` holds screenshots written by the old e2e specs. It is not gitignored.

## Moving to another machine

- **Project folder:** copy the whole folder, including `data/raw`, `data/processed`, `public/data/v2` and the uncommitted work.
- **`.env.local`:** it holds a personal FIRMS key. Share it only with someone you trust, or the teammate gets their own free key from FIRMS.
- **Convex:** either invite the teammate to the `firelens` project in the Convex dashboard, or they log into their own account and run:
  1. `npx convex dev` (creates their own deployment);
  2. `npm run convex:set-key`.
- **Conversation (optional):** copy `~/.claude/projects/<this project's folder>`. The project must sit at the same path on the new machine. Same machine with a different account: `claude --continue` / `claude --resume` may work; if not, this note is enough.
