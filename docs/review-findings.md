# Review findings: security, accessibility, data integrity

Review of branch `wip/phase5-snapshot` at 207fa13 (first pass on 4d16ca3), 2026-11-15. Scope: FIRMS key handling and abuse paths (`src`, `convex`, `scripts`, built bundle, committed files), keyboard and assistive-technology support in `src/fire`, and code-vs-doc consistency for `docs/convex.md`, `docs/harmonization-method.md`, `docs/harmonization-validation.md`. Only documentation was changed; every code item below is a recommendation. Line numbers refer to 207fa13.

Severity: **high** = breaks a core flow or a WCAG 2.2 Level A criterion in a common path; **medium** = real risk or AA failure with a workaround; **low** = hardening, polish, or an edge case.

## Summary

| ID | Severity | Area | Title |
|---|---|---|---|
| DATA-1 | high | build/data | CRLF checkout (Windows `core.autocrlf=true`) breaks manifest/calibration hash checks |
| A11Y-1 | high | keyboard | Month grid has no tab stop when the focus month is outside From–To |
| REPO-1 | medium | repo hygiene | Commit 207fa13 tracks a Claude worktree as a gitlink |
| SEC-1 | medium | abuse | Public, unauthenticated point export can drain the FIRMS budget and block the daily pull |
| A11Y-2 | medium | contrast | `textOn()` picks white text on mid-tone fills: down to 2.84:1 |
| A11Y-3 | medium | non-text contrast | Estimated/partial markers and the focus ring disappear on dark fills |
| A11Y-4 | medium | keyboard | Polygon drawing has no keyboard alternative |
| A11Y-5 | medium | keyboard | Day-of-year values are mouse-hover only |
| A11Y-6 | medium | navigation | Skip link switches the CSV workspace to the Fire calendar |
| A11Y-7 | low | label in name | Cell buttons' accessible names do not contain their visible text |
| A11Y-8 | low | grid semantics | Year totals and empty cells unreachable inside `role="grid"`; selection on the wrong element |
| A11Y-9 | low | live regions | Whole-panel `aria-live` regions and a chatty status line |
| A11Y-10 | low | charts | Trend chart: colour-only complete/partial bars; focusable chart inside `role="img"` |
| A11Y-11 | low | colour only | Zero days vs out-of-period days in the day-of-year canvas differ only by a 1.17:1 fill |
| A11Y-12 | low | forms/map | Inputs not linked to their error; `max` on a text input; global key handler; toolbar role |
| SEC-2 | low | disclosure | `live:status` publishes run error text |
| SEC-3 | low | redaction | `redact()` is exact-match only; pull path untested |
| SEC-4 | low | headers | No CSP or other security headers in `vercel.json` |
| SEC-5 | low | exports | Point and harmonized CSV exports have no formula-injection guard |
| SEC-6 | low | repo hygiene | `gpt_zip.zip` commits raw FIRMS CSVs and session logs past the `data/raw` ignore rules |
| SEC-7 | info | key transport | The key is part of every FIRMS URL |
| BUG-1 | low | export | Alaska (and other antimeridian) presets produce a world-wide export bbox |
| BUG-2 | low | UI | "Link copied" shown even when the clipboard write failed |
| BUG-3 | low | PNG | Calendar PNG subtitle says "fire-cell-days" for hotspot scales |
| BUG-4 | low | maintenance | S-NPP end of production hard-coded in `fit.mjs` |
| BUG-5 | low | wording | Fire-episode percentiles read "1th", "2th", "3th", "22th" |
| TEST-1 | low | tests | `perf.test.ts` "Texas < 1 s" fails inside the full parallel suite |

Verified as fine (no action) and doc corrections made are listed at the end.

---

## Data integrity and build

### DATA-1 (high) CRLF checkout breaks hash checks

- **Where:** no `.gitattributes`; `src/data/v2/bundle.ts:97` (calibration vs manifest SHA-256), `src/data/historyRepository.ts:129`, `scripts/history/verify.mjs:9`.
- **Problem:** with Git for Windows' default `core.autocrlf=true`, the pretty-printed JSON files under `public/data` (`v2/*/manifest.json`, `v2/*/calibration.json`, `history/**/*.json`, `demo/v1/manifest.json`), `config/regions.json` and `convex/regionData/index.json` are checked out with CRLF. Their SHA-256 no longer matches what the calibration and history pointers record. Measured in this worktree: the calendar would refuse to load ("calibration was fitted on a different manifest"), `npx vitest run` gives 21 failures (series, perf and historyRepository suites), and `npm run history:verify` (part of `prebuild`) throws "History manifest integrity mismatch", so `npm run build` fails. The same tree with LF restored passes (137 passed, 1 skipped, apart from the timing flake in TEST-1). A Windows `vercel deploy` uploads the CRLF files.
- **Fix:** add `.gitattributes` with `public/data/** -text`, `convex/regionData/** -text` and `config/*.json text eol=lf` (or `* text=auto eol=lf`), then renormalize. Alternatively hash a canonical form (parse and re-stringify) instead of raw bytes.
- **Test:** a CI job on `windows-latest` with default Git settings that runs `npm ci && npm test && npm run build`. A unit test: `git ls-files --eol public/data` must report no `w/crlf`.

### REPO-1 (medium) A Claude worktree is committed as a gitlink

- **Where:** commit 207fa13, path `.claude/worktrees/agent-aa8323b5b8b3058ab` (mode 160000, pointing at 4d16ca3); no `.gitmodules`.
- **Problem:** `git add -A` in the main checkout picked up a review worktree as an embedded repository. Fresh clones get an empty directory and a dangling submodule entry (`git submodule status` errors; some hosts warn during checkout), and later `git add -A` runs keep re-recording whatever that worktree's HEAD is.
- **Fix:** `git rm --cached .claude/worktrees/agent-aa8323b5b8b3058ab` and add `.claude/worktrees/` to `.gitignore`.
- **Test:** CI check that `git ls-files -s | grep '^160000'` is empty.

### TEST-1 (low) Timing test fails inside the full suite

- **Where:** `src/data/v2/perf.test.ts` ("US AOI query time (cold, per query) > Texas < 1 s").
- **Problem:** it passed when run alone and failed in both full-suite runs on the review machine (vitest runs files in parallel workers, so the cold query competes for CPU). A timing assertion that depends on machine load makes `npm test` unreliable as a commit gate.
- **Fix:** run perf tests in a separate project or script (`vitest run --project perf` or `--pool=forks --poolOptions.forks.singleFork`), or assert on work done (files fetched, rows scanned) and keep the wall-clock check for e2e.
- **Test:** `npm test` green three times in a row on the same machine.

---

## Security

Paths checked for key leakage: `scripts/ingest/firms-client.mjs`, `download.mjs` (`progress.log`, `ledger.jsonl`, `failures.jsonl`), `supervise.mjs` (`supervisor.log`; child stdio ignored), `scripts/convex/set-firms-key.mjs`, `convex/firms.ts`, `convex/http.ts`, `convex/pull.ts` (`runs.error`), `convex/live.ts`, the built bundle, `exportsV2.ts` provenance, and committed files. No leak path found; findings below are hardening.

### SEC-1 (medium) Public point export can drain the FIRMS budget and block the daily pull

- **Where:** `convex/http.ts:14-19` (CORS default `*`), `convex/http.ts:23-41` (no authentication; transactions reserved before fetching), `convex/ledger.ts:19-30` (one 10-minute budget shared by exports and the pull).
- **Problem:** anyone with the `.convex.site` URL (it ships in the public bundle) can call `/hotspots.csv` from a script; CORS does not restrain non-browser clients. A 31-day request over a large box reserves about 2 × 31 × products transactions (≈190) before any row is read, even if it then ends in 413. About 50 such requests use the whole daily export budget (`EXPORT_TX_PER_DAY` 10,000), and a burst can fill the shared 10-minute budget (`FIRMS_TX_PER_10MIN` 1,500) at 07:15 UTC so `pull:pullRegion` fails with "FIRMS budget" (it recovers on the next day's run). Every request, including 400s, also counts against the Convex function-call quota.
- **Fix:** set `ALLOWED_ORIGINS` to the production origin (helps only against other web pages); add a per-client rate limit (for example the Convex rate-limiter component keyed on the client IP from `X-Forwarded-For`); keep a reserved share of the 10-minute budget for `purpose: "pull"` (for example exports may use at most 1,000 of 1,500); reject requests whose planned cost exceeds a per-request cap (for example 100 transactions) before reserving; optionally cache identical requests for a few minutes.
- **Test:** `convex/functions.test.ts`: fill the ledger with export reservations up to the export cap, then run `internal.pull.pullRegion` with a mocked fetch and assert it still gets its budget; assert a request over the per-request cap returns 429/400 without calling `fetch`.

### SEC-2 (low) `live:status` publishes run error text

- **Where:** `convex/live.ts:27`; error text built in `convex/firms.ts:18` (first 200 characters of the FIRMS response) and `convex/pull.ts:75`.
- **Problem:** the public query returns each region's last `runs.error`. It is key-redacted, but it can contain upstream response bodies and internal messages.
- **Fix:** return only `ok`, the time and a short error class (for example "FIRMS unavailable", "budget"); keep the full text internal.
- **Test:** unit test that `live:status` output for a failed run contains no `FIRMS HTTP` body text.

### SEC-3 (low) `redact()` is exact-match only; pull path untested

- **Where:** `convex/lib/nrtCore.ts:221`, `scripts/ingest/firms-client.mjs:23`, `scripts/convex/set-firms-key.mjs:15`.
- **Problem:** redaction replaces the exact key string. A URL-encoded, case-changed or truncated echo would pass. FIRMS keys are 32 hexadecimal characters, so encoding is unlikely, but nothing enforces it. `convex/functions.test.ts` tests the export path only, not `pull.ts` → `runs.error`.
- **Fix:** additionally replace `/[0-9a-f]{32}/gi` in any text that reaches a log, table or response, and validate the key format in `firmsKey()` / `loadKey()`.
- **Test:** convex-test: stub `fetch` to answer `500` with a body echoing the URL, run `internal.pull.pullRegion`, and assert the stored `runs.error` contains `<MAP_KEY>` and not the key; same for `fetchAvailability` errors.

### SEC-4 (low) No security headers

- **Where:** `vercel.json` (cache headers only).
- **Problem:** no Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy` or `frame-ancestors`.
- **Fix:** add, for example, `default-src 'self'; connect-src 'self' https://*.convex.cloud https://*.convex.site https://tiles.openfreemap.org; img-src 'self' data: blob: https://tiles.openfreemap.org; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`, plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. Check MapLibre workers and fonts against it.
- **Test:** Playwright: assert `response.headers()['content-security-policy']` on `/` in a Vercel preview, and no CSP violations in the console.

### SEC-5 (low) CSV exports without a formula-injection guard

- **Where:** `convex/lib/nrtCore.ts:217` (`csvCell`), `src/data/v2/exportsV2.ts:8` (`csvCell`), `src/data/v2/exportsV2.ts:51-58` (`filterPointsCsv` re-emits lines).
- **Problem:** the v1 workspace prefixes cells that start with `= + - @` (README); the v2 exports do not. Values come from FIRMS and are numeric codes, so the risk is low, but a negative longitude is a legitimate leading `-`, so a naive guard must skip numbers.
- **Fix:** guard non-numeric strings that start with `= + @ \t \r` (and `-` when not a number) by prefixing `'`.
- **Test:** unit test that `exportCsvText` and `monthlyCsv` emit `'=cmd` for a crafted `version` value and leave `-120.5` unchanged.

### SEC-6 (low) `gpt_zip.zip` bypasses the `data/raw` ignore rules

- **Where:** repo root `gpt_zip.zip` (40 MB, committed in bd5173e).
- **Problem:** the archive contains `data/raw/**` FIRMS CSVs (about 10 MB, including `sample_viirs_snpp_071223.csv`), `.impeccable` session logs and an older source tree. A pattern scan of its contents found no key, but it ships files the rules say not to commit.
- **Fix:** remove it from the tree (history rewrite is the owner's decision) and add `/*.zip` to `.gitignore`. `.gitignore` itself ignores only `data/raw/**/*.{csv,zip,gz}` and the `firms-api/` and `firms-archive/` trees; consider `data/raw/**` with `!data/raw/.gitkeep`.
- **Test:** a pre-commit or CI check that fails when a tracked file is larger than 5 MB or is a `.zip`.

### SEC-7 (info) The key is part of every FIRMS URL

- **Where:** `convex/lib/nrtCore.ts:62` (`areaPath`), `convex/firms.ts:28`, `scripts/ingest/firms-client.mjs:40,45,59`.
- **Problem:** the FIRMS API requires the key in the path or query, so anything that logs request URLs (an HTTP proxy, `NODE_DEBUG=fetch`, undici diagnostics, a future Convex request log) records it.
- **Fix:** keep fetch debug logging off for these processes; if a URL ever has to be logged, pass it through `redact()`.

---

## Accessibility (src/fire, WCAG 2.2 AA)

### A11Y-1 (high) Month grid has no tab stop when the focus month is outside From–To

- **Where:** `src/fire/MonthHeatmap.tsx:24,82`; `src/fire/FireCalendar.tsx:36`.
- **Problem:** roving tabindex gives `tabIndex=0` only to `current = active ?? focus ?? last-in-range`. `focus` defaults to the last data month (2026-11) and is not clamped to the selected range, and `active` is not cleared when the range changes. After choosing any To before 2026-11 (or moving the range past a previously arrowed month), no rendered cell has `tabIndex=0`, so Tab skips the whole calendar. The FocusCard also keeps showing a month outside the range.
- **WCAG:** 2.1.1 Keyboard (A), 2.4.3 Focus Order (A).
- **Fix:** `const current = [active, focus].find((m) => m && byMonth.has(m)) ?? inRange.at(-1)?.month ?? null;` and clamp `focus` in `FireCalendar` to `[from, to]`.
- **Test (Playwright):** select To = `2020-12`; `await expect(page.locator('.fc-heat button[tabindex="0"]')).toHaveCount(1)`; Tab from the To select until `document.activeElement` is inside `.fc-heat`.

### A11Y-2 (medium) White text on mid-tone fills fails contrast

- **Where:** `src/fire/colors.ts:34-38` (`textOn`, threshold 0.32); used in `MonthHeatmap.tsx:84`, `FocusCard.tsx:46,50`, `EarlyWarning.tsx:18`; `src/styles.css:1813-1814` (`opacity: 0.85` on labels and notes inside those tiles).
- **Problem:** white is chosen whenever fill luminance is ≤ 0.32, but white only reaches 4.5:1 below about 0.18. Computed: 17.8 % of the viridis ramp and 19.2 % of the PuOr ramp get text below 4.5:1, worst 2.84:1 (viridis `#2cad80`, PuOr `#9d93c2`). Cell text is 0.7rem (≈11 px) and tile labels 0.78rem, so 4.5:1 applies. The 0.85 opacity lowers it further (2.49:1 on `#9d93c2`).
- **WCAG:** 1.4.3 Contrast (Minimum) (AA).
- **Fix:** choose between `#000` and `#fff` by the higher contrast ratio (this guarantees ≥ 4.58:1 on any fill), or between `#132a24` and `#fff` with the crossover at the luminance where both ratios are equal, and drop the opacity on coloured tiles.
- **Test:** unit test in `colors.test.ts`: for 1,001 samples of `VIRIDIS` and `PUOR`, `contrast(fill, textOn(fill)) >= 4.5`. Playwright + `@axe-core/playwright` `color-contrast` rule on the calendar.

### A11Y-3 (medium) Markers and focus ring disappear on dark fills

- **Where:** `src/styles.css:1798` (estimated: `1.5px dotted #132a24`), `:1799` (partial: `#132a24` triangle), `:1801` (focus: `3px solid var(--viirs)` = `#2d7191`, offset 1 px inside a 2 px cell gap).
- **Problem:** the estimated and partial markers are the visual non-colour cue, but `#132a24` on the darkest viridis fill `#440154` is 1.0:1 and on `#31688e` 2.5:1, so low-value estimated or partial months look observed and complete. The focus ring `#2d7191` is 1.1:1 against `#31688e` neighbours and 2.8:1 against `#440154`.
- **WCAG:** 1.4.11 Non-text Contrast (AA), 1.4.1 Use of Color (A) for the estimated/partial cue, 2.4.7 Focus Visible (AA).
- **Fix:** draw markers in `textOn(fill)` (set `--mark: <textOn colour>` inline and use it in the CSS), or use a two-tone marker (white plus dark). Use a two-tone focus ring, for example `outline: 2px solid #fff; box-shadow: 0 0 0 4px #132a24`.
- **Test:** unit test that marker colour vs fill ≥ 3:1 for every ramp sample; Playwright screenshot of a focused dark cell, or assert computed `outline-color` and `box-shadow` on `:focus-visible`.

### A11Y-4 (medium) Polygon drawing has no keyboard alternative

- **Where:** `src/fire/AoiMap.tsx:87-103` (vertices only from map clicks), `:143` (label promises "the area forms are the keyboard alternative"), `src/fire/AoiPanel.tsx:49-69` (forms cover bbox and circle only).
- **Problem:** rectangle and circle have equivalent forms; polygons do not. Polygon vertices are discrete points, so the path-based exception of 2.1.1 does not apply. The only other route is hand-editing `?aoi=polygon:…` in the URL.
- **WCAG:** 2.1.1 Keyboard (A).
- **Fix:** add a "Polygon vertices" form (one `lon,lat` per line, validated with `decodeAoi("polygon:…")`), and/or let Enter/Space on the focused map add a vertex at the map centre with a visible crosshair.
- **Test:** Playwright: fill the vertices textarea with four points, submit, assert `?aoi=polygon:` in the URL and the AOI label "Drawn polygon (4 vertices)".

### A11Y-5 (medium) Day-of-year values are mouse-hover only

- **Where:** `src/fire/DoyHeatmap.tsx:84-88` (`onMouseMove` only; canvas not focusable), `:90-96` (table has only peak day and active days per year).
- **Problem:** per-day values (and the estimated flag) are available only by hovering the canvas. Keyboard and screen-reader users get the per-year summary, not the daily series the chart shows.
- **WCAG:** 2.1.1 Keyboard (A); 1.1.1 Non-text Content (A) for the incomplete text alternative.
- **Fix:** make the canvas focusable (`tabIndex=0`) with arrow keys moving a day cursor that updates `.fc-hover` (switch it to `aria-live="polite"` while focused), or add a "daily values for year N" table or CSV export.
- **Test:** Playwright: focus `canvas.fc-doy`, press ArrowRight twice, assert `.fc-hover` text matches `/^\d{4}-\d{2}-\d{2}: /`.

### A11Y-6 (medium) Skip link changes the view

- **Where:** `src/App.tsx:173` (`href="#main"`), `src/App.tsx:24-27,44-48` (`hashchange` → `viewFromHash()`; unknown hashes mean "calendar").
- **Problem:** in `#workspace`, `#datasets` or `#methods`, activating "Skip to workspace" sets the hash to `#main`, which the hash listener maps to the Fire calendar, so the user lands on a different page instead of the current page's main content.
- **WCAG:** 2.4.1 Bypass Blocks (A) is defeated on those tabs; also 3.2.1/3.2.2-style unexpected context change.
- **Fix:** handle the skip link in JS (`e.preventDefault(); document.getElementById("main")?.focus()` with `tabIndex={-1}` on `<main>`), or make `viewFromHash` ignore `#main`.
- **Test:** Playwright: `goto('/#workspace')`, Tab to the skip link, press Enter, assert the h1 is still "Research workspace" and `main` is focused.

### A11Y-7 (low) Accessible names do not contain the visible text

- **Where:** `src/fire/MonthHeatmap.tsx:85,90`.
- **Problem:** a cell shows "1.2k" but its name is "Mar 2020: 1,234 MODIS-eq. fire-cell-days, …". Speech-input users who say what they see ("click 1.2k") get no match.
- **WCAG:** 2.5.3 Label in Name (A).
- **Fix:** start the name with the visible text ("1.2k, Mar 2020: 1,234 …"), or keep the visible text as the name and move the detail to `aria-describedby`.
- **Test:** Playwright: for a sample of cells, assert `aria-label` contains the button's `innerText` (after trim) when the text is non-empty.

### A11Y-8 (low) Grid semantics

- **Where:** `src/fire/MonthHeatmap.tsx:58` (`role="grid"` on the table), `:75` (empty cells with `aria-label`, not focusable), `:78` (`aria-selected` on the `td` while focus sits on the inner button), `:95` (year-total cells).
- **Problem:** in grid mode screen readers stop using table-reading commands, and arrow keys only visit month buttons, so year totals ("Year total" column, with the partial-year `*`) and "outside the loaded period" cells cannot be reached without leaving the grid. Some screen readers do not announce `aria-selected` from the parent cell when the button has focus. PageUp/PageDown and Ctrl+Home/End are not supported.
- **WCAG:** 1.3.1 Info and Relationships (A), 4.1.2 Name, Role, Value (A) (best-practice level).
- **Fix:** either include year-total cells in the roving set (arrow into column 13), or drop `role="grid"` and keep a native table with buttons (arrow-key script still works). Put the selected state on the button (`aria-pressed` or `aria-current="date"`).
- **Test:** Playwright: from the Dec cell press ArrowRight and assert focus on that row's year total (if included); assert the focus month's button has `aria-pressed="true"`.

### A11Y-9 (low) Over-broad live regions

- **Where:** `src/fire/FocusCard.tsx:18` and `src/fire/EarlyWarning.tsx:36` (`aria-live="polite"` on whole sections, with nested `role="status"` at `EarlyWarning.tsx:42,46` and `FocusCard.tsx:31`), `src/fire/FireCalendar.tsx:66` (`.fc-status` `role="status"` with timing text), `src/fire/AoiMap.tsx:144` (hint `role="status"` re-announced when the year range changes).
- **Problem:** every focus, scale or AOI change re-reads entire panels (and nested regions can double-announce); every query re-announces "query 0.23 s (load …)".
- **WCAG:** 4.1.3 Status Messages (AA) is met, but the verbosity hurts usability.
- **Fix:** one concise live summary (for example "Nov 2026: 3,575 fire-cell-days, 112 % of median") and plain, non-live panels; keep timing text out of the live region.
- **Test:** Playwright: `expect(page.locator('[aria-live]:not([aria-live="off"]) [aria-live], [aria-live] [role="status"]')).toHaveCount(0)` (no nested live regions).

### A11Y-10 (low) Trend chart

- **Where:** `src/fire/TrendPanel.tsx:32` (`role="img"` wrapper around Recharts), `:39-42` (complete vs partial bars differ only by fill; no legend).
- **Problem:** the partial year is distinguished by colour alone. Recharts 3 enables its keyboard `accessibilityLayer` by default, which puts a focusable element inside `role="img"` (children of `img` are presentational). The annual values are not available as text except the top 10 complete years in Rankings.
- **WCAG:** 1.4.1 Use of Color (A), 1.1.1 Non-text Content (A), 4.1.2 (A).
- **Fix:** add a Legend or label the partial year ("2026 (partial)") on the axis; set `accessibilityLayer={false}` while the wrapper is `role="img"`, or remove the wrapper role and keep Recharts' layer; add a `<details>` table of annual totals with intervals.
- **Test:** axe `nested-interactive`/`presentation-role-conflict` rules; Playwright: assert a table with caption "Annual totals" exists in the trend panel.

### A11Y-11 (low) Zero vs out-of-period in the day-of-year canvas

- **Where:** `src/fire/DoyHeatmap.tsx:44-49` (`ZERO_FILL #e9eeeb` for zero days, nothing for out-of-period days), `src/fire/colors.ts:6`.
- **Problem:** the product distinguishes "no matching records" from "outside the loaded period", but in the canvas the two differ by a 1.17:1 fill against white.
- **WCAG:** 1.4.11 Non-text Contrast (AA), 1.4.1 Use of Color (A).
- **Fix:** hatch or dot the out-of-period area, or outline the covered period.
- **Test:** unit test on a small render: pixels for an out-of-period day differ from zero-day pixels by ≥ 3:1, or a hatch pattern is present.

### A11Y-12 (low) Forms and map details

- **Where:** `src/fire/AoiPanel.tsx:52-70`, `src/fire/AoiMap.tsx:122-127,133,143`.
- **Problems and fixes:**
  - Inputs are not tied to the error: set `aria-invalid` and `aria-describedby` to the `role="alert"` paragraph (3.3.1 is met by the text; this improves 3.3.3). `max={MAX_RADIUS_KM}` on a text input has no effect; the limit should appear in the label ("Radius (km, ≤ 2000)").
  - The draw-mode Escape/Enter handler is on `window` (`AoiMap.tsx:122-127`): Enter on any focused control finishes the polygon, and Enter on "Finish polygon" fires both the handler and the click (the AOI is applied twice). Scope the handler to the map container.
  - `role="toolbar"` (`:133`) promises arrow-key navigation that is not implemented; use `role="group"` or add it.
  - `role="application"` on the non-focusable map wrapper (`:143`) adds nothing (MapLibre's canvas is the focusable element and has its own label); move the label to the canvas or drop the role.
- **Test:** Playwright: submit an empty or invalid box and assert `aria-invalid="true"` on the West input and `aria-describedby` pointing to the alert.

Checked and fine: one `h1` per view and `h2` per panel in order; `SelectField` label association; labelled bbox, point, date and checkbox inputs; `role="alert"` for URL, form and export errors; `aria-current="page"` on primary navigation; "est." and "partial" badges in Rankings are text, not colour; viridis and PuOr are CVD-safe ramps; the zero legend wording "0 = no matching records"; `EventsPanel.tsx` (added in 207fa13) uses `h3` under its `h2`, visually hidden table captions, `scope="col"` headers, date buttons with visible text, and the "no matching records" wording for an empty current list.

---

## Functional bugs found in passing

### BUG-1 (low) Antimeridian presets produce a world-wide export bbox

- **Where:** `src/data/v2/aoi.ts:60-66` (`polysBbox`), `src/fire/ExportPanel.tsx:43-45`.
- **Problem:** Alaska's polygons include the Aleutians on both sides of 180°, so the bbox becomes about [-180, 51, 180, 72]. The export then queries a band around the whole globe, reserves its transactions, and usually ends in 413.
- **Fix:** split polygons at the antimeridian and request two boxes, or compute the bbox on a shifted longitude.
- **Test:** unit test `polysBbox` (or a new `exportBoxes`) for the `us-02` preset returns boxes no wider than 180°.

### BUG-2 (low) "Link copied" on failure

- **Where:** `src/fire/FireCalendar.tsx:63`.
- **Problem:** the clipboard error is swallowed and `setCopied(true)` runs anyway, including when `navigator.clipboard` is undefined (non-secure context).
- **Fix:** show "Copy failed: select the address bar" on failure; announce the result through a status region.
- **Test:** Playwright with clipboard permission denied: the button must not say "Link copied".

### BUG-3 (low) PNG subtitle unit

- **Where:** `src/fire/png.ts:18`.
- **Problem:** the subtitle always says "fire-cell-days per month", also for the hotspot scales.
- **Fix:** use `SCALES[o.scale].unit`.
- **Test:** unit test of the subtitle string per scale (extract it into a function).

### BUG-4 (low) Hard-coded S-NPP end date in the fit

- **Where:** `scripts/harmonize/fit.mjs:64` (`"2026-11-02"`).
- **Problem:** duplicates `endOfProduction` in `config/regions.json`; a change in one place would silently desynchronize V\* coverage.
- **Fix:** read `endOfProduction` from `manifest.sources.VIIRS_SNPP_NRT`.

### BUG-5 (low) Ordinal suffixes in the fire-episode table

- **Where:** `src/fire/EventsPanel.tsx:10` (`` `${fmt(p)}th percentile` ``).
- **Problem:** produces "1th", "2th", "3th", "21th", "22th" percentile; screen readers read it as written.
- **Fix:** use `Intl.PluralRules("en-US", { type: "ordinal" })` for the suffix, or write "percentile 22".
- **Test:** unit test of the formatter for 1, 2, 3, 11, 12, 13, 21, 22, 23, 100.

---

## Doc corrections made in this branch

- `README.md`, `CLAUDE.md`: rewritten for the Fire calendar default view, the `#workspace` CSV workspace (v1 demo loads only there), all `ingest:*` and `convex:*` scripts, `fit.mjs` and `build-presets.mjs`, the pipeline order (publish deletes `calibration.json`, so refit after every publish), the v2 file layout (including `zone-daily.json.gz` from 207fa13), Node ≥ 22.18 (README said 22.12), measured test counts, key rules, and the CRLF caveat. CLAUDE.md's "no harmonization" was wrong.
- `docs/convex.md`: `runs` also stores `stats`; prune is limited to 500 rows per table per run and happens only after a successful pull; the NRT-vs-bundle equality test is skipped without `data/raw`; the pull shares the 10-minute budget with exports; CORS is not access control; bbox also needs south < north; sensors validation; transactions are reserved before fetching (a 413 still counts); the daily export 429 also sends `Retry-After`; 502 for missing key or FIRMS errors; `convex:set-key` reads the shell environment first and accepts `--prod`; public query limits and `live:status` error exposure; `convex:region-data` needs `data/processed`; function-call estimate corrected from ≈25 to about 20 per run.
- `docs/harmonization-method.md`: the products table used labels that do not exist in the UI ("Raw · <platform>", "Harmonized · MODIS-equivalent"); it now lists the actual scale labels from `SCALES` and the CSV columns, and notes that per-platform raw values are CSV-only. The `viirs-estimated` class said "k · V\*" for every region; Iberia uses quantile mapping.
- `docs/harmonization-validation.md`: the Iberia "Interval" line reported the v1 in-sample interval without saying so; it is now labelled and points to the v2 value.

Claims checked and correct against `public/data/v2/*/calibration.json`, manifests and code: method version, 313 months, period boundaries (2002-07, 2022-01; S-NPP from 2012-01-20 to 2026-11-02), κ = 20 and training 2012–2021, selection MAEs (US 489.98 vs 870.57, global 889.64; Iberia 53.91 vs 73.55, global 84.71), intervals (US ×[0.8903, 1.1334] coverage 0.891; Terra ×[0.9119, 1.1189] 0.885; Iberia ×[0.763, 1.3159] 0.882), cross-calibration (0.957/0.969 US, 0.956/0.994 Iberia; 103 and 44 months), ρ range, region coefficients (day 0.587, night 0.243; ranges), 866 US zone coefficients, static mask counts (5,618; 575), Iberia clip cells (111,832) and window count (3,886), retained/static/outside detection totals for both regions, archive request IDs, NRT start dates, cron time and name, limits (31 days, 50,000 rows, 1,500 / 10,000 transactions, 16 / 400), env var names, provisional 36 h, refresh 3 days, max 30 days, cost formula (72 US / 18 Iberia), browser tolerance 10⁻⁴.

Not verifiable in this worktree (need `data/processed` or the key): the per-year and zone-scale tables and drift numbers in `harmonization-validation.md` (from `data/processed/harmonize/*-validation.json`), measured export timings and the 11.6 KB day size in `docs/convex.md`, the deployment name, and the 15,537-file key scan.

## Verified as fine

- Built bundle (`npx vite build`, no `.env.local`): the only `import.meta.env` reads are `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` (`src/data/v2/live.ts:14-15`); `vite.config.ts` has no `define` or custom `envPrefix`; the bundle contains no `MAP_KEY`, `api/area/csv` or other key-bearing strings (only public FIRMS links). `src` imports only `convex/_generated/api` from the backend.
- Ingest logs contain counts, job ids, hashes and redacted reasons only (`download.mjs:45-50,118,149,154,158`); `supervise.mjs` logs counts and spawns the downloader with `stdio: "ignore"`.
- `set-firms-key.mjs` passes the key via stdin with fixed arguments (`shell: true` on Windows is safe here because no argument is user-controlled) and redacts CLI output.
- `convex/http.ts` and `convex/pull.ts` redact every error before returning or storing it; `parseExportParams` validates bbox, dates, span and sensors before any FIRMS call; the `Content-Disposition` filename uses only validated numbers and dates.
- Public queries validate region, dates and array sizes and read aggregates only.
- Provenance JSON and the PNG footer include `window.location.href`, but `FireCalendar.tsx:38-41` rewrites the query string to the known keys (`r`, `aoi`, `from`, `to`, `scale`, `focus`), so unknown parameters such as share tokens are dropped before any export. The AOI geometry (user-drawn coordinates) is included on purpose.
- `.env*` and `*.local` are gitignored; no tracked `.env`, log or ledger files; no key-like pattern (`MAP_KEY=<value>`, `/api/area/csv/<32 chars>`) in tracked files or inside `gpt_zip.zip`.
