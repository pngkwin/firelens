# Historical archive validation

Both original archives were already extracted under `data/raw/`. No ZIP extraction or source modification was necessary. `scripts/prepare-data.mjs` validates their actual CSV contents, preserves the originals, copies original bytes only for deployment, and produces `data-inventory.json` and the runtime manifest. The training sample is not a default or a comparison source.

| Property | MODIS archive | VIIRS archive |
|---|---|---|
| Request | M-C61_850214 | SV-C2_850215 |
| Observations | 6,827 | 47,364 |
| Platform | Terra 3,596; Aqua 3,231 | S-NPP 47,364 |
| Record dates UTC | 2024-01-01–2024-12-31 | 2024-01-01–2024-12-31 |
| Source instrument field | MODIS | SNPP |
| Source version field | 61.03 | 2 |
| Invalid / duplicates | 0 / 0 | 0 / 0 |

Both files have these 15 columns: `latitude, longitude, brightness, scan, track, acq_date, acq_time, satellite, instrument, confidence, version, bright_t31, frp, daynight, type`.

Identification follows the actual instrument/platform fields and NASA's [archive naming documentation](https://firms.modaps.eosdis.nasa.gov/download/Readme.txt), not the thermal column spelling. Original `SNPP` values normalize to VIIRS / S-NPP; original identity values and thermal names are preserved. Confidence values remain distinct source encodings. No harmonization, correction, area inference, or fire-event deduplication is performed.

The generated inventory contains geographic bounds, per-month counts, platform counts, file byte sizes, raw headers, source URLs, and SHA-256 hashes. Runtime checksum verification ensures bundled CSVs match inspected originals. Matching extents are not matched observation coverage. Counts include all supplied type codes, not a vegetation-only selection.

Automated archive tests assert the exact counts, identities, date extents, absence of rejected/duplicate rows, per-sensor filter totals, calendar month totals versus direct record selection, and geographic/date intersection behavior. Browser tests validate the real import worker, linked controls, calendar focus, hotspot attributes, source metadata, duplicate import handling, malformed-file recovery, and responsive layout.
