# Harmonization methodology: research plan, not a validated index

2026-11-15. **Status:** reproducible common-grid preprocessing and descriptive comparisons implemented; empirical calibration, exposure correction, validated harmonization and historical anomaly findings are not implemented. The current calendar remains sensor-specific raw detection counts.

## Scientific question and evidence

FireLens must separate changes in burning from changes in the observing system. Its present evidence is a supplied regional archive subset: MODIS Terra/Aqua 6,827 records and VIIRS S-NPP 47,364, each spanning 2024 at the instrument level. This is one year of overlap, not a multi-decade or global validation dataset. Full-period inventories are not measures of equivalent observation opportunity. Exact geographic request metadata, coverage masks and independent event labels are absent.

NASA documents MODIS detections as nominal 1 km pixel centers, with larger pixels toward the scan edge; VIIRS 375 m uses a different observation footprint and detection response. UTC acquisition times, source platform, original confidence and product version are essential covariates, not nuisance labels to discard. [MODIS technical attributes](https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_MODIS_Firehotspots.html), [VIIRS technical attributes](https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_VIIRS_Firehotspots.html).

The established VIIRS 375 m algorithm uses contextual thermal tests with day/night differences and cloud/background validity requirements. It is not simply a smaller MODIS pixel. [Schroeder et al. (2014), algorithm and initial assessment](https://directreadout.sci.gsfc.nasa.gov/publications_documents/Schroeder_et_al_2014b_RSE.pdf). MODIS Collection 6 also has product-specific detection and false-alarm procedures; its scientific lineage is documented in [Giglio, Schroeder & Justice (2016), NASA publication record](https://ntrs.nasa.gov/citations/11507409423003).

NASA distinguishes independently generated VIIRS 750 m and 375 m active-fire products; the 750 m algorithm was adapted specifically for MODIS continuity, whereas 375 m adds tests for its particular bands. Our archive is the 375 m product, so continuity claims for 750 m cannot be transferred to it without evaluation. [NASA VIIRS product documentation](https://viirsland.gsfc.nasa.gov/Products/NASA/FireESDR.html).

No linear multiplier based on nominal pixel areas is justified by these facts. More pixels, different overpasses, event duration, cloud/smoke, scan geometry and contextual detection thresholds can each change record counts. Neither instrument is ground truth. FRP, brightness, counts, burned area and unique events have different units and targets; they must not be substituted for one another.

## Candidate A — common spatial and temporal representation

**Proposed MVP:** keep a paired sensor/platform historical detection calendar on the same geography and UTC time bins. The implemented H3 pipeline is this representation. It is a foundation for comparison, **not a completed cross-sensor harmonization**.

Representation: retained detection counts and occupied cells by UTC day/month/year, sensor, platform, source version and H3 cell. Default H3 5, with 4 and 6 for sensitivity. H3 areas are unequal; actual area is available, and no density is implied. Daily source data allows alternative monthly/yearly bins without inventing sub-daily coverage. See [H3 statistics](https://h3geo.org/docs/core-library/restable/).

**Assumptions / inputs.** Correct coordinates and UTC parsing; explicit source-version deduplication; one documented point-in-cell rule; comparable query footprints when claiming between-sensor comparisons. Existing CSVs support the count representation. Coverage-adjusted rates would additionally require satellite/clear-sky opportunity denominators; those are not in the supplied CSVs.

**What becomes comparable.** Bin identity, period boundaries, count definition, platform attribution, and a reproducible description of where/when each instrument recorded detections. Month-to-month comparisons within a stable instrument/product remain descriptive, subject to exposure changes. Equal bins do not imply equal sensitivity, footprint, observation times or complete coverage. Empty bins are not automatically observed fire-free bins.

**Advantages.** Transparent, auditable, feasible within a hackathon, supports multi-year retrieval and independent sensor streams. Occupancy can be studied without pretending that multiple pixels are unique events. Retained counts and source attribution remain inspectable.

**Bias / limitations.** Grid boundaries, unequal cell areas, arbitrary aggregation interval, persistent industrial/volcanic anomalies, repeated observations of long-lived fires, platform mixtures and missing opportunities. Coarse bins can merge unrelated activity; fine bins can split physically related detections. Cell-center ROI inclusion is approximate. Counts and binary occupancy still have different detection responses.

**Validation.** Already implemented: identity/count reconciliation at all spatial scales, deterministic output, date/platform/region tests and integrity checks. Needed scientifically: externally specified footprint/exposure checks, type-specific sensitivity, independent geolocation/acquisition matching review, and comparisons across additional years and regions. Common-grid data-engineering validation must not be presented as validation of sensor equivalence.

**Uncertainty.** Report unknown coverage, record-date partial periods, unresolved product changes and grid/interval sensitivity. Do not attach invented probabilistic intervals. Once repeated independent blocks exist, resampling whole spatial/time blocks could characterize sampling variability conditional on a defined population; that would still omit unknown systematic instrument bias unless separately modeled.

**Challenge suitability / time.** This is the recommended immediate public deliverable: a transparent linked historical activity calendar with parallel sources, provenance and disclosed limits. It answers where the sources agree or differ and prepares defensible inputs for later calibration. It must be labeled “sensor-specific observations,” not “harmonized fire activity.” Engineering implemented now; scientific equivalence remains open.

## Candidate B — empirical calibration on overlapping observations

**Research proposal only.** Define the intended output before fitting. One possible target is a MODIS-reference-scale expected detection count per common cell/month conditional on a defined observation regime. That is a reference measurement scale, not true fire count or burned area. A second possible target is probability of observed activity per eligible bin; this requires defensible negative/exposure observations. Choose one target and unit explicitly rather than blending them.

**Inputs / assumptions.** Multiple overlap years, several ecologically distinct regions and fire seasons, platform identity, processing lineage, exact acquisition time, scan/track, type codes, independent exposure/QA information, and consistent spatial support. Matching observed bins must have sufficient common support in covariates and exposure. A calibration trained only on detected pixels conditions on detection and can be selection-biased; absence of a detection cannot be used as a verified negative. Assume any transfer relationship is stable only within evaluated product, region and observation regimes.

**First experiments.** Inspect scatter/distribution plots and within-regime residuals. Compare a transparent constant-reference baseline and a training-only multiplicative baseline with a simple count regression using exposure offsets only when denominators are available. A Poisson count model may be a diagnostic baseline; evaluate overdispersion before considering a negative-binomial extension. Consider day/night, satellite and regional interactions only if sample support permits. Do not adopt machine learning or zero inflation by default. Occupancy models need separate definitions/eligibility. These are proposed alternatives; no coefficients have been fitted in this iteration.

**Advantages.** A clearly defined, externally evaluated reference scale could eventually support continuity and estimated uncertainty rather than raw-count pooling. Stratification could reveal conditions under which transfer fails.

**Bias / limitations.** Conditional dependence, repeated pixels from the same fire, errors in both sensors, unmeasured opportunity and cloud, persistent sources, small-fire response, confounding by platform/local overpass time, collection changes, geographic/seasonal domain shift and extrapolation before VIIRS existed. Platform and day/night effects cannot be identified reliably when the available strata lack overlap. A well-fitting 2024 relationship does not establish transfer to 2001 or a different biome. Matching only close acquisitions may reduce timing differences but changes the target population and introduces selection bias.

**Validation / uncertainty.** Use the blocked protocol below and report predictive intervals only after a defensible model/resampling procedure and held-out calibration checks. Distinguish variability of expected reference-scale estimates from prediction uncertainty and from unquantified structural bias. Report unsupported regimes as unavailable rather than widening arbitrary error bars. No confidence interval, accuracy or “validated” label is currently justified.

**Challenge suitability / time.** More ambitious and potentially useful after more data and exposure evidence arrive. A clearly separated notebook/script experiment is feasible; a public calibrated multi-decade calendar is not defensible with only the present year and unknown coverage. Do not substitute a global VIIRS/MODIS count ratio as a shortcut.

## Validation protocol and release gate

This is a proposed study design, not results:

1. Freeze raw files, exclusions, version policy, geography, target quantity, eligible observation definition and processing hashes. Identify instrument/product transitions and non-vegetation thermal sources before fitting. Choose independent external validation data suitable for the target; burned-area products are contextual evidence, not one-to-one active-fire truth.
2. Acquire enough overlap years to reserve complete years/seasons for held-out evaluation. Reserve spatial blocks/regions as a second transfer evaluation. Keep detections from the same event/neighborhood together; estimate dependence scale on training data and choose block separation before examining held-out scores. Do not randomly split individual pixels. Structured-data cross-validation can otherwise underestimate prediction error; [Roberts et al. (2017)](https://nsojournals.onlinelibrary.wiley.com/doi/10.1111/ecog.02881) discusses blocking aligned with the intended transfer problem.
3. Keep fitting, hyperparameter/stratum choice and final held-out evaluation separate. With one year, a within-year blocked diagnostic can only be exploratory; no between-year generalization claim is possible. Do not repeatedly reuse the held-out year to choose the method.
4. Baselines: unchanged sensor-specific series (no calibration), training-only regional/seasonal expected-count baseline, and a single training-only scale factor if its target/eligibility is justified. Never estimate a factor from all years and then call held-out performance independent.
5. For held-out reference-scale counts: MAE in records/bin, RMSE for larger errors, mean signed error, observed/predicted totals by region/platform/daynight, and suitable count deviance if distribution assumptions hold. For predictive intervals: empirical held-out coverage and width. Avoid percentage errors with zero denominators. For occupancy with valid independent labels: precision/recall and probability calibration/Brier score; paired sensor detection alone is not an independent label. Report support and sample sizes, not only an overall score.
6. Sensitivity: H3 4/5/6; daily/monthly/yearly bins; grid-boundary alternatives; vegetation-only versus all source types; source-confidence policies evaluated within each instrument; product versions; exposure eligibility; pair-distance/time tolerances. Register choices before final testing. Current descriptive co-occupancy sensitivity is not parameter optimization.
7. Uncertainty: resample whole independent blocks only after their definition is justified; retain model parameter/observation uncertainty separately. Assess interval calibration on untouched data. Qualify structural uncertainty (coverage, unobserved bias, pre-VIIRS extrapolation) separately; do not hide it inside an unsupported numeric interval.
8. Release only for evaluated regimes and archive versions, with a model/method version, input hashes, frozen coefficients, held-out results, support masks, units and limitations. Flag unseen regions/platforms, extreme scan geometry, missing QA, collection transitions, no common support, changed acquisition regimes and insufficient history as unreliable/unavailable. Keep raw parallel calendars available for audit.

## What current experiments actually show

`npm run history:analyze` generates deterministic descriptive JSON. It reports monthly/platform counts, UTC hours, day/night, source type codes, occupied cells, shared/union cell-time bins at three resolutions and three intervals, and a separate acquisition-time/distance candidate relation.

At H3 5, daily shared/union occupancy is 2,383 / 23,696 = 10.06%; monthly is 2,232 / 8,016 = 27.84%. At monthly resolution it changes to 54.65% (H3 4) or 18.76% (H3 6). This dependence on binning argues against interpreting co-occupancy as matched fires or accuracy. Separate 2 km / 30 minute screening finds 6,677 many-to-many proximity pairs (1,113 MODIS / 2,830 VIIRS records involved). The tolerances are exploratory, and no independent same-fire truth was used. Neither a sensor-exclusive bin nor an unpaired point establishes a missed fire. No calibration coefficient, detection probability or causal explanation was estimated.

Detailed counts and quality limitations: [data-quality.md](data-quality.md). Reproducibility, output schemas and measured performance: [historical-data-pipeline.md](historical-data-pipeline.md).

## Historical anomalies

Implemented pure utilities (`src/data/anomalies.ts`) compute prior-same-month medians, interpolated quantiles and relative deviation only for one explicit series key. The key must include instrument/platform, region/cell, spatial resolution, metric and processing/eligibility policy. Future validated harmonized series must additionally carry its validated method version. Mixed raw sensor keys are rejected. Duplicate months, invalid values, future reference years and incompatible months are excluded/rejected appropriately. A zero median yields no relative deviation, never an infinite anomaly.

At least three prior eligible years are required by the software guard; this is our conservative implementation choice, not a published validity threshold. Eligibility must come from an explicit comparability/coverage assessment, never just record extent. Missing months are not filled with eligible zeroes. The reported contributing years and range make gaps visible. Quantiles describe historical variability, not confidence intervals. Current 2024 data produces “insufficient history”; no anomaly values or fabricated reference years are displayed. When more years arrive the functions recognize them, but eligibility and harmonized-series validation still require scientific review.

## Reference status

NASA FIRMS source definitions and the primary algorithm/method papers linked above were checked during this iteration. The supplied [2026 challenge URL](https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/) returned HTTP 502 when checked; its wording was not independently verified. Challenge-specific objectives in this document come from the user's supplied brief. No scientific claims were copied from unrelated hackathon projects. Candidate model choices, thresholds, validation gates and the MVP recommendation are FireLens research proposals, not NASA-endorsed methods.
