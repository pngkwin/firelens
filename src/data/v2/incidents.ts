// Independently documented fire incidents that give context to FireLens case
// studies. Every value is copied from the cited agency or institutional page
// (checked 2026-11-15); nothing is derived from the satellite data. Point
// locations are included only where the source publishes coordinates (CAL FIRE
// incident pages); other incidents are described by place name only.
//
// These records are a small, curated context layer, not a complete fire
// inventory. Agency acreage is burned area inside a final or reported
// perimeter; FireLens fire-cell-days are satellite detections. The two measure
// different things and are never converted into each other.
import type { RegionId } from "./urlState";
import type { LonLat } from "./aoi";

export type Incident = {
  id: string;
  region: RegionId;
  name: string;
  /** Area as given by the source (counties, municipalities). */
  place: string;
  start: string; // YYYY-MM-DD from the source
  end: string | null; // containment/extinguished date if the source gives one
  /** Size exactly as published, with its unit and basis. */
  size: string | null;
  /** Published point location (CAL FIRE "Latitude/Longitude"); null = not published. */
  location: LonLat | null;
  /** FireLens month(s) to examine, and the preset or region that contains the incident. */
  months: string[];
  preset: string | null;
  source: { publisher: string; url: string }[];
  note: string;
  /** Case study this incident gives context to. */
  caseId: string;
};

export const INCIDENTS: Incident[] = [
  {
    id: "ca-august-complex-2020", region: "us", caseId: "us-california-2020", name: "August Complex (includes Doe Fire)",
    place: "Mendocino, Humboldt, Trinity, Tehama, Glenn, Lake and Colusa counties, California (Mendocino National Forest)",
    start: "2020-08-16", end: "2020-11-11", size: "1,032,648 acres (CAL FIRE)", location: [-122.673, 39.776],
    months: ["2020-08", "2020-09", "2020-10"], preset: "us-06",
    source: [{ publisher: "CAL FIRE incident page", url: "https://www.fire.ca.gov/incidents/2020/8/16/august-complex-includes-doe-fire" }],
    note: "Lightning-ignited complex; CAL FIRE lists start 16 Aug 2020 and containment 11 Nov 2020.",
  },
  {
    id: "ca-creek-2020", region: "us", caseId: "us-california-2020", name: "Creek Fire",
    place: "Fresno and Madera counties, California (Sierra National Forest)",
    start: "2020-09-04", end: null, size: "379,895 acres (CAL FIRE)", location: [-119.261175, 37.19147],
    months: ["2020-09", "2020-10"], preset: "us-06",
    source: [{ publisher: "CAL FIRE incident page", url: "https://www.fire.ca.gov/incidents/2020/9/4/creek-fire" }],
    note: "CAL FIRE lists the fire as 100% contained without a containment date.",
  },
  {
    id: "tx-possum-kingdom-2011", region: "us", caseId: "us-texas-2011", name: "Possum Kingdom fire complex",
    place: "Possum Kingdom Lake area, north-central Texas",
    start: "2011-04-09", end: null, size: "about 126,734 acres (Office of the Texas State Climatologist)", location: null,
    months: ["2011-04"], preset: "us-48",
    source: [
      { publisher: "Office of the Texas State Climatologist, Texas A&M University: 2011 Texas severe weather", url: "https://climatexas.tamu.edu/products/severe-weather-summaries/2011-texas-severe-weather.html" },
    ],
    note: "One of several large April 2011 fires listed by the State Climatologist, alongside fires near Swenson (122,500 acres, 6 Apr) and near Marfa (314,444 acres, from 9 Apr).",
  },
  {
    id: "tx-bastrop-2011", region: "us", caseId: "us-texas-2011", name: "Bastrop County Complex",
    place: "Bastrop County, central Texas",
    start: "2011-09-04", end: "2011-10-29", size: "32,000 acres (Texas Parks and Wildlife Department)", location: null,
    months: ["2011-09"], preset: "us-48",
    source: [
      { publisher: "Texas Parks and Wildlife Department: Sept. 4, 2011 Bastrop wildfire", url: "https://tpwd.texas.gov/spdest/findadest/parks/bastrop/fire/" },
      { publisher: "Office of the Texas State Climatologist (extinguished 29 Oct 2011)", url: "https://climatexas.tamu.edu/products/severe-weather-summaries/2011-texas-severe-weather.html" },
    ],
    note: "TPWD describes it as the most destructive wildfire in state history (over 1,600 homes destroyed). Destructiveness, burned area and satellite-detected burning are different measures: a fire can destroy many homes while adding few fire-cell-days to a statewide total.",
  },
  {
    id: "tx-smokehouse-creek-2024", region: "us", caseId: "us-texas-2011", name: "Smokehouse Creek Fire",
    place: "Hutchinson County and the Texas Panhandle (extending into Oklahoma)",
    start: "2024-02-26", end: null, size: "1,075,000 acres across Texas and Oklahoma as of 28 Feb 2024 (Texas A&M Forest Service, early estimate)", location: null,
    months: ["2024-02", "2024-03"], preset: "us-48",
    source: [
      { publisher: "Texas A&M Forest Service news release, 28 Feb 2024", url: "https://tfsweb.tamu.edu/as-the-largest-wildfire-in-texas-history-burns-texas-am-forest-service-encourages-caution-as-wildfire-potential-increases-over-the-weekend/" },
      { publisher: "USDA NASS disaster analysis, Texas wildfires (assessment period from 26 Feb 2024)", url: "https://www.nass.usda.gov/Research_and_Science/Disaster-Analysis/2024/Texas-Wildfires/2024_Texas_Wildfires_Report.pdf" },
    ],
    note: "Texas A&M Forest Service called it the largest wildfire in Texas history. Later acreage figures differ between sources; FireLens quotes the agency's 28 Feb estimate only.",
  },
  {
    id: "pt-beiras-2025", region: "iberia", caseId: "iberia-august-2025", name: "Wildfires in Beiras e Serra da Estrela (Copernicus EMSR831)",
    place: "Beiras e Serra da Estrela, central Portugal",
    start: "2025-08-09", end: null, size: null, location: null,
    months: ["2025-08"], preset: null,
    source: [
      { publisher: "Copernicus Emergency Management Service, activation EMSR831 (activated 11 Aug 2025)", url: "https://mapping.emergency.copernicus.eu/activations/EMSR831" },
      { publisher: "Copernicus EMS news, 11 Aug 2025", url: "https://mapping.emergency.copernicus.eu/news/wildfire-in-beiras-e-serra-da-estrela-portugal/" },
      { publisher: "ESA: Iberian wildfires seen from space (20 Aug 2025)", url: "https://www.esa.int/Applications/Observing_the_Earth/Iberian_wildfires_seen_from_space" },
    ],
    note: "Copernicus EMS mapped fire extent in central Portugal from 9 Aug 2025; ESA imagery of 16–17 Aug shows active fires across northern Portugal and northwest Spain. Press reports put the Arganil/Piódão fire at about 64,000 ha, the largest recorded in Portugal; that figure is not from an agency source here.",
  },
  {
    id: "es-west-2025", region: "iberia", caseId: "iberia-august-2025", name: "Wildfires in western Spain (Copernicus EMSR837), incl. Ourense province",
    place: "Western Spain, including Ourense province (Galicia)",
    start: "2025-08-15", end: null, size: null, location: null,
    months: ["2025-08"], preset: null,
    source: [
      { publisher: "Copernicus Emergency Management Service, activation EMSR837 (West Spain, 15 Aug 2025)", url: "https://mapping.emergency.copernicus.eu/activations/EMSR837" },
      { publisher: "Copernicus EMS news: wildfire in Ourense province (15 Aug 2025)", url: "https://mapping.emergency.copernicus.eu/news/wildfire-in-ourense-province-spain/" },
    ],
    note: "Start is the activation date; several fires had been burning in Ourense since the second week of August.",
  },
];

export const incidentsFor = (region: RegionId) => INCIDENTS.filter((i) => i.region === region);
