# Data quality and coverage audit

Audited 2026-11-15 against the authentic supplied archives. Reproduce with `npm run history:prepare`, `npm run history:analyze`, `npm run history:verify` and `npm run history:test`.

## Inventory and reconciliation

| Instrument | Platform | Retained records | First UTC date | Last UTC date | Source version |
|---|---|---:|---|---|---|
| MODIS | Terra | 3,596 | 2024-01-01 | 2024-12-31 | 61.03 |
| MODIS | Aqua | 3,231 | 2024-01-01 | 2024-12-30 | 61.03 |
| VIIRS | S-NPP | 47,364 | 2024-01-01 | 2024-12-31 | 2 |

MODIS total: **6,827**. Total retained observation identities: **54,191**, an inventory total only, not a harmonized activity measure. Two archive files processed; zero rejected data rows, zero duplicate identities, zero conflicting duplicate payloads. The prior July 2023 NASA training sample is explicitly excluded from this study. No additional historical years were downloaded or fabricated.

Both source schemas are `latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type`. The VIIRS archive labels both its satellite and instrument `SNPP`; canonical classification is VIIRS / S-NPP. Archive brightness field names are retained as supplied, not relabeled to guessed channels. All supplied type codes are included. Invalid optional-attribute and missing supplied-attribute tallies are in the source entries of the active manifest and readable in Methods & provenance.

Original hashes (also verified by the unchanged demo verifier):

- MODIS `4b726464ac6d7ae6444a597f6e0c448f57a19e07dcde1b06135ba13e2e5a0850`.
- VIIRS `973fa7024c5969157209cf0d2c090b3e38d17fa54b2d5e781586c7e5b4c5373c`.

Each H3 resolution independently reconciles to 6,827 MODIS + 47,364 VIIRS records. Monthly and yearly platform summaries reconcile to the same identities. Never add counts from multiple spatial resolutions. The pipeline preserves full source-row associations locally even when repeated archive files later contribute duplicates. The first-file rule can suppress a revised record; conflicting payloads are surfaced for explicit version-policy review.

## Coverage is unknown

FIRMS point CSVs contain detections, not a full inventory of clear-sky observed pixels, observation opportunities or guaranteed negative observations. No observation-coverage denominator was supplied. First/last record dates describe retained detections only. Aqua ending December 30 does not prove a December 31 outage; the archive subset may simply contain no Aqua detections that day. The original NASA query footprint and completeness cannot be recovered from point extrema alone. Even overlapping date extents do not establish common exposure or geographic sampling. See the [official FIRMS download guidance](https://firms.modaps.eosdis.nasa.gov/download/) and the [VIIRS algorithm's cloud/background handling](https://directreadout.sci.gsfc.nasa.gov/publications_documents/Schroeder_et_al_2014b_RSE.pdf).

The existing `periodAvailability` audit found the intended distinction already implemented: outside-study, instrument-not-loaded, outside-record-extent, partial-record/date interval, and within-record interval. The new repository uses the same classification, with source/platform-specific date intervals so gaps between batches are not silently bridged. It never calls these coverage masks. Monthly zero values inside those intervals mean no matching loaded records; outside intervals are null. Partial date selections and record-date gaps remain marked. Year boundaries and date inclusivity use UTC, including 00:01 and 23:59 fixtures. Confidence scales are not converted or averaged across instruments.

## Measurement safeguards

NASA defines nominal MODIS 1 km and VIIRS 375 m pixel-center detections, with scan/track pixel-size information and different confidence encodings. A record can describe a thermal anomaly rather than a vegetation fire. FRP is a radiative-power measurement; brightness is a thermal-channel measurement; count is a number of records. None is automatically burned area, a unique fire event, or an estimate of the other quantity. [MODIS definitions](https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_MODIS_Firehotspots.html), [VIIRS definitions](https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_VIIRS_Firehotspots.html).

Numeric MODIS confidence and categorical VIIRS confidence remain original fields. Missing/invalid optional values are reported, not turned into shared percentages or invented measurements. No correction for cloud, scan angle, fire duration, detection limit or observation frequency is implemented. H3 bins are common locations, not a common instrument response. Cell-center inclusion is approximate; exact bounds queries require the underlying points.

## Supported descriptive findings

Full supplied record scope, all source types, shared instrument record-date extent 2024-01-01 through 2024-12-31:

- MODIS source day/night flags: 5,919 day, 908 night. VIIRS: 18,104 day, 29,260 night. These are distributions among detections, not observation-opportunity fractions. Terra/Aqua contributions are retained separately.
- At H3 5, daily bins occupied by MODIS: 4,139; VIIRS: 21,940; shared: 2,383; union: 23,696; shared/union **10.06%**. Monthly: 2,926 / 7,322 / 2,232 / 8,016, respectively; shared/union **27.84%**. The bin support changes, so shared counts need not be monotonic across resolutions.
- Monthly shared/union varies from **54.65% at H3 4**, to **27.84% at H3 5**, to **18.76% at H3 6**. This demonstrates sensitivity of this descriptive statistic to binning, not an optimum spatial scale.
- A separate spherical great-circle / UTC proximity screen finds **6,677 many-to-many pairs** within **2 km and 30 minutes**, involving **1,113 MODIS** and **2,830 VIIRS** records. These thresholds are exploratory choices, not validated matching tolerances. There is no independent event confirmation. A pair count is not the number of fires, and one-to-many relations do not estimate recall or false positives.

Detailed monthly/platform totals, UTC hour distributions, thermal type counts and occupied monthly cells at each resolution are in `analysis.json` in the active history version. These are calculated from the records; no fitted model or confidence intervals are reported. Spatial-only and temporal-only distributions do not establish causation. Larger VIIRS counts cannot, by themselves, distinguish greater fire activity from sensor response and sampling differences.

## Remaining evidence

Obtain additional years and regions, archive query/footprint metadata, source-product QA and observation/clear-sky masks, collection change documentation, and independent validation references. Check overlapping collection versions explicitly. Inspect persistent non-vegetation thermal sources separately before a vegetation-fire-specific analysis. Establish comparable exposure before using zero counts as negatives or fitting rates. One year is insufficient for historical anomalies; the UI says so. Three prior eligible same-month years is a conservative software guard for future descriptive baselines, not proof of sufficient scientific sample size or comparability.
