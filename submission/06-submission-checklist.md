# Final submission checklist

**Public website:** PUBLIC_URL_PENDING (filled in after deployment)
**Repository branch:** `wip/phase5-snapshot`, local commit only; the GitHub repository is not published.

## Done by the team and Claude (verified)

- [x] Harmonized US and Iberia record, 2000-11 to 2026-11-14 (313 monthly periods); November 2026 marked incomplete.
- [x] Five research features plus Fire season and Documented fires steps; three research cases (California 2020, Texas 2011, Iberia 2025).
- [x] Exports: monthly CSV, calendar PNG, provenance JSON, held-out validation CSV/JSON, season CSV, brief in Markdown and HTML, print.
- [x] Tests: `npm test` (vitest), `npx tsc -b`, `npm run build` (with data, history and ingest verification), `npm run test:e2e` (Playwright).
- [x] Provenance audit: raw rows reconciled to published cell-days; 19,270 recent records identical to fresh NASA FIRMS files.
- [x] Submission texts in this folder.

## Actions only you can do

1. **Record the video(s)** using `02-elevator-pitch-and-video-scripts.md`. No video has been recorded.
2. **Fill in team details** on the Space Apps project page (team name, members, location).
3. **Paste the texts:**
   - project description: `01-project-description.md`;
   - elevator pitch: `02-…`;
   - "what goes beyond": `04-…`;
   - data and resources plus AI disclosure: `05-…`.
4. **Confirm the NOAA-21 VIIRS DOI** (VJ214IMGT) on the FIRMS citation page, and the other DOIs if the form asks for exact citations.
5. **Decide whether to share the code.** If you want a public repository, publish it yourself. It is not published, and `gpt_zip.zip` should be removed from history first. Check `.env*` is not included; it is gitignored.
6. **Submit the entry** on the Space Apps site before the deadline. The entry has not been submitted.
7. **Optional:**
   - set `FIRMS_MAP_KEY` and Convex variables if you want live near-real-time days (the public site is static and works without them);
   - add a custom domain in Vercel.

## Known open issues (disclose if asked)

- **Validation target:** validation is against MODIS, not ground truth. Observation opportunity (clouds, smoke) is not modelled.
- **Small-area intervals:** validated at zone scale (~600,000 km²) only.
- **US near-real-time MODIS shortfall:** September–November 2026 is 22–39% below the VIIRS-based estimate; the cause is unknown.
- **Unconfirmed outages:** 56 detected outage runs have no published notice.
- **Perimeters:** fire perimeters (MTBS/NIFC) are not integrated. Map points exist only for CAL FIRE incidents.
- **Performance:** a hand-drawn Texas-sized polygon takes about 1.1 s to query (target 1 s).
