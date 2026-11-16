# FireLens: one consistent fire record across MODIS and VIIRS

**Challenge:** NASA Space Apps Challenge 2026, *Harmonization of MODIS and VIIRS Hot Spots*
**Public app:** https://firelens-iota.vercel.app
**Supported regions:** United States (contiguous, Alaska, Hawaii) and Iberian Peninsula, complete from November 2000 to 14 November 2026 (313 monthly periods). FireLens is not a global database.

## The problem

NASA FIRMS active-fire hot spots come from two generations of instruments: MODIS (Terra 2000, Aqua 2002; 1 km pixels) and VIIRS (S-NPP 2012, NOAA-20 2018, NOAA-21 2023; 375 m pixels). VIIRS detects small and cool fires that MODIS misses, so it records about twice as many fire-cell-days for the same fires. Meanwhile the MODIS satellites are drifting toward the end of their missions, and individual satellites have outages. Anyone who joins the two records naively sees fire activity that rises when VIIRS arrives, without any change in the fires themselves.

## What FireLens does

1. **Shared format and unit.** Every FIRMS record (science-quality archive, then near-real-time) is put in one schema, clipped to the region boundary, filtered of persistent industrial and volcanic sources, and counted as **fire-cell-days**. A fire-cell-day is one ~0.74 km² H3 cell on one UTC day with at least one detection. Sensors are combined as a union of platform bitmasks, never summed.
2. **Outage-aware observation audit.** A satellite-day is flagged as an outage only when other satellites (or, for Terra alone, the same days in other years) show it should have detected fire. Thirteen documented NASA/NOAA outages are all recovered, and the result is insensitive to the detection thresholds. Flagged months are marked "reduced coverage" and kept out of baselines, anomalies and trends.
3. **Harmonization to a MODIS-equivalent scale.** Observed MODIS is used where it is reliable (2002-07 to 2021-12). Before that, the Terra-only years are scaled to Terra ∪ Aqua. From 2022, values are estimated from VIIRS, using either a zone × month × day/night ratio (US) or quantile mapping (Iberia). The method for each region was chosen on held-out years.
4. **Validation that is honest about its target.** Every parameter is refitted in each leave-one-year-out fold (2012–2021). The method choice is re-scored with a nested procedure. Prediction intervals are measured out of sample. The validation compares against observed MODIS, not against ground-truth fires.

## Findings (all recomputed from the data by automated tests)

| Area | Naive MODIS→VIIRS splice | Harmonized record |
|---|---|---|
| United States, 2003–2025 | +72% per decade (p < 0.001) | about 0% per decade (p = 0.98) |
| California | +66% per decade (p = 0.0001) | +17% per decade (p = 0.27, not significant) |
| Texas | +94% per decade (p < 0.0001) | +2% per decade (p = 0.77) |
| Iberian Peninsula | +36% per decade (p = 0.015) | −35% per decade (p = 0.037) |

- **The sensor switch manufactures trends.** Naive splicing produces significant increases everywhere. After harmonization they disappear in the US, California and Texas, and in Iberia the sign reverses.
- **Most detections since 2012 are VIIRS-only.** Of fire-cell-days seen by either sensor in fully observed months since 2012, 71% (US), 82% (Texas) and 67% (Iberia) were VIIRS-only; at night the US share is 83%.
- **Record months:**
  - California, September 2020 (the August Complex and Creek fires): 20,461 fire-cell-days, observed MODIS.
  - Texas, April 2011: 4,432, which is 2.6 times the next-largest month.
  - Iberia, August 2025: 8,281, estimated with a 90% interval of 6,118–10,736. That interval overlaps August 2005 (6,342), so the record is likely but not certain.
- **Fire seasons have not measurably shifted.** No change in seasonal timing, concentration or spread between 2003–2012 and 2013–2021 survives a permutation test with multiple-testing correction, in Texas, California, the US or Iberia. Texas detections peak in March, the others in August.
- **Burned area and detected burning are different measures.** The Smokehouse Creek Fire (2024), the largest Texas wildfire by area, does not make February 2024 one of Texas's ten largest months in fire-cell-days.

## Validation (held-out years 2012–2021, 113 months per region)

- **US:** the stratified ratio has a monthly MAE of 482 fire-cell-days (r = 0.992, annual ratio 0.999). For comparison: single ratio 882, quantile mapping 884, raw VIIRS 9,694. The 90% interval covers 88.5% of held-out months.
- **Iberia:** quantile mapping has an MAE of 54.5 (r = 0.989). For comparison: stratified ratio 64.6, single ratio 83.8, raw VIIRS 364. Interval coverage is 89.4%.
- **Areas smaller than the region:** intervals were too narrow, so the noise term is widened by a factor chosen out of sample. US held-out coverage on ~600,000 km² zones rose from 79.9% to 90.2%. States and drawn areas are smaller than these zones and are not validated separately.

## How people use it

- **Researchers:** choose a state, country or drawn area and see 26 years of monthly activity as a calendar, with anomalies, rankings, trends, fire episodes and seasonal profiles. They can then follow the investigation steps: fire season → sensor disagreement → why harmonization matters → evidence lab → documented fires → regional brief.
- **Land managers:** get a downloadable brief (Markdown or HTML/PDF) with the historical seasonal pattern presented as planning context, unusual months, documented incidents, uncertainty and provenance hashes.
- **Exports:** monthly CSV, calendar PNG, provenance JSON, held-out validation CSV/JSON, season profiles CSV, and briefs.

## Originality

To our knowledge (we did not run a systematic survey), it is uncommon for an application to combine harmonization of MODIS and VIIRS at the scale of individual detections with an outage audit that does not treat zero detections as proof of an outage, with validation that is fully refitted per fold and nested, and with an interface that shows the naive-versus-harmonized difference for any area a user selects. Every number displayed is traceable to a hash-verified data bundle.

## Limits we state in the app

- Fire-cell-days are satellite detections, not burned area, a count of individual fires, or a fire-risk forecast.
- Validation is against MODIS, not ground truth. Observation opportunity (clouds, smoke) is not modelled.
- 56 detected outage runs have no matching published notice.
- In the US, observed near-real-time MODIS for September–November 2026 is 22–39% below the VIIRS-based estimate; the cause is not established.
- Small-area uncertainty is validated only at zone scale.
