import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
const inventory = JSON.parse(
  fs.readFileSync("docs/data-inventory.json", "utf8"),
);
const root = "public/data/demo/v1";
fs.mkdirSync(root, { recursive: true });
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const files = inventory.map((d) => {
  const bytes = fs.readFileSync(d.path);
  if (hash(bytes) !== d.hash)
    throw new Error(`${d.path}: original differs from validated inventory`);
  const compressed = gzipSync(bytes, { level: 9 });
  const file = `${d.name}.gz`;
  fs.writeFileSync(path.join(root, file), compressed);
  return {
    ...d,
    url: `/data/demo/v1/${file}`,
    encoding: "gzip",
    compressedBytes: compressed.length,
    compressedHash: hash(compressed),
  };
});
const manifest = {
  schemaVersion: 1,
  bundleVersion: "2024-archives-v1",
  description:
    "Complete user-provided 2024 FIRMS MODIS Terra/Aqua and VIIRS S-NPP archive CSVs; no sample substitution.",
  recordCount: files.reduce((n, d) => n + d.records, 0),
  limitations:
    "Raw detection records, not harmonized. Geographic scope is the original supplied archive subset; record extents are not observation coverage.",
  files,
};
fs.writeFileSync(
  path.join(root, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `Prepared ${manifest.recordCount.toLocaleString()} authentic observations: ${(files.reduce((n, d) => n + d.compressedBytes, 0) / 1024 / 1024).toFixed(2)} MiB compressed. No sources modified, committed, or deployed.`,
);
