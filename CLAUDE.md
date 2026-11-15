# FireLens

Scientific workspace for NASA FIRMS active-fire observations. The default view is the harmonized **Fire calendar** (`src/fire/FireCalendar.tsx`): MODIS-equivalent fire-cell-days for the US and Iberia from the static v2 bundle (`public/data/v2/<region>`), plus near-real-time days from an optional Convex backend (`convex/`). Raw sensor scales stay separate and available next to the harmonized ones; nothing raw is ever summed across sensors. The older point-level **CSV workspace** is the `#workspace` tab (with `#datasets` and `#methods`); it keeps MODIS and VIIRS separate with no harmonization, and the v1 demo bundle loads only there. Vite + React 19 + TypeScript + Tailwind 4 + MapLibre + Recharts + h3-js + Convex.

Read `README.md` for data semantics, scripts and the v2 data layout before changing anything that touches counts, confidence, coverage or bundles. `docs/harmonization-method.md` and `docs/harmonization-validation.md` define the harmonized product; `docs/convex.md` the backend; `docs/review-findings.md` open security and accessibility findings; `docs/HANDOFF.md` the current state of the work. `DESIGN.md` and `PRODUCT.md` describe the UI and product intent.

## Setup

Requires Node >= 22.18 (engines field). From the repo root:

```sh
npm install
npm run dev        # http://127.0.0.1:5173, runs data:verify first
```

If `node_modules` was installed on another OS (for example Linux in a VM), delete it and reinstall on the machine you run from; the native binaries are platform-specific.

On Windows, `core.autocrlf=true` rewrites `public/data/**/*.json` with CRLF and breaks the manifest/calibration hash checks (the calendar refuses to load and 21 vitest tests fail). Use an LF checkout of `public/data`.

## Test before committing

```sh
npm test               # vitest: 18 files, 138 tests (137 pass, 1 skipped without data/raw); includes convex/**/*.test.ts
npx tsc -b             # type check
npm run ingest:test    # v2 pipeline tests (node --test), 14 tests
npm run history:test   # history pipeline tests (node --test), 3 tests (1 skipped without data/raw)
npm run ingest:verify  # hashes and exact reconciliation of public/data/v2
npm run build          # data:verify + history:verify + ingest:verify, type check, build to dist/
npm run test:e2e       # Playwright, tests/*.spec.ts (incl. tests/calendar.spec.ts); builds first; uses installed Microsoft Edge (see playwright.config.ts)
```

Run at least `npm test` and `npx tsc -b` before any commit. Run `npm run build` when touching data, scripts, or config. `src/data/v2/perf.test.ts` is timing-based: it passes alone (`npx vitest run src/data/v2/perf.test.ts`) but can fail inside the full parallel suite; rerun it alone before treating it as a regression.

## v2 data pipeline

Order: `node scripts/build-presets.mjs` (when presets change) → `npm run ingest:download -- --region <id>` (or `ingest:supervise`) → `ingest:aggregate` → `ingest:publish` → `ingest:verify` → `node scripts/harmonize/fit.mjs --region <id>` → `npm run convex:region-data` → `npm run convex:push`. Publish replaces the region directory and deletes `calibration.json`; always refit afterwards (the app rejects a calibration whose `inputManifestSha256` does not match). Download, aggregate, publish and `convex:region-data` need `data/raw` / `data/processed`, which are local only.

## Rules

- Do not commit `node_modules`, `dist`, `data/raw`, `data/processed`, or `.env*` (already gitignored; note `.gitignore` covers `data/raw` CSV/ZIP/GZ files and the `firms-api/` and `firms-archive/` trees, so check `git status` before adding anything else under `data/raw`).
- `public/data/demo/v1/` is an immutable published bundle. Never edit it or its manifest; a different scope needs a new version via `npm run data:bundle`.
- Never hand-edit files in `public/data/v2/`; regenerate them with `ingest:publish` and `fit.mjs`, then run `ingest:verify`.
- A zero count means no matching records in the loaded data, never that no fire occurred. Keep that wording in the UI and exports.
- The FIRMS key lives only in `.env.local` as `FIRMS_MAP_KEY` and as the Convex environment variable `FIRMS_MAP_KEY`. Never print, log, commit or paste it, never put it on a command line, and never give it a `VITE_` prefix. Only `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` may reach the browser. Pass any FIRMS error text through `redact()`.
- Do not commit or push unless asked.
