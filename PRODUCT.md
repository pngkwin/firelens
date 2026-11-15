# FireLens

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

User-selected: React, TypeScript, Vite, Tailwind CSS, MapLibre GL JS, Recharts, and PapaParse. Deployment target: Vercel.

## Users

Researchers, environmental planners, and emergency managers exploring historical satellite fire detections using NASA FIRMS data.

## Product Purpose

FireLens is a satellite fire intelligence platform for the NASA Space Apps Challenge 2026, addressing the Harmonization of MODIS and VIIRS Hot Spots challenge.

Its central goal is to help users distinguish actual changes in detected fire activity from apparent changes caused by differences between MODIS and VIIRS satellite sensors.

## Positioning

Sensor-aware exploration and comparison are central to the product. FireLens aims to support interpretation of historical detections across MODIS and VIIRS, with scientifically validated harmonization, anomaly detection, and uncertainty analysis added incrementally.

## Operating Context

Users will explore historical detections through interactive geographical maps, historical activity charts, sensor comparisons, and filters. CSV importing is part of the initial scope.

## Capabilities and Constraints

- Initial version: establish the research UI, navigation, mapping, CSV importing, and reusable application architecture.
- Planned capabilities: historical activity charts, sensor comparisons, and filters.
- Later scientific capabilities: scientifically validated harmonization, anomaly detection, and uncertainty analysis.
- Advanced scientific analysis is incremental future work; do not present unvalidated methods or demonstration outputs as validated findings.
- Data source: NASA FIRMS. MODIS and VIIRS are distinct sensor sources whose differences matter to interpretation.
- Open decisions: supported CSV schemas, historical coverage, geographic scope, comparison metrics, harmonization methods, validation criteria, and uncertainty methodology.

## Brand Commitments

- Product name: FireLens.
- Build a distinctive, polished scientific research interface with excellent typography, visual hierarchy, cartographic aesthetics, intuitive navigation, and functional data visualization.
- Preserve the research-tool identity. Avoid marketing landing-page conventions, generic AI dashboards, generic SaaS styling, excessive cards, gradients, and decorative animations.

## Evidence on Hand

The user supplied the product brief, intended audience, challenge context, scope, design requirements, stack, and deployment target. No application code, datasets, sample CSV files, scientific validation results, or project-specific proof assets were present at initialization.

NASA FIRMS is the specified data source; data has not yet been imported or inspected. Challenge details are recorded from the user brief rather than independently verified.

## Product Principles

1. Make differences between sensor sources explicit when interpreting historical detections.
2. Keep exploratory views distinguishable from scientifically validated analysis.
3. Prioritize clear geographical and temporal interpretation in navigation and data visualization.
4. Establish reusable application foundations before adding advanced scientific methods.
5. Preserve scientific accuracy when communicating capabilities, findings, and uncertainty.
