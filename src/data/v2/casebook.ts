// Three curated, reproducible research cases. Every number in the text is
// checked against the published bundle by src/data/v2/casebook.test.ts, so the
// narrative cannot drift from the data. Cases were chosen from the data (the
// largest harmonized months and the naive-vs-harmonized trend comparison).
import type { RegionId } from "./urlState";
import type { Aoi } from "./aoi";

export type Case = {
  id: string;
  region: RegionId;
  aoi: Aoi;
  area: string;
  from: string;
  to: string;
  focus: string;
  question: string;
  finding: string;
  sensors: string;
  limits: string;
  meaning: string;
  /** Investigation step the case opens on (default: why harmonization matters). */
  startTab?: "season" | "transition";
  /** Values the test recomputes from the bundle (rounded as shown in the text). */
  check: { focusValue: number; notTop?: { month: string; n: number }; seasonPeak?: number; focusLo: number | null; focusHi: number | null; focusRank: number; runnerUp: { month: string; value: number }; naivePerDecade: number; naiveP: string; harmonizedPerDecade: number; harmonizedP: string; viirsOnlyPct: number; bothPct: number; modisOnlyPct: number };
};

export const CASES: Case[] = [
  {
    id: "us-california-2020",
    region: "us",
    aoi: { kind: "preset", id: "us-06" },
    area: "California",
    from: "2003-01",
    to: "2025-12",
    focus: "2020-09",
    question: "How exceptional was September 2020 in California, and has California's satellite fire record really grown since 2003?",
    finding: "September 2020 (the August Complex and Creek fires) is California's largest month of the satellite era on the harmonized scale: 20,461 MODIS-equivalent fire-cell-days, ahead of August 2021 (17,315). It is observed MODIS, so it carries no model interval. Over complete years 2003–2025 the harmonized record rises +17% per decade, but the trend is not significant (p = 0.27).",
    sensors: "A naive record that switches from MODIS to VIIRS in 2012 shows +66% per decade, significant (p = 0.0001): an artefact of VIIRS's higher sensitivity. Of the fire-cell-days either sensor detected in fully observed months since 2012, 63% were VIIRS-only, 25% both and 11% MODIS-only.",
    limits: "California is smaller than a calibration zone, so estimated months (2022 onwards) use intervals validated only at zone scale. Years with satellite outages are left out of the trend. Fire-cell-days are not burned area.",
    meaning: "The 2020 season stands out on any reading, but a long-term increase in detected burning is not established once the sensor change is accounted for.",
    check: { focusValue: 20461, focusLo: null, focusHi: null, focusRank: 1, runnerUp: { month: "2021-08", value: 17315 }, naivePerDecade: 66, naiveP: "0.0001", harmonizedPerDecade: 17, harmonizedP: "0.27", viirsOnlyPct: 63, bothPct: 25, modisOnlyPct: 11 },
  },
  {
    id: "iberia-august-2025",
    region: "iberia",
    aoi: { kind: "region" },
    area: "Iberian Peninsula",
    from: "2003-01",
    to: "2025-12",
    focus: "2025-08",
    question: "Was August 2025 the most extreme month in Iberia's 26-year satellite record, and is Iberian burning increasing?",
    finding: "August 2025 (large fires across northwest Spain and northern and central Portugal, mapped by Copernicus EMS activations EMSR837 and EMSR831) is the highest month on the harmonized scale: 8,281 MODIS-equivalent fire-cell-days, ahead of August 2005 (6,342). It is estimated from VIIRS, and its 90% interval (6,118–10,736) reaches below the 2005 value, so the record is likely but not certain. Over complete years 2003–2025 the harmonized record falls −35% per decade (p = 0.037).",
    sensors: "The naive MODIS→VIIRS splice reverses the sign: +36% per decade (p = 0.015). Since 2012, 67% of fire-cell-days seen by either sensor were VIIRS-only, 12% both and 21% MODIS-only.",
    limits: "Iberia uses quantile mapping (chosen per region on held-out years) with intervals about 2.4× wider than the US. The record comparison crosses the 2022 switch from observed MODIS to VIIRS-based estimates. The decline is driven by the very large mid-2000s seasons.",
    meaning: "Exceptional single seasons such as 2025 occur within a long-term record that, once harmonized, declines rather than rises; a naive sensor splice would have reported the opposite.",
    check: { focusValue: 8281, focusLo: 6118, focusHi: 10736, focusRank: 1, runnerUp: { month: "2005-08", value: 6342 }, naivePerDecade: 36, naiveP: "0.015", harmonizedPerDecade: -35, harmonizedP: "0.037", viirsOnlyPct: 67, bothPct: 12, modisOnlyPct: 21 },
  },
  {
    id: "us-texas-2011",
    region: "us",
    aoi: { kind: "preset", id: "us-48" },
    area: "Texas",
    from: "2003-01",
    to: "2025-12",
    focus: "2011-04",
    startTab: "season",
    question: "When is Texas burning concentrated, how exceptional was April 2011, and does the change of satellite sensor alter the long-term picture?",
    finding: "April 2011, in the record 2011 Texas fire season (the Possum Kingdom fire complex and a 314,444-acre fire near Marfa, per the Office of the Texas State Climatologist), is the largest month of the satellite era on the harmonized scale: 4,432 MODIS-equivalent fire-cell-days, 2.6 times the runner-up, March 2008 (1,674). It is observed MODIS. Detected burning is concentrated in late winter and spring: March is the peak month in both 2003–2012 and 2013–2021, and no change in seasonal timing or concentration between the two periods survives a permutation test.",
    sensors: "A naive MODIS→VIIRS splice reports +94% per decade (p < 0.0001); the harmonized record shows +2% per decade (p = 0.77), no detectable trend. Texas has the largest VIIRS-only share of the three cases: of fire-cell-days seen by either sensor in fully observed months since 2012, 82% were VIIRS-only, 7% both and 12% MODIS-only, so a sensor switch inflates Texas most.",
    limits: "Texas is smaller than a calibration zone, so state-scale intervals are not validated. The Smokehouse Creek Fire (from 26 Feb 2024), the largest wildfire in Texas history by area according to the Texas A&M Forest Service, does not make February 2024 one of the ten largest Texas months in fire-cell-days: a wind-driven grass fire can burn a vast area in a few days, while fire-cell-days count daily detections. Fire-cell-days are not burned area. Years with satellite outages are left out of seasonal statistics and trends.",
    meaning: "For Texas the main monitoring window is late winter to spring, that pattern has been stable across the observed MODIS record, and the apparent near-doubling of burning per decade is an artefact of the sensor change.",
    check: { focusValue: 4432, focusLo: null, focusHi: null, focusRank: 1, runnerUp: { month: "2008-03", value: 1674 }, naivePerDecade: 94, naiveP: "0.00000001", harmonizedPerDecade: 2, harmonizedP: "0.77", viirsOnlyPct: 82, bothPct: 7, modisOnlyPct: 12, notTop: { month: "2024-02", n: 10 }, seasonPeak: 3 },
  },
];
