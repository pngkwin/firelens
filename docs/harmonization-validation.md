# Harmonization validation: `fcd-harmonize-v3`

Regenerated 2026-11-15 for method v3 with `node scripts/harmonize/fit.mjs --region us` and `--region iberia` from `public/data/v2/<region>` (313 months each, 2000-11 – 2026-11-14). Raw numbers: `data/processed/harmonize/<region>-validation.json`. Method: [harmonization-method.md](harmonization-method.md).

**What changed from v2 and why.** A scientific audit found that satellite outages were invisible to the method: the VIIRS reference used S-NPP for any month inside S-NPP's overall service dates, so months in which S-NPP was not observing for days (safe modes, GPS anomalies) were read as low fire. US July 2024 came out at 7,697 MODIS-equivalent fire-cell-days against 15,582 observed by MODIS, "below the historical median even at the upper end of the 90% interval". v3 adds an observation-coverage audit (section 0), makes the reference skip satellites with flagged days, leaves months with incomplete MODIS or VIIRS coverage out of fitting and validation, refits every learned parameter inside each held-out fold, and reports a nested score of the method choice. Section 9 compares v2 and v3.

**What the validation measures.** Every score below compares predictions with MODIS that was actually observed (the target scale). It shows that MODIS-equivalent values are reproducible from VIIRS. It is not a comparison with fires on the ground; neither sensor is ground truth.

## Data behind the numbers

| Item | Value |
|---|---|
| Sources (US) | FIRMS Archive Download (requests 850633 MODIS C6.1, 850636 S-NPP, 850637 NOAA-20, 850638 NOAA-21; country = United States) for science-quality data; FIRMS area API for NRT (MODIS from 2026-09-01, VIIRS from 2026-08-01) |
| Archive ↔ API agreement (US) | Every archive row on 1,045–1,115 overlapping days per source matched an API row exactly (lat, lon, date, time, platform) |
| Region clip (US) | US Census 1:10M nation polygon, H3 res-7 cell-centre rule, identical for archive and API rows |
| Static-source mask (US) | 5,618 res-8 cells with ≥ 3 volcano/static/offshore science-quality detections making up ≥ 50 % of the cell's detections |
| Detections retained / masked static / outside clip (US) | 14,627,132 / 2,591,224 / 163,698 |
| Training years | 2012–2021 (both sensors in orbit, MODIS orbits stable) |
| Training months excluded for coverage | 7 of 120 (identical in both regions; listed in `calibration.json` `excludedMonths`): 2012-01 (S-NPP from the 20th only), 2012-03 (S-NPP lost 6.1 % with no second VIIRS), 2012-12, 2014-03, 2014-12, 2016-02, 2016-03 (Terra lost ≥ 5 % of its expected detections) |

## 0. Observation-coverage audit

Evidence: daily detections per satellite from every published region (US + Iberia pooled; outages are spacecraft-wide). Rule (`src/data/v2/coverage.ts`): a satellite-day is a **gap** when it recorded < 10 % of the detections expected from another satellite observing the same day (expected = that satellite's count × their median ratio over ±45 days, at least 100 expected); a VIIRS day judged against another VIIRS is **reduced** below 50 % (the 0.5th percentile of normal S-NPP/NOAA-20 day ratios is 0.59). Terra alone (2000-11 – 2002-07) is judged against the same days in other years, with a stricter 2 % threshold. Days with < 100 expected detections are not judged from the data; there, zero detections inside a documented outage notice count as a gap. A flagged run overlapping a NASA/NOAA notice (`config/observation-events.json`) is **confirmed**, otherwise **suspected**.

| Result | Value |
|---|---|
| Flagged runs | 69 (13 confirmed, 56 suspected, mostly single days) |
| Documented notices recovered from the records | 13 of 13 |
| Zero-detection days left undetermined (too little expected fire to judge) | Terra 32, Aqua 5 |
| Satellite-months with ≥ 5 % of expected detections lost | 40 |

Confirmed outages (gap + reduced days found in the records; notice in brackets):

| Satellite | Days flagged | Notice |
|---|---|---|
| Terra | 2001-06-15 – 07-02 (18) | power supply 2 failure |
| Terra | 2016-02-18 – 02-27 (10) | safe mode (no data 02-19 – 02-27) |
| Terra | 2022-10-11 – 10-23 (13) | constellation-exit manoeuvres |
| Aqua | 2022-04-01 – 04-16 (16) | safe mode |
| S-NPP | 2022-07-27 – 08-10 (15) | safe mode (data lost 07-26 – 08-20) |
| S-NPP | 2023-07-26 – 07-27 (2) | safe mode |
| S-NPP | 2024-05-30 – 06-03 (5) | GPS anomaly, processing suspended |
| S-NPP | 2024-07-10 – 07-16 (7) | GPS anomaly, processing suspended |
| S-NPP | 2024-07-24 – 07-29 (6) | safe hold |
| S-NPP | 2024-11-03 – 11-06 (4) | GPS anomaly |
| S-NPP | 2026-06-01 – 06-02, 2026-07-11 – 07-16, 2026-08-03 – 08-04 | 2026 anomalies |

**Notice verification (2026-11-15).** Each notice in `config/observation-events.json` was re-read at its primary source and carries a `verification` record. 9 match; 3 were corrected: Terra 2016 (NASA: no data 02-19 – 02-27; was 02-18 – 02-24), Terra 2022 (NASA: 10-10 – 10-19; was 10-22 from a NOAA notice), S-NPP July 2024 safe hold (NASA gives the spacecraft outage 05:28–18:22 UTC on 07-24; the end moved from 08-01, a Copernicus notice, to 07-29, VIIRS back in operation per NOAA, the latter from a search summary). Terra 2001: the start (03:56 GMT 2001-06-15) is verified at MCST; the end comes from an Earthdata forum post that now returns 404. Correcting the dates did not change any flagged day; it merged Terra's 2016 run into one confirmed run.

**Sensitivity of the detection thresholds** (detection only; calibration not refitted per variant):

| Assumption | Flagged satellite-days | Runs | Confirmed runs | Notices recovered | Satellite-months ≥ 5 % lost |
|---|---:|---:|---:|---:|---:|
| Baseline | 196 | 69 | 13 | 13 / 13 | 40 |
| gap < 5 % / < 20 % | 186 / 232 | 60 / 102 | 13 / 13 | 13 / 13 | 35 / 50 |
| reduced < 35 % / < 65 % | 185 / 220 | 63 / 88 | 13 / 13 | 13 / 13 | 37 / 40 |
| min. expected 50 / 200 | 213 / 167 | 82 / 52 | 13 / 13 | 13 / 13 | 46 / 32 |
| material loss 2 % / 10 % | 196 / 196 | 69 / 69 | 13 / 13 | 13 / 13 | 60 / 20 |

Every notice is recovered under every variant; the thresholds mainly change how many single suspected days are flagged, and the materiality threshold changes how many months are marked reduced.

Suspected runs of 3+ days with no notice found: Terra 2002-03-20 – 03-28 (9), Aqua 2002-07-30 – 08-07 (9, Aqua commissioning), S-NPP 2025-07-05 – 07-07, 2026-03-09 – 03-12, 2026-04-28 – 04-30, NOAA-20 2023-07-19 – 07-22, NOAA-21 2024-02-26 – 02-28.

## 1. Leave-one-year-out, monthly US totals (any-time fire-cell-days)

Each year 2012–2021 is predicted from a model refitted on the other nine years: zone ratios, quantile map, the day/night overlap factor ρ and the NOAA-20/21 cross-calibration factors are all refitted per fold (v2 fitted ρ and the cross-calibration on all years). 113 held-out months with complete coverage.

| Method | MAE | RMSE | Mean signed error | Pearson r | Σ predicted / Σ observed |
|---|---:|---:|---:|---:|---:|
| Raw S-NPP, no calibration | 9,694 | 11,157 | +9,694 | 0.987 | 2.080 |
| Single global ratio | 882 | 1,142 | −13 | 0.982 | 0.999 |
| Quantile mapping | 884 | 1,160 | −10 | 0.980 | 0.999 |
| **Stratified ratio (selected)** | **482** | **750** | **−11** | **0.992** | **0.999** |
| Nested (selection repeated inside each held-out year) | 482 | 750 | −11 | 0.992 | 0.999 |

Mean observed MODIS month: 8,976. The selected method's MAE is 5.4 % of a typical month. The nested run chose the stratified ratio in all ten outer folds, so selecting on the same held-out errors did not inflate the US score.

## 2. Held-out annual totals (US, stratified ratio)

| Year | Observed MODIS | Estimated from VIIRS | Ratio |
|---|---:|---:|---:|
| 2012 | 91,078 | 86,907 | 0.954 |
| 2013 | 83,389 | 84,218 | 1.010 |
| 2014 | 67,796 | 67,786 | 1.000 |
| 2015 | 117,899 | 122,086 | 1.036 |
| 2016 | 72,124 | 70,568 | 0.978 |
| 2017 | 124,368 | 118,430 | 0.952 |
| 2018 | 107,922 | 106,877 | 0.990 |
| 2019 | 89,363 | 95,920 | 1.073 |
| 2020 | 127,505 | 127,865 | 1.003 |
| 2021 | 132,808 | 132,356 | 0.997 |

Totals cover only the year's months with complete coverage (2012, 2014 and 2016 have excluded months). Range 0.952–1.073: differences smaller than about 7 % between two years should not be read as a ranking.

## 3. Zone scale (AOI-like) and small-area intervals

Zones are H3 res-1 cells (~600,000 km²). 218 held-out zone-years with ≥ 500 observed fire-cell-days.

| Coefficients applied | Median \|annual error\| | 90th percentile |
|---|---:|---:|
| Zone-specific (selected, shrunk toward region) | **5.0 %** | **17.0 %** |
| Region-wide only | 9.8 % | 34.3 % |
| Region quantile map × zone share of VIIRS | 14.7 % | 50.7 % |

**Small-area interval coverage and recalibration.** The original small-area interval (region interval widened by 1.645·√estimate, a Poisson term) covered only **82.5 % / 75.9 % / 82.0 %** of held-out US zone-months (predicted < 30 / 30–300 / ≥ 300 fire-cell-days; n = 1,408 / 1,320 / 744), 79.9 % overall. Fire-cell-days are overdispersed (fires cluster), so the sampling term is now widened by a factor c: v·[lo, hi] ∓ 1.645·c·√v. c is the smallest value giving ≥ 90 % coverage on the zone-months of the *other* years and is scored on each held-out year (leave-one-year-out), so the coverage below is out-of-sample. US: c = 1.65 (1.60–1.65 across folds), coverage **93.3 % / 88.0 % / 88.2 %**, **90.2 %** overall. Iberia: c = 1.05, 86.4 / 94.0 / 89.2 % → 87.5 / 95.3 / 91.9 %, 89.1 → 90.5 % overall. The factor is published as `calibration.json` `aoiInterval` and used by the app for every area smaller than the region. Validated at zone scale (~600,000 km²) only; areas much smaller than a zone (most states, drawn polygons) are not validated separately.

## 4. Uncertainty calibration (region scale)

Interval for an estimated region-month: 5th–95th percentiles of held-out residual ratios observed / predicted. US **×[0.891, 1.132]**, out-of-sample coverage **88.5 %** (n = 113). Coverage is slightly under nominal.

## 5. Terra-only era (2000-11 – 2002-06)

Terra → Terra∪Aqua scaling validated by leave-one-year-out over 2002-07 – 2021 (218 months with complete Terra and Aqua coverage, ρ refitted per fold): MAE 364, RMSE 506, mean signed error −31 (−0.3 %), r = 0.996. Regional factors: day 2.23, night 1.35. Interval ×[0.929, 1.112], out-of-sample coverage 88.5 %. June and July 2001 (Terra power-supply failure, 75 % and 10 % of Terra's expected detections lost) are marked reduced coverage: the scaling cannot replace days Terra did not observe.

## 6. VIIRS cross-calibration (to the S-NPP scale)

Ratio of sums over months both satellites observed completely, now excluding months with a flagged day for either.

| Platform | S-NPP / platform, v3 | Months | v2 (outage months included) |
|---|---:|---:|---:|
| NOAA-20 | 0.976 | 76 | 0.957 (103) |
| NOAA-21 | 1.010 | 27 | 0.969 (44) |

v2's factors were biased low by S-NPP outages (S-NPP sums missing days). Without that bias NOAA-20 records about 2.5 % more fire-cell-days than S-NPP and NOAA-21 about 1 % fewer.

## 7. Coefficients (region level, US)

MODIS / VIIRS-reference per overpass: day 0.587, night 0.246. The day ratio is stable through the year (0.53–0.68); the night ratio is strongly seasonal (0.046 in January to 0.350 in July): VIIRS detects far more small or cool night fires, especially outside the main fire season. Overlap factor ρ: 0.997 (winter) to 0.897 (August). Zone coefficients are published in `public/data/v2/us/calibration.json`.

## 8. Orbit-drift diagnostic (why 2022+ is VIIRS-estimated)

Observed MODIS ÷ VIIRS-estimated MODIS-equivalent, months with complete MODIS and VIIRS-reference coverage only.

| Year | Months used (skipped for coverage) | Observed MODIS | VIIRS-estimated | Observed / estimated |
|---|---|---:|---:|---:|
| 2022 | 9 (3: Terra Jan, Aqua Apr, Terra Oct) | 87,245 | 88,250 | 0.989 |
| 2023 | 12 | 82,427 | 87,472 | 0.942 |
| 2024 | 12 | 107,066 | 113,680 | 0.942 |
| 2025 | 11 (1: Terra Mar) | 79,928 | 88,940 | 0.899 |
| 2026 (to Nov 14) | 11 | 91,838 | 104,724 | 0.877 |

In 2012–2021 the held-out ratio scatters around 1 (0.952–1.073). Observed MODIS falls increasingly below the stable-orbit expectation, about 6 % in 2023–2024 and 10–12 % in 2025–2026, consistent with Terra's earlier and Aqua's later crossing times. 2022 alone (0.989) does not show drift; the 2022 switch date is a documented choice, and raw MODIS for 2022+ stays available. This is supporting evidence, not independent proof: fire-regime change can also move the ratio.

**Unexplained recent discrepancy.** In the US, observed near-real-time MODIS for September, October and November 2026 is 0.78, 0.61 and 0.63 of the estimate, a step down from 1.08–1.13 in June–August 2026 that coincides with the switch from science-quality to near-real-time MODIS on 2026-09-01. Iberia shows no such step (1.25, 1.20, 0.97). The cause (orbit drift, near-real-time processing, or regional fire conditions) is not established. MODIS-equivalent values for these months come from VIIRS and are not affected; raw MODIS for these months should be read with caution.

## 9. v2 → v3 comparison

| Measure | v2 | v3 |
|---|---|---|
| US monthly MAE / RMSE / r (held out) | 490 / 756 / 0.991 (119 months) | 482 / 750 / 0.992 (113 months) |
| US interval, coverage | ×[0.890, 1.133], 89.1 % | ×[0.891, 1.132], 88.5 % |
| US zone median / P90 annual error | 4.8 % / 18.5 % | 5.0 % / 17.0 % |
| US Terra-only MAE / r | 408 / 0.994 | 364 / 0.996 |
| Iberia monthly MAE / RMSE / r (quantile mapping) | 54 / 82 / 0.989 | 55 / 83 / 0.989 |
| Iberia interval, coverage | ×[0.763, 1.316], 88.2 % | ×[0.739, 1.296], 89.4 % |
| Iberia Terra-only MAE | 46 | 43 |

Held-out performance is essentially unchanged: removing the small leak (ρ and cross-calibration fitted on all years) cost nothing measurable, and excluding outage months removed a few large errors. The material change is in outage months outside the training period:

| Month | Observed MODIS | v2 estimate (obs/est) | v3 estimate (obs/est) | v3 VIIRS reference |
|---|---:|---:|---:|---|
| US 2022-08 | 5,971 | 4,208 (1.42) | 6,187 (0.97) | NOAA-20 |
| US 2024-07 | 15,582 | 7,697 (2.02) | 15,270 (1.02) | NOAA-20 |
| US 2025-07 | 12,955 | 10,466 (1.24) | 12,518 (1.03) | NOAA-20 |
| Iberia 2022-08 | 1,827 | 1,130 (1.62) | 1,579 (1.16) | NOAA-20 |
| Iberia 2024-07 | 290 | 147 (1.97) | 256 (1.13) | NOAA-20 |

US July 2024 moves from "below the historical median even at the upper end of the 90 % interval" (73 % of median, percentile 28) to above the median.

## 10. Fire-season evolution (app feature, `src/data/v2/season.ts`)

Descriptive analysis of the harmonized record, not part of the calibration. Each complete year is normalized to its own annual total (years whose outages may miss > 2 % of the total are left out, as for trends); a period profile is the equal-weight mean of its years. 2003–2012 vs 2013–2021 (both observed MODIS) are compared by exact year-level permutation tests of three statistics (mean yearly circular centre, mean yearly concentration R, mean months holding 80 %), Holm-corrected. Results (published bundle, checked by `season.test.ts`):

| Area | Peak month 2003–12 / 2013–21 | Busiest 3 months | Smallest Holm p |
|---|---|---|---|
| Texas (us-48) | Mar / Mar | Feb–Apr 39 % / Jan–Mar 38 % | 0.90 |
| California (us-06) | Aug / Aug | Aug–Oct 50 % / Aug–Oct 65 % | 0.20 (concentration R 0.47 → 0.61, raw p = 0.067) |
| United States | Aug / Aug | Jul–Sep 35 % / Jul–Sep 41 % | 0.49 |
| Iberia | Aug / Aug | Aug–Oct 48 % / Aug–Oct 50 % | 1.00 |

No change in seasonal timing, concentration or spread survives correction in any of these areas; with 7–10 years per period only large shifts are detectable, and years are treated as exchangeable (no model of drought cycles). Raw S-NPP vs raw MODIS over 2013–2021 puts Texas's seasonal centre 0.45 months later (VIIRS sees relatively less of the March peak), so the measurement system changes the seasonal picture somewhat in Texas and hardly at all in California and Iberia.

## Small-area interval: how the 90.2 % was evaluated

US: 3,472 zone-months (H3 res-1, ~600,000 km²) from 2012–2021, each predicted by the method refitted without its year; the overdispersion factor c was also chosen without that year (per-year c 1.60–1.65; published c = 1.65 from all years). A hit means observed MODIS lies inside v·[lo, hi] ∓ 1.645·c·√v. Pooled coverage 79.9 % (c = 1) → 90.2 %; by predicted size < 30: 93.3 %, 30–300: 88.0 %, ≥ 300: 88.2 %. Limits: the target is observed MODIS; the region band [lo, hi] used inside this check is fitted on all training years (small in-sample component); zone-months within a year are correlated; coverage is pooled across zones and seasons; areas smaller than a zone (states, drawn shapes) are not validated.

## Limits

- Validation compares against MODIS itself, not ground truth.
- All held-out years come from one decade (2012–2021).
- The per-region method-selection rule was written down after the v1 Iberia results had been seen; it is not pre-registered in the strict sense. The nested score (selection repeated inside each held-out year) is reported for that reason; it equals the reported score in both regions because the same method won every fold.
- Interval coverage is slightly under nominal at region scale (US 88.5 %, Iberia 89.4 %). Zone-scale intervals were under nominal (US 76–83 %) and are now recalibrated to about 90 % out-of-sample; areas smaller than a zone remain unvalidated.
- Coverage detection pools both regions and works at UTC-day resolution: an outage starting mid-day can affect one region's overpass and not the other's. Days with too little fire to judge are not flagged unless a notice and zero detections agree. Suspected runs have no independent confirmation.
- Months marked reduced coverage are not corrected: they are lower bounds and are kept out of baselines, anomaly statistics and trends.
- No cloud/smoke or observation-opportunity correction; zero means no matching records.

## Iberia (transfer)

Same code and settings (κ = 20, training 2012–2021), coefficients fitted on Iberia's own overlap years. This tests whether the *pipeline and method* transfer, not whether US coefficients do.

| Item | Value |
|---|---|
| Source | FIRMS area API only (no archive request), box [-10, 36, 4, 44], 3,886 windows, 0 failed |
| Clip | world-atlas 1:50M countries 724 (Spain) + 620 (Portugal); Canary Islands, Azores and Madeira are outside the box and excluded |
| Static mask | 575 cells (of 3,584 with any type 1/2/3) |
| Detections retained / masked static / outside clip | 706,808 / 128,813 / 188,250 (the box includes southern France and northern Morocco) |

**Monthly totals, leave-one-year-out (113 months; mean observed month 436 fire-cell-days)**

| Method | MAE | RMSE | Mean signed error | r | Σ pred / Σ obs |
|---|---:|---:|---:|---:|---:|
| Raw S-NPP | 364 | 441 | +364 | 0.982 | 1.836 |
| Single global ratio | 84 | 152 | −0.1 | 0.984 | 1.000 |
| **Quantile mapping (selected)** | **55** | **83** | **0.0** | **0.989** | **1.000** |
| Stratified ratio | 65 | 160 | −12 | 0.966 | 0.972 |
| Nested selection | 55 | 83 | 0.0 | 0.989 | 1.000 |

**Annual held-out ratios (estimated / observed), quantile mapping:** 2012 0.923, 2013 1.035, 2014 1.176, 2015 1.036, 2016 1.022, 2017 1.017, 2018 0.977, 2019 1.036, 2020 0.917, 2021 0.880. Stratified ratio for comparison: 2012 0.859, 2017 0.813, 2014 1.311.

**Zone scale:** only 13 zone-years ≥ 500; median |annual error| 7.5 % (quantile map × zone share, the method the app uses for Iberia areas), 11.2 % (zone ratios), 10.8 % (region ratios).

**Interval:** ×[0.739, 1.296], out-of-sample coverage 89.4 %, about 2.4× wider than the US.

**Terra-only:** MAE 43, r = 0.995, bias +0.2 %. **Cross-calibration:** NOAA-20 0.969, NOAA-21 1.009.

**Drift diagnostic (observed / estimated, complete-coverage months):** 2022 1.089, 2023 1.013, 2024 0.996, 2025 1.032, 2026 1.016.

### What Iberia shows

1. **The pipeline transfers unchanged** (config only: box, clip polygon, sources).
2. **The US method does not win everywhere.** In a small region (≈ 4 % of US fire-cell-days) the zone × month × overpass ratios overfit; quantile mapping has lower MAE and half the RMSE, and the nested run picks it in every fold.
3. **Linear ratios under-estimate extreme fire years.** With the stratified ratio the largest held-out years (2012, 2017, the 2017 Portugal/Galicia fires) come out 14–19 % low; quantile mapping, which is non-linear, brings 2017 to 1.017.
4. **No measurable MODIS drift in Iberia,** unlike the US. The 2022 switch to VIIRS-based values is kept for consistency; in Iberia it changes little.
