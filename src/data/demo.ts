import { MAX_FILE_BYTES } from "./types";
export interface DemoFile {
  name: string;
  url: string;
  source: string;
  hash: string;
  compressedHash: string;
  bytes: number;
  records: number;
  encoding: "gzip";
}
export interface DemoManifest {
  bundleVersion: string;
  recordCount: number;
  files: DemoFile[];
}
const sha256 = async (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
export async function loadDemoFile(item: DemoFile) {
  if (item.bytes > MAX_FILE_BYTES)
    throw new Error(`${item.name}: bundle exceeds supported file size.`);
  const response = await fetch(item.url);
  if (!response.ok)
    throw new Error(`Could not load ${item.name} (HTTP ${response.status}).`);
  const compressed = await response.arrayBuffer();
  // fetch may already have decoded a host's Content-Encoding:gzip response.
  const receivedHash = await sha256(compressed);
  if (receivedHash === item.hash && compressed.byteLength === item.bytes)
    return new File([compressed], item.name, { type: "text/csv" });
  if (receivedHash !== item.compressedHash)
    throw new Error(`${item.name}: compressed bundle checksum mismatch.`);
  if (typeof DecompressionStream === "undefined")
    throw new Error(
      "This browser cannot decompress the demonstration bundle. Use a current browser or import the original CSV.",
    );
  const blob = await new Response(
    new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream("gzip")),
  ).blob();
  if (blob.size !== item.bytes)
    throw new Error(`${item.name}: decompressed file size mismatch.`);
  return new File([blob], item.name, { type: "text/csv" });
}
