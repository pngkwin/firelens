# What goes beyond the original challenge

The challenge asks for MODIS and VIIRS hot spots to be harmonized. FireLens adds the following:

1. **Outage-aware observation audit.** Zero detections are never treated as proof of an outage; a day is flagged only on cross-satellite or climatological evidence. All 13 documented NASA/NOAA outage notices were re-verified against their original pages, and all are recovered under 9 threshold settings. Outage months are excluded from baselines, anomalies and trends instead of being counted as low-fire months.
2. **Validation with no information leaking between years.** Every parameter is refitted per held-out year. The method choice is re-scored with a nested procedure. Prediction intervals are measured out of sample, including a recalibrated small-area interval whose evaluation is documented exactly.
3. **Evidence Lab.** The held-out records are published, so judges can download the validation themselves (CSV/JSON).
4. **Sensor Disagreement Atlas.** Exact, exclusive MODIS-only, VIIRS-only and both-sensor fire-cell-days by month, day/night and season, with a linked map layer.
5. **Sensor-Transition Investigator.** For any area, it shows the naive splice next to the harmonized record. Across the US, California and Texas the naive record shows a trend that is not there, and in Iberia its sign is wrong.
6. **Fire Season Evolution.** Seasonal profiles normalized per year, with exact year-level permutation tests and multiple-testing correction, plus a raw MODIS vs raw VIIRS check of how the measurement system affects the seasonal picture. The results report what the data say, which so far is "no detectable change".
7. **US specialization.** A curated documented-fires layer quoting CAL FIRE, Texas A&M Forest Service, the Texas State Climatologist and TPWD, with CAL FIRE origin points on the map. A Texas research case (April 2011, Smokehouse Creek 2024) shows that burned area and detected burning are different measures.
8. **Evidence-backed regional brief.** Planning context from the historical pattern (explicitly not a forecast), with uncertainty, documented fires and provenance hashes, as Markdown, HTML/PDF and print.
9. **Reproducibility.** A hash-verified data bundle, a provenance audit that reconciled 19,270 recent records with fresh NASA FIRMS files, exact reconciliation of raw rows to published cell-days, and 241 unit plus 31 browser tests.
