---
name: FireLens
description: A refined cartographic system for satellite fire observations.
colors:
  forest: "#173e36"
  forest-hover: "#23594c"
  ink: "#203c34"
  muted: "#586c64"
  background: "#f4f7f5"
  line: "#d9e2dc"
  soft: "#edf3ef"
  surface: "#fff"
  selection: "#dbe9df"
  fire: "#b54c20"
  viirs: "#2d7191"
  warning: "#8b3a20"
  error-bg: "#fff1eb"
  heat1: "#fce9d6"
  heat2: "#f7c99e"
  heat3: "#e6a069"
  heat4: "#cc703a"
  heat5: "#a7461e"
  control-border: "#b7c8bd"
  nav-text: "#c5d9ce"
  nav-active: "#eda673"
typography:
  headline:
    fontFamily: "Source Sans 3, sans-serif"
    fontSize: "1.9rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Source Sans 3, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  subtitle:
    fontFamily: "Source Sans 3, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "Source Sans 3, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Source Sans 3, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 600
  button:
    fontFamily: "Source Sans 3, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 500
    lineHeight: 1.25
  measurement:
    fontFamily: "Source Sans 3, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  square: "0px"
  control: "5px"
  heat-cell: "3px"
  map-control: "4px"
spacing:
  space-4: "4px"
  space-6: "6px"
  space-8: "8px"
  space-10: "10px"
  space-12: "12px"
  space-14: "14px"
  space-16: "16px"
  space-18: "18px"
  space-20: "20px"
  space-22: "22px"
  space-24: "24px"
  space-30: "30px"
  space-36: "36px"
components:
  button-primary:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
    typography: "{typography.button}"
  button-primary-hover:
    backgroundColor: "{colors.forest-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.forest}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
    typography: "{typography.button}"
  button-secondary-hover:
    backgroundColor: "{colors.soft}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
    typography: "{typography.button}"
  button-header-import:
    backgroundColor: "#e4eee7"
    textColor: "{colors.forest}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.forest}"
    padding: "6px 0"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  selection-chip:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.forest}"
    padding: "3px 8px"
  nav:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.nav-text}"
  analytical-surface:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.square}"
  heat-cell:
    rounded: "{rounded.heat-cell}"
    padding: "5px 0"
---

# Design System: FireLens

## Overview

**Creative North Star: "Research Atlas"**

Research Atlas is the visual north star: a modern scientific research platform with a refined cartographic aesthetic. Cool analytical surfaces and subtle forest greens give observations a calm setting; warm orange marks fire activity, and blue distinguishes VIIRS.

The interface is observation-focused, precise, and restrained. Elegant humanist typography, meaningful visualizations, and deliberate spacing support inquiry. The confirmed anti-references are beige palettes, decorative elements, generic card collections, and dense controls.

**Key Characteristics:**

- Observation-focused structure
- Refined cartographic aesthetic
- Cool green analytical surfaces and warm orange fire activity
- Precise spacing, tabular measurements, and restrained controls

## Colors

A cool green foundation supports warm activity encodings and a clear blue instrument identity. Frontmatter contains the normative values extracted from `src/styles.css`.

### Primary

- **Forest:** the header, primary action, selected sensor, links, and selected observation outlines. Forest hover provides the primary action's response.

### Secondary

- **Fire orange:** MODIS marks and lines. The five heat colors encode increasing monthly detection counts; they are an ordered data scale, not surface decoration.
- **VIIRS blue:** VIIRS marks and lines; also the global keyboard focus outline.
- **Warning earth:** error text, cautions, and destructive action text, supported by the pale error background.

### Neutral

- **Observation ink / muted green-gray:** primary reading and secondary metadata respectively.
- **Cool field / white surface / soft wash:** page background, analytical regions, and subdued editing or unknown-data states.
- **Fine separator / control border:** region boundaries and interactive field edges. Selection wash identifies active scope and selected rows.
- **Navigation text / warm navigation marker:** subdued header destinations and the active underline.

**The Semantic Color Rule.** Keep forest for the application shell and selection, orange for fire observations, and blue for VIIRS identity. Use text and shape alongside color.

## Typography

**Body Font:** Source Sans 3 with sans-serif fallback. Locally bundled Latin weights are 400, 500, 600, and 700.

**Display Font:** Source Serif 4 (variable, optical size axis, self-hosted via `@fontsource-variable/source-serif-4`). It is used only for the workspace heading (h1) and the brand wordmark, like the title on an atlas plate. Everything else stays in Source Sans 3. See "Hybrid layer" below.

**Label/Mono Font:** the same humanist sans for labels; `ui-monospace, monospace` for provenance hashes only.

**Character:** clear scientific reading, modest heading contrast, and compact contextual labels. The scale is role-specific rather than a fixed modular ratio.

### Hierarchy

- **Headline:** the workspace heading; slightly tightened tracking. It reduces to 1.7rem below 960px and 1.65rem below 620px.
- **Title / subtitle:** section and subsection headings. Compact analytical section titles use 1.1rem; methods titles use 1.6rem on desktop and 1.3rem on mobile.
- **Body:** standard reading with 1.5 line-height; methods paragraphs use 0.95rem with 1.65 line-height and a maximum of 73ch.
- **Label:** compact semibold field labels; supporting metadata typically spans 0.7–0.85rem. Preserve legibility rather than forcing all text into one size.
- **Measurement:** emphasized comparison counts; use tabular numerals for counts, dates, tables, and scope summaries. Hashes wrap instead of widening the page.

## Layout

The system uses continuous analytical regions, aligned headings, and fine separators. Repeated spacing steps are recorded above; the implementation has no CSS spacing-variable scale. Small metadata and labels use tight gaps; region interiors usually use 20–22px padding, while page gutters are broader.

The desktop main container is centered with a maximum width of 1760px and padding of 30px 36px 0. At 1200px and below it uses 24px gutters; at 620px and below it uses 22px 16px 0. The forest header is at least 68px high on desktop. On phones its navigation occupies a second row.

For the current research surface, map and calendar are peer instruments: their initial split is 50/50, adjustable between 40/60 and 60/40. The analytical timeline and comparison region follows below. At 960px and below, regions stack and the split control disappears. At 620px and below filters wrap into readable rows, provenance and footer stack, and methods becomes one column. Preserve the surface contract in `.impeccable/surfaces/src-app-tsx.md`; this composition is not a requirement for every future screen.

Calendar and data tables retain local horizontal scrolling; the calendar has a sticky month header and year column. Do not shrink measured values to eliminate scrolling. Wide displays at 1500px increase visualization height and calendar cell size.

## Elevation & Depth

Application-authored regions have no box shadows. White analytical surfaces sit on a cool field; soft washes identify in-place editing, inspection, feedback, and unknown extent. One-pixel separators establish structure. MapLibre's native map controls retain their library styling, with a four-pixel corner override.

**The Flat Surface Rule.** Separate analytical regions with tonal contrast and fine rules; do not add decorative shadows or floating card treatments.

## Shapes

Analytical region boundaries remain square. Controls have subtle five-pixel corners, calendar cells three-pixel corners, and native map controls four-pixel corners. Selected scope is a compact rectangular chip rather than a pill. Sensor marks add a redundant identity cue: MODIS is circular and VIIRS is square. Icons are small functional SVG strokes, not decorative illustrations.

## Components

### Buttons

Restrained, compact actions. Standard buttons have 9px 14px padding, a 38px minimum height, medium weight, and a fine control border. Primary actions use forest with white text; hover uses forest hover. Secondary actions use white with forest text and a soft hover wash. Quiet actions remove the visible fill and border; text actions use forest semibold text and an underline on hover. The header import action uses a pale green fill. Small buttons use 7px 10px padding and a 34px minimum height. Icon buttons retain accessible names.

Buttons transition background and color over 150ms with ease-out. Reduced-motion preferences remove these transitions. Disabled buttons show half opacity and a not-allowed cursor. Interactive controls use a three-pixel VIIRS focus outline with a three-pixel offset.

### Inputs / Fields

White, fine-bordered fields with 8px 10px padding, five-pixel corners, and a 38px minimum height. Labels sit above in compact muted semibold type. The range control uses forest as its accent. Validation text uses warning earth and remains near the relevant editor. There is no invented decorative error icon or floating-label behavior.

### Navigation

The forest header holds a compact brand and text navigation. Inactive destinations use subdued pale green; hover turns white; the current destination has white text and a warm three-pixel underline. On mobile the navigation wraps below brand and import, retaining all destinations.

### Chips / Sensor Selector

Selected scope uses a green wash, forest text, a fine green border, and 3px 8px padding, with an explicit clear action. The sensor selector is a five-pixel bordered segmented group; active segments are forest with white text, plus the instrument's own mark. Disabled alternatives remain visibly disabled.

### Analytical Containers

The project has no generic card component. White contiguous regions use fine borders or separators and square corners. Headings, tools, plots, legends, and cautions form a single instrument. Import is an in-flow region with a dashed, lightly washed drop zone; loading and feedback use compact horizontal strips.

### Observation Visualizations

Monthly heat cells display numeric counts, with an ordered five-step warm scale. A selected cell has a forest outline. Zero is pale with a border and a numeric zero; outside the loaded record extent is a muted dash and a disabled cell. The timeline leaves unavailable sensor periods as gaps and labels unavailable values explicitly. Tooltips, sensor legends, and available data tables reinforce meaning without relying on color alone.

Map markers and timeline lines retain the same instrument identities. Selection exposes an in-flow inspector with a two-column definition list. No authored raster illustration is required: the shipped visual language is CSS, SVG marks, measured data, and remote map tiles.

## Hybrid layer (2026-11-15 polish pass)

The analytical surfaces keep everything above. The page frame gets a little more character. The rules live at the end of `src/styles.css`.

- **Heading as an atlas plate title:** serif h1 in forest, `clamp(1.7rem, 1.15rem + 1.5vw, 2.45rem)`, balanced wrapping, subtitle capped at 64ch. No eyebrow labels, no accent bars.
- **One authored motion moment:** the h1 and subtitle rise 8px and fade in once on load (480ms, 80ms apart, `cubic-bezier(0.2, 0, 0, 1)`). Nothing else animates on entry. `prefers-reduced-motion: reduce` turns it off.
- **Press feedback:** enabled buttons move down 1px on `:active`; secondary buttons take the selection wash; heat cells darken slightly instead of moving.
- **Radius scale:** controls 5px, analytical panels 6px (`--r-control`, `--r-panel`), heat cells 3px. Workspace regions in the CSV view stay square.
- **No coloured side stripes:** emphasis comes from a tonal fill and a full 1px border.
- **Loading:** the calendar column shows skeleton panels shaped like the focus card and month grid while data loads, so the layout does not jump. Suspense fallbacks reserve their final height.
- **Missing values** read "n/a" everywhere (tables, cards, exports). Numbers that round to zero never show as "-0".
- **Phone header:** destinations stay on one line and scroll sideways.

## Do's and Don'ts

### Do:

- **Do** use the established forest shell, cool backgrounds, and white analytical surfaces.
- **Do** preserve explicit labels, tabular measurements, legends, and visible keyboard focus.
- **Do** distinguish zero observations from unavailable record extent in every visualization.
- **Do** keep geographic and historical instruments visually balanced when they appear together.
- **Do** use responsive stacking and local table scrolling to retain readable measurements.

### Don't:

- **Don't** introduce beige backgrounds, ornamental imagery, or decorative effects.
- **Don't** break the workspace into a generic collection of raised cards.
- **Don't** compress controls or type to fit a desktop composition onto a phone.
- **Don't** imply that raw counts are harmonized measurements or that zero proves no fire.
