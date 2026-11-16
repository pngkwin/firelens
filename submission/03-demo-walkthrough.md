# Demo walkthrough (for judges)

Each step below is a direct link: add the query string to the public URL in `06-submission-checklist.md`. All values were checked by automated tests against the published data.

| # | Link (query) | What to look at | Expected |
|---|---|---|---|
| 1 | `/?r=us` | Calendar, status line, scope note in "How to read these numbers" | "Data through 2026-11-14"; November 2026 marked partial; harmonized eras labelled |
| 2 | `/?r=us&tab=transition&from=2003-01&to=2025-12` | Naive splice vs harmonized trend | Naive +72% per decade; harmonized about 0 (p = 0.98) |
| 3 | `/?r=iberia&from=2003-01&to=2025-12&focus=2025-08&tab=transition` | Sign reversal | Naive +36% vs harmonized −35% per decade |
| 4 | `/?r=us&aoi=preset:us-48&from=2003-01&to=2025-12&focus=2011-04` | Texas: Fire season (default step) | March peak in 2003–2012 and 2013–2021; no change survives Holm correction; season CSV download |
| 5 | same, `&tab=context` | Documented fires | Possum Kingdom, Bastrop, Smokehouse Creek with agency links; Apr 2011 = 4,432 fire-cell-days, 721% of median |
| 6 | `/?r=us&aoi=preset:us-06&focus=2020-09&tab=context` | California: CAL FIRE origin points on the map | Ringed dots for August Complex and Creek Fire; Sep 2020 = 20,461 (observed MODIS) |
| 7 | `/?r=us&tab=atlas&map=viirs-only` | Sensor disagreement atlas plus map layer | 71% VIIRS-only since 2012; the map is labelled annual resolution |
| 8 | `/?r=us&tab=evidence` | Evidence lab | Held-out MAE table, interval coverage 79.9% → 90.2% (zone scale) and how it was evaluated; CSV/JSON downloads |
| 9 | `/?r=us&aoi=preset:us-48&from=2003-01&to=2026-11&focus=2011-04&tab=brief` | Regional brief | Planning context (not a forecast), season evolution, documented fires, incomplete-month note; Markdown, HTML and print |
| 10 | Export panel (bottom of the calendar) | Monthly CSV, calendar PNG, provenance JSON | Files download; provenance JSON carries calibration and manifest SHA-256 |

**The verified scientific discovery to centre the demo on:** across the US, California and Texas, the apparent long-term rise in fire activity is an artefact of switching from MODIS to VIIRS. In Iberia the naive record even reverses the sign of the trend. Texas adds a regional decision-support angle: when burning is concentrated (late winter to spring), that this pattern has not detectably changed, and why the largest fire by area (Smokehouse Creek) is not the largest month of detected burning.
