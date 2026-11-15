import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";
import Papa from "papaparse";
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const root = process.argv.includes("--dist") ? "dist" : "public";
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "data/demo/v1/manifest.json"), "utf8"),
);
let total = 0;
for (const item of manifest.files) {
  const compressed = fs.readFileSync(path.join(root, item.url));
  if (hash(compressed) !== item.compressedHash)
    throw new Error(`${item.name}: compressed checksum mismatch`);
  const bytes = gunzipSync(compressed);
  if (bytes.length !== item.bytes || hash(bytes) !== item.hash)
    throw new Error(`${item.name}: original checksum mismatch`);
  const parsed = Papa.parse(bytes.toString("utf8"), {
    header: true,
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length || parsed.data.length !== item.inputRows)
    throw new Error(`${item.name}: row validation failed`);
  total += item.records;
  console.log(
    `${item.name}: ${item.records.toLocaleString()} records verified`,
  );
}
if (total !== manifest.recordCount || total !== 54191)
  throw new Error(
    "Demonstration bundle total differs from expected 54,191; make an explicit version change before changing its scope.",
  );
console.log(
  `${root}: ${manifest.bundleVersion}, ${total.toLocaleString()} records, both original SHA-256 hashes verified. No data/raw dependency.`,
);
