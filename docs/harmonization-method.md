# Harmonization method `fcd-harmonize-v3`

Status 2026-11-15: implemented, fitted and validated for the US and Iberia (`src/data/v2/harmonize.ts`, `src/data/v2/coverage.ts`, `scripts/harmonize/fit.mjs`; numbers in `harmonization-validation.md`). The browser applies the published `calibration.json` with `src/data/v2/series.ts`; a test checks it reproduces the fit's own region series, coverage flags and reference satellite for all 313 months of both regions (relative difference < 10⁻⁴, from coefficient rounding).

This supersedes `harmonization-methodology.md` (the earlier research plan for the 2024 sample). The raw sensor-specific views remain available.

**What FireLens does, in three layers.** It is worth keeping these apart:

1. **Shared format**: FIRMS MODIS and VIIRS records (archive and near-real-time) parsed into one schema with hashes. This alone removes no bias.
2. **Shared spatial and temporal aggregation**: every detection mapped to an H3 res-8 cell on its UTC day; a cell-day counts once whichever satellites saw it. This removes most pixel-count inflation (several 375 m VIIRS pixels on one fire become one cell-day) but **not** VIIRS's higher sensitivity to small and cool fires: raw VIIRS still records about 2.1× the MODIS cell-days.
3. **Cross-calibration**: empirical VIIRS→MODIS and Terra→Terra∪Aqua relationships fitted on overlap years and validated on held-out years, applied only where MODIS cannot be used as observed.

**v3 changes from v2** (prompted by the scientific audit): (1) an observation-coverage audit flags satellite-days without observations from cross-satellite evidence and labels them confirmed/suspected with documented notices; (2) the VIIRS reference skips a satellite with flagged days in the month; (3) months whose MODIS target or VIIRS reference lost a material share of observations are marked reduced coverage, excluded from fitting, validation, baselines, anomaly statistics and trends; (4) every learned parameter (ratios, quantile map, overlap factor ρ, VIIRS cross-calibration) is refitted inside each held-out fold; (5) a nested leave-one-year-out score of the method choice is reported; (6) raw scales have no value before a sensor was in orbit and are compared only across periods observed by the same satellites.

## Products

| Product | Definition | Label in UI (scale selector, `src/data/v2/analysis.ts` `SCALES`) and exports |
|---|---|---|
| **Harmonized, MODIS-equivalent** (primary) | Estimated Terra∪Aqua fire-cell-days as the stable-orbit MODIS pair would record them | "MODIS-equivalent hotspots (harmonized, ~1 km fire-cell-days)"; monthly CSV `modis_eq_*` columns with `period_class`, `modis_eq_source` and `modis_eq_coverage` per row |
| Harmonized, VIIRS-level (secondary scale) | The S-NPP-scale VIIRS reference series (any-time); before VIIRS, MODIS-equivalent × the training ratio V*/MODIS for that month of year (estimated, interval not quantified) | "VIIRS-level (harmonized, S-NPP scale, ~1 km fire-cell-days)"; CSV `viirs_level_fire_cell_days`, `viirs_level_estimated` |
| Raw, any sensor | Fire-cell-days detected by **any** platform in orbit (union of masks; never a sum of detections) | "Raw fire-cell-days: any sensor"; CSV `raw_any_sensor` |
| Raw, per sensor | Fire-cell-days detected by MODIS (Terra ∪ Aqua) or by VIIRS (any platform); VIIRS has no value before 2012-01-20 | "Raw fire-cell-days: MODIS (Terra ∪ Aqua)", "Raw fire-cell-days: VIIRS (any platform)"; CSV `raw_modis`, `raw_viirs` (empty when not in orbit) |
| Raw, per platform | Fire-cell-days detected by one platform | Not a UI scale; CSV `raw_terra`, `raw_aqua`, `raw_snpp`, `raw_noaa20`, `raw_noaa21` (empty when not in orbit) |
| Raw hotspots | FIRMS detections (pixels) after region clip and static mask, per sensor; never added across sensors | "Raw hotspots detected: MODIS (1 km pixels, Terra + Aqua)", "Raw hotspots detected: VIIRS (375 m pixels, all platforms)"; CSV `detections_<platform>` |

## Unit: fire-cell-day

One H3 resolution-8 cell (mean ≈ 0.74 km², close to a nadir MODIS 1 km pixel) on one UTC day with at least one detection. Each cell-day stores a bitmask of the platforms that detected it, separately for day and night overpasses (FIRMS `daynight`). Persistent non-vegetation sources are excluded: res-8 cells with ≥ 3 science-quality detections of FIRMS type 1 (volcano), 2 (other static land source) or 3 (offshore) making up ≥ 50 % of the cell's detections. The mask is applied per cell, so it also covers NRT rows, which carry no type.

## Overpass awareness

| Platform | Local equator crossing (nominal) | Role |
|---|---|---|
| Terra | ~10:30 / 22:30 | MODIS morning; drifted earlier after its 2020 final inclination manoeuvre and Oct 2022 orbit lowering |
| Aqua | ~13:30 / 01:30 | MODIS afternoon; left the A-Train in 2022 and drifted later |
| S-NPP, NOAA-20, NOAA-21 | ~13:30 / 01:30 | VIIRS afternoon; NOAA-20/21 ~50 min apart from S-NPP on the same orbit plane timing |

Calibration is fitted separately for day and night cell-days and recombined with a training overlap factor ρ(month) = Σ any / Σ (day + night) so a cell burning at both overpasses is counted once.

## Steps

0. **Observation coverage** (`src/data/v2/coverage.ts`, run by `fit.mjs`, stored in `calibration.json` `coverage`). Zero detections never prove an outage on their own. Evidence: daily detections per satellite, pooled over all published regions (outages are spacecraft-wide).
   - **Gap:** the satellite recorded < 10 % of the detections expected from another satellite observing the same day (expected = that satellite's count × the median ratio between the two over ±45 days; same-sensor peers first; at least 100 expected).
   - **Reduced:** a VIIRS satellite recorded < 50 % of what another VIIRS implies (a partial-day loss; normal S-NPP/NOAA-20 day ratios stay above 0.59 in 99.5 % of days).
   - **Terra alone (2000-11 – 2002-07):** no second satellite, so the same days of year in other years are the evidence, with a stricter < 2 % threshold.
   - **Undetermined:** days with < 100 expected detections are not judged from the data; zero detections inside a documented outage notice (`config/observation-events.json`) are then flagged ("documented + zero").
   - **Confirmed / suspected:** a flagged run overlapping a NASA/NOAA notice is confirmed, otherwise suspected. Notices never flag a day on their own.
   - **Monthly loss:** for each satellite and month, the share of expected detections lost on flagged days. A loss ≥ 5 % is **material**.
1. **VIIRS reference series V\***. One platform per month, never a sum: S-NPP when it covers the whole month and has no flagged day, else NOAA-20 × c₂₀, else NOAA-21 × c₂₁, each under the same condition. If every covering satellite has flagged days, the one with the smallest loss is used and the month is **reduced coverage** when that loss is material; nothing is scaled up to replace missing days. The cross-calibration factors c are ratios of sums over months both platforms observed completely without flagged days.
2. **VIIRS → MODIS, candidate A: stratified ratio.** k = Σ MODIS / Σ V\* per **zone** (H3 res-1 cell, ~600,000 km²) × month-of-year × overpass, fitted on **2012–2021** months with complete MODIS and VIIRS-reference coverage. Each level is shrunk toward its parent (zone → region-month → region) with pseudo-count κ = 20 VIIRS cell-days.
   **Candidate B: quantile mapping.** Empirical CDF matching of the region's monthly VIIRS reference x = V*day + V*night onto MODIS any-time cell-days over the same training months (ratio extrapolation outside the training range). An AOI gets the region estimate × its share of the region's x. A partial month is mapped at its full-month run rate and scaled back.
   **Selection rule:** quantile mapping only if its leave-one-year-out monthly MAE is strictly lower than the stratified ratio's. The rule was written down before the v2 fits but after the v1 Iberia results had been seen, so it is **not pre-registered** in the strict sense. Because the same held-out errors choose and describe the method, a **nested** leave-one-year-out score (the choice repeated inside each outer fold) is also reported. Result: US → stratified ratio, Iberia → quantile mapping, in every nested fold as well.
3. **Terra-only era.** Before Aqua (2002-07), MODIS-equivalent = Terra cell-days × (Terra∪Aqua / Terra), fitted the same way on 2002-07 – 2021 months with complete Terra and Aqua coverage. Months in which Terra itself lost a material share (June/July 2001) are reduced coverage.
4. **Period classes** (shown per month, in the legend and in every export row):
   - `terra-only-estimated` 2000-11 – 2002-06
   - `modis-observed` 2002-07 – 2021-12 (MODIS-only before 2012-01-20); a month whose Terra or Aqua lost a material share, or July 2002 (Aqua from the 4th), is reduced coverage
   - `viirs-estimated` 2022-01 – present: the selected estimator applied to V\*. Observed MODIS for these months stays visible in the raw view and in the drift diagnostic.
5. **Uncertainty.** Estimated months carry a 90 % multiplicative interval: the 5th–95th percentiles of observed / predicted over the held-out (leave-one-year-out, all parameters refitted per fold) predictions of the selected method; Terra-only months use the same construction. Coverage is itself measured out-of-sample. For AOIs smaller than the region a sampling term 1.645·c·√estimate widens both bounds, with an overdispersion factor c chosen and scored out-of-sample on held-out zone-months (US c = 1.65: coverage 79.9 % → 90.2 %; Iberia c = 1.05; validation §3). Areas smaller than a zone are not validated separately. Observed months carry no model interval. Annual totals sum the monthly bounds (conservative).
6. **Daily values.** A day's MODIS-equivalent = the month's estimate × the day's share of the month's reference series (observed MODIS, Terra, or the month's VIIRS reference platform). A day on which the reference satellite has a flagged gap (both Terra and Aqua, for observed MODIS) has no value: it is shown as no observation, not zero.
7. **Comparisons (app).** A month is compared with the same month in other years only if it has full coverage; the baseline uses only other years with full coverage and, on raw scales, the same set of satellites in orbit all month; at least 3 such years are required. Trends leave out years whose reduced months may miss more than 2 % of the year's total; on raw scales they use only years observed all year by the latest set of satellites. Early-warning windows and the daily climatology skip historical windows that contain unobserved or reduced days or (raw scales) a different set of satellites.

## Validation design

Leave-one-year-out over the training years at region scale (monthly any-time cell-days), every learned parameter refitted per fold, months with incomplete coverage excluded:

- **Baselines:** raw S-NPP (no calibration), one global ratio, quantile mapping, and the stratified ratio.
- **Metrics:** MAE, RMSE, mean signed error (bias), Pearson r, annual totals ratio, 90 % interval empirical coverage; nested MAE of the selection procedure; zone-scale annual error and zone-month interval coverage.
- **Drift diagnostic** 2022+: observed MODIS ÷ VIIRS-estimated MODIS-equivalent per year, complete-coverage months only.
- **Transfer:** the same procedure on Iberia, an independent fire regime.

## Limits (stated in the app)

- The product estimates what MODIS would have detected. It is not burned area, fire count or fire occurrence. Validation is against MODIS, not ground truth.
- Calibration assumes the MODIS/VIIRS relationship within a zone, season and overpass is stable across years. Fire-regime shifts toward smaller fires (which VIIRS detects and MODIS misses) would bias estimates.
- Clouds, smoke and observation opportunity are not modelled (no coverage denominators in FIRMS CSVs). Satellite outages are detected only where other satellites or climatology give evidence. Zero still means "no matching records".
- Small-area intervals are recalibrated at zone scale (~90 % out-of-sample); areas much smaller than a zone are not validated.
- In the US, observed near-real-time MODIS for September–November 2026 is 22–39 % below the VIIRS-based estimate, unlike Iberia; the cause is not established.
- AOI queries use whole res-5 cells whose centres fall in the AOI.
