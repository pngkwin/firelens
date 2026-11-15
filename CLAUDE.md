# FireLens

Scientific workspace for exploring NASA FIRMS active-fire observations (MODIS and VIIRS kept separate; no harmonization). Vite + React 19 + TypeScript + Tailwind 4 + MapLibre + Recharts. Read `README.md` for data semantics before changing anything that touches counts, confidence, or coverage. `DESIGN.md` and `PRODUCT.md` describe the UI and product intent.

## Setup

Requires Node >= 22.18 (engines field). From the repo root:

```sh
npm install
npm run dev        # http://127.0.0.1:5173, runs data:verify first
```

If `node_modules` was installed on another OS (for example Linux in a VM), delete it and reinstall on the machine you run from; the native binaries are platform-specific.

## Test before committing

```sh
npm test               # vitest, 24 tests
npx tsc -b             # type check
npm run history:test   # data pipeline tests (node --test)
npm run build          # verifies data bundle, type checks, builds to dist/
npm run test:e2e       # Playwright; builds first; uses installed Microsoft Edge (see playwright.config.ts)
```

Run at least `npm test` and `npx tsc -b` before any commit. Run `npm run build` when touching data, scripts, or config.

## Rules

- Do not commit `node_modules`, `dist`, `data/raw`, `data/processed`, or `.env*` (already gitignored).
- `public/data/demo/v1/` is an immutable published bundle. Never edit it or its manifest; a different scope needs a new version via `npm run data:bundle`.
- A zero count means no matching records in the loaded data, never that no fire occurred. Keep that wording in the UI.
- Do not commit or push unless asked.
