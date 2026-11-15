# FireLens demonstration data · version 1

This bundle contains all 54,191 records from the two user-provided, approved NASA FIRMS historical archive downloads. No training sample or subset was substituted.

- MODIS Collection 6.1: 6,827 records, Terra 3,596 and Aqua 3,231, source version 61.03.
- VIIRS S-NPP Collection 2, 375 m: 47,364 records, source version 2.
- Both record-date intervals: January 1–December 31, 2024 (UTC).
- Geographic limits are those of the supplied regional archives, recorded in manifest.json; these are not global data.

The gzip files contain byte-identical original CSVs. The manifest retains original and compressed SHA-256 checksums, schema, platform/monthly counts, source URL and original provenance. It contains no credentials. Data source: https://firms.modaps.eosdis.nasa.gov/download/ . NASA citation and disclaimer: https://firms.modaps.eosdis.nasa.gov/download/Readme.txt .

These small compressed distribution files and this manifest are intended to be version-controlled together. Large raw originals and uncompressed generated copies remain ignored. Preparing these files does not commit or deploy them.

`npm run data:verify` checks this bundle without data/raw. `npm run build:clean` builds a temporary source tree containing no raw or uncompressed archive files and verifies the resulting production files. A regular production build also verifies the bundle before compiling. Do not change counts, hashes, or dataset scope independently; prepare a new version explicitly when the demonstration changes.

Raw detection counts are not a harmonized index, individual fires, or burned area. Record extents do not establish observation coverage. Preserve instrument, platform, source versions, confidence encodings and type codes.
