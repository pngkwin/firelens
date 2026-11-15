import { parseCSV } from "./parse";
import { MAX_FILE_BYTES } from "./types";
self.onmessage = async (event: MessageEvent<{ file: File; id: string }>) => {
  try {
    const { file, id } = event.data;
    if (file.size > MAX_FILE_BYTES)
      throw new Error(
        "This file exceeds 25 MB. Use a regional subset or preprocess it into smaller files.",
      );
    const bytes = await file.arrayBuffer();
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    )
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    const result = parseCSV(new TextDecoder().decode(bytes), id, (rows) =>
      self.postMessage({ type: "progress", rows }),
    );
    self.postMessage({ type: "complete", result, hash });
  } catch (error) {
    self.postMessage({ type: "error", message: (error as Error).message });
  }
};
