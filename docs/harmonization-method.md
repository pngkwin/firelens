# Harmonization method `fcd-harmonize-v2`

Status 2026-11-15: implemented, fitted and validated for the US and Iberia (`src/data/v2/harmonize.ts`, `scripts/harmonize/fit.mjs`, numbers in `harmonization-validation.md`). The browser applies the published `calibration.json` with `src/data/v2/series.ts`; a test checks it reproduces the fit's own region series for all 313 months of both regions (relative difference < 10⁻⁴, from coefficient rounding).

**v2 changes from v1** (prompted by the Iberia transfer test): (1) the VIIRS-era estimator is chosen per region by a pre-registered rule, stratified ratio or quantile mapping; (2) 90 % intervals come from held-out (leave-one-year-out) residuals of the selected method instead of in-sample ratios; (3) the Terra-only era gets its own held-out interval.

This supersedes the "research plan" status of `harmonization-methodology.md` for the harmonized calendar. The raw sensor-specific views remain available unchanged.

## Products

| Product | Definition | Label in UI (scale selector, `src/data/v2/analysis.ts` `SCALES`) and exports |
|---|---|---|
| **Harmonized, MODIS-equivalent** (primary) | Estimated Terra∪Aqua fire-cell-days as the stable-orbit MODIS pair would record them | "MODIS-equivalent hotspots (harmonized, ~1 km fire-cell-days)"; monthly CSV `modis_eq_*` columns with `period_class` and `modis_eq_source` per row |
| Harmonized, VIIRS-level (secondary scale) | The S-NPP-scale VIIRS reference series (any-time); before VIIRS, MODIS-equivalent × the training ratio V*/MODIS for that month of year (estimated, interval not quantified) | "VIIRS-level (harmonized, S-NPP scale, ~1 km fire-cell-days)"; CSV `viirs_level_fire_cell_days`, `viirs_level_estimated` |
| Raw, any sensor | Fire-cell-days detected by **any** platform (union of masks; never a sum of detections) | "Raw fire-cell-days: any sensor"; CSV `raw_any_sensor` |
| Raw, per sensor | Fire-cell-days detected by MODIS (Terra ∪ Aqua) or by VIIRS (any platform) | "Raw fire-cell-days: MODIS (Terra ∪ Aqua)", "Raw fire-cell-days: VIIRS (any platform)"; CSV `raw_modis`, `raw_viirs` |
| Raw, per platform | Fire-cell-days detected by one platform (Terra, Aqua, S-NPP, NOAA-20, NOAA-21) | Not a UI scale; CSV `raw_terra`, `raw_aqua`, `raw_snpp`, `raw_noaa20`, `raw_noaa21` |
| Raw hotspots | FIRMS detections (pixels) after region clip and static mask, per sensor; never added across sensors | "Raw hotspots detected: MODIS (1 km pixels, Terra + Aqua)", "Raw hotspots detected: VIIRS (375 m pixels, all platforms)"; CSV `detections_<platform>` |

## Unit: fire-cell-day

One H3 resolution-8 cell (mean ≈ 0.74 km², close to a nadir MODIS 1 km pixel) on one UTC day with at least one detection. A VIIRS 375 m footprint is ~0.14 km², so several VIIRS pixels of one fire collapse into one cell-day: this removes most of the pixel-count inflation before any calibration. It does **not** remove VIIRS's higher sensitivity to small and cool fires, which calibration addresses. Each cell-day stores a bitmask of the platforms that detected it, separately for day and night overpasses (FIRMS `daynight`). Persistent non-vegetation sources are excluded: res-8 cells with ≥ 3 science-quality detections of FIRMS type 1 (volcano), 2 (other static land source) or 3 (offshore) making up ≥ 50 % of the cell's detections. The mask is applied per cell, so it also covers NRT rows, which carry no type.

## Overpass awareness

| Platform | Local equator crossing (nominal) | Role |
|---|---|---|
| Terra | ~10:30 / 22:30 | MODIS morning; drifted earlier after its 2020 final inclination manoeuvre and Oct 2022 orbit lowering |
| Aqua | ~13:30 / 01:30 | MODIS afternoon; left the A-Train in 2022 and drifted later |
| S-NPP, NOAA-20, NOAA-21 | ~13:30 / 01:30 | VIIRS afternoon; NOAA-20/21 ~50 min apart from S-NPP on the same orbit plane timing |

Calibration is fitted separately for day and night cell-days and recombined with a training overlap factor ρ(month) = Σ any / Σ (day + night) so a cell burning at both overpasses is counted once.

## Steps

1. **VIIRS reference series V\***. One platform per month, never a sum: S-NPP when it covers the whole month (through the last loaded day), else NOAA-20 × c₂₀, else NOAA-21 × c₂₁. The cross-calibration factors c are ratios of sums on months both platforms fully cover. This keeps V\* continuous when the number of VIIRS platforms changes (1 in 2012–18, 2 in 2018–23, 3 in 2023–26, 2 after S-NPP's end on 2026-11-02).
2. **VIIRS → MODIS, candidate A: stratified ratio.** k = Σ MODIS / Σ V\* (ratio of sums, robust to zero months) per **zone** (H3 res-1 cell, ~600,000 km²) × month-of-year × overpass, fitted on **2012–2021**, the overlap years before MODIS orbital drift. Each level is shrunk toward its parent (zone → region-month → region) with pseudo-count κ = 20 VIIRS cell-days, so sparse zones inherit the regional seasonal ratio instead of noise.
   **Candidate B: quantile mapping.** Empirical CDF matching of the region's monthly VIIRS reference x = V*day + V*night onto MODIS any-time cell-days over the training months (ratio extrapolation outside the training range). An AOI gets the region estimate × its share of the region's x. A partial month is mapped at its full-month run rate (x · days-in-month / days-observed) and scaled back.

   **Selection rule (pre-registered, v2):** quantile mapping is used only if its leave-one-year-out monthly MAE is strictly lower than the stratified ratio's. Result: US → stratified ratio (MAE 490 vs 871); Iberia → quantile mapping (54 vs 74). The choice and both MAEs are stored in `calibration.json` (`selection`) and shown in the app.
3. **Terra-only era.** Before Aqua (2002-07), MODIS-equivalent = Terra cell-days × (Terra∪Aqua / Terra), fitted the same way on 2002-07–2021.
4. **Period classes** (shown per month, in the legend and in every export row):
   - `terra-only-estimated` 2000-11 – 2002-06
   - `modis-observed` 2002-07 – 2021-12 (MODIS-only before 2012-01-20)
   - `viirs-estimated` 2022-01 – present: the selected estimator applied to V\* (US: stratified ratio k · V\* per zone and overpass; Iberia: quantile mapping). Observed MODIS for these months stays visible in the raw view and in the drift diagnostic.
5. **Uncertainty.** Estimated months carry a 90 % multiplicative interval: the 5th–95th percentiles of observed / predicted over the **held-out** (leave-one-year-out) predictions of the selected method; Terra-only months use the same construction on the Terra scaling. Coverage is itself measured out-of-sample (each year's residuals tested against quantiles computed without that year) and reported. For AOIs smaller than the region a Poisson sampling term 1.645·√estimate widens both bounds. Observed months carry no model interval. Annual totals sum the monthly bounds (conservative: errors assumed fully correlated).
6. **Daily values.** A day's MODIS-equivalent = the month's estimate × the day's share of the month's reference series (observed MODIS, Terra, or the month's VIIRS reference platform). Days therefore always sum to the monthly value. Partial current months are compared with other years month-to-date (days 1..D).

## Validation design

Leave-one-year-out over the training years at region scale (monthly any-time cell-days):

- **Baselines:** raw S-NPP (no calibration), one global ratio, quantile mapping (empirical CDF matching with ratio extrapolation), and the proposed stratified ratio.
- **Metrics:** MAE, RMSE, mean signed error (bias), Pearson r, annual totals ratio, 90 % interval empirical coverage.
- **Drift diagnostic** 2022+: observed MODIS ÷ VIIRS-estimated MODIS-equivalent per year. A systematic departure from 1 quantifies the MODIS orbit-drift effect that motivated the switch.
- **Transfer:** the same procedure on Iberia, an independent fire regime.

## Limits (stated in the app)

- The product estimates what MODIS would have detected. It is not burned area, fire count or fire occurrence.
- Calibration assumes the MODIS/VIIRS relationship within a zone, season and overpass is stable across years. Fire-regime shifts toward smaller fires (which VIIRS detects and MODIS misses) would bias estimates.
- Clouds, smoke and observation opportunity are not modelled (no coverage denominators in FIRMS CSVs). Zero still means "no matching records".
- AOI queries use whole res-5 cells whose centres fall in the AOI.
