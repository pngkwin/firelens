# FireLens research workspace

Status: confirmed by the user on November 14, 2026. The user selected the observation-focused structure refined with Research Atlas cartography and explicitly confirmed this brief. This document plans the experience; it is not an implementation or a direction contract.

## Job and audience

Mode: Operate. Researchers, environmental planners, and emergency managers investigate historical NASA FIRMS detections for their own region and period. The workspace supports exploration and comparison, with a unified, scientifically harmonized historical burning activity calendar as the eventual goal.

## Outcome and evidence

A successful session lets a user load authentic MODIS and VIIRS records, select or draw a region, set dates, examine linked geographical and temporal patterns, inspect a hotspot, and compare sensor observations without conflating them.

Use authentic NASA FIRMS MODIS Collection 6.1 and VIIRS 375 m active-fire records from the beginning. A smaller real regional subset is acceptable for development, with its source and limited extent disclosed. No fabricated observations, fixed Texas scope, or fixed 2024 scope. Target historical expansion from the early 2000s for MODIS and approximately 2012 onward for VIIRS, as requested; actual selectable availability must follow verified dataset coverage.

## Selected direction

Retain the observation-focused layout and chronology emphasis, refined with Research Atlas's cartographic precision. Use subtle green structural tones, clean light analytical surfaces, and warm orange highlights for fire activity. Avoid an overall beige ground. Typography is elegant and readable at research density; tabular numerals serve dates and measurements. Exact fonts and tokens remain implementation decisions within this direction.

The first viewport is a working research surface: compact navigation, a shared study scope, an interactive map, and an equally prominent historical burning calendar. Use continuous work areas and precise dividers instead of dashboard cards, decorative elements, or oversized summary metrics.

The signature interaction is linked geographical and temporal selection: selecting a calendar month focuses the corresponding map records and sensor comparison; selecting a hotspot reveals its date and source in context. A hover previews a period without silently changing the study; a deliberate selection applies it and offers a clear reset.

## Scope and boundaries

Named target: the main FireLens research workspace, with supporting dataset import and provenance flows. This is a standalone planning brief for a functional initial application, not a marketing surface.

Initial build scope:

- Navigation and a reusable application shell.
- Authentic FIRMS data loading and CSV import with validation feedback.
- Interactive map, region selection and drawing, date and sensor filters, and individual hotspot inspection.
- Monthly-by-year burning activity calendar, a linked timeline, and descriptive sensor comparisons using the same filtered records.
- Dataset provenance, available temporal extent, and explicit analysis limitations.

Future expansion: validated harmonization, historical anomalies, uncertainty analysis, and downloadable results. Leave architectural extension points and an intelligible place for these capabilities; do not fill the interface with inert cards, fake insights, or buttons that imply working analysis.

Do not merge raw observations into a scientifically unified series, imply that detection counts measure burned area or unique fires, or present sensor differences as changes in actual fire incidence. Preserve sensor and satellite/platform identity where available in the source.

## Interaction and layout

- **Navigation:** Workspace, Datasets, and Methods & provenance. Import remains an obvious action; avoid separate disconnected map and calendar pages.
- **Shared study scope:** concise region, date-range, and sensor controls above the work areas. Advanced filters appear on demand. Show the active scope and provide a clear reset. Panning the map does not silently redefine the selected region.
- **Map and calendar:** balanced adjacent work areas on wide desktops with a user-adjustable divider. Neither becomes a thumbnail or a secondary collapsed panel. The map carries region drawing, selection, layers, legend, and a concise hotspot inspector. The calendar uses years as rows and months as columns, with accessible labels, units, and explicit sensor context.
- **Calendar interpretation:** start with clearly labeled detection counts. Offer aligned per-sensor views with matching temporal bins and an explicit scale. Keep sensor identity distinct from activity intensity. Do not default to a summed cross-sensor heatmap or silently normalize values.
- **Timeline and comparison:** a compact lower analytical band supports date brushing, descriptive trends, and aligned sensor comparisons. Maintain consistent units, aggregation, and filtering. Clearly distinguish the total selected period from a focused month.
- **Provenance:** a persistent source summary leads to dataset collection/version, satellite/platform, imported file or retrieval source, available record dates, import/retrieval time where known, applied filters, and validation results. Label observed record extent separately from verified observation coverage.
- **Responsive behavior:** stack map and calendar at narrower widths with both clearly reachable; condense filters into an accessible study-scope panel. Keep the calendar's year and month context visible when its data area scrolls. Large historical ranges scroll or virtualize within the analytical view instead of shrinking cells into illegibility.

## States and data ranges

Plan for a regional development subset and expansion to multiple regions and decades. File sizes, row counts, and performance budgets remain undecided; no unlimited client-side import claim is authorized.

Required states: no data loaded, download/import in progress, parse or schema failure, invalid or partially accepted rows, unavailable source, empty filtered results, only one sensor present, non-overlapping sensor periods, missing fields, selected hotspot, active region drawing, and long calendar ranges.

Before data is available, show the map and calendar structure with an actionable import/load explanation and no fabricated values. On data failure, retain the selected study scope and offer recovery.

Distinguish unavailable/unloaded data from zero matching detections. Do not infer confirmed satellite observation coverage or absence of fire from an empty set of active-fire records. Expose the limits of available coverage metadata.

## Constraints and open decisions

Stack: React, TypeScript, Vite, Tailwind CSS, MapLibre GL JS, Recharts, and PapaParse. Deployment: Vercel. Code-first workflow.

Keep data ingestion, validation, spatial filtering, temporal aggregation, and visualization separate. Map, calendar, timeline, and comparisons consume the same study state. Separate sensor streams remain available to future validated harmonization methods. Expanding datasets should permit server-side or precomputed queries rather than requiring every historical record in the browser.

Accessibility intent: keyboard-operable controls, visible focus, sensor distinctions beyond color, readable legends, text alternatives or tabular access for calendar and map selections, and no decorative motion. Region entry needs an alternative to pointer-only drawing. Basemap attribution remains visible.

Resolve during implementation without inventing scientific methods: official acquisition route and any credential handling; actual development subset and verification; supported CSV variants and field mapping; basemap provider and terms; spatial selection geometry; calendar count semantics and scale; UTC/date handling; data-volume budgets; persistence; and export scope. Source-specific confidence values require an explicit interpretation before offering a cross-sensor confidence filter. No authentication, live emergency alerting, or validated scientific model is established by this brief.
