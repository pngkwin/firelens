import { MAX_RECORDS, type Dataset, type ParseResult } from "./types";
export interface DataRepository {
  importFile(
    file: File,
    source: string,
    progress: (rows: number) => void,
  ): Promise<Dataset>;
}
export const browserRepository: DataRepository = {
  importFile(file, source, progress) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const worker = new Worker(
        new URL("./import.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onerror = () => {
        worker.terminate();
        reject(
          new Error(
            "CSV worker failed. Try a smaller file or reload the page.",
          ),
        );
      };
      worker.onmessage = (
        event: MessageEvent<{
          type: string;
          rows: number;
          message: string;
          result: ParseResult;
          hash: string;
        }>,
      ) => {
        const message = event.data;
        if (message.type === "progress") return progress(message.rows);
        worker.terminate();
        if (message.type === "error") return reject(new Error(message.message));
        const records = message.result.records;
        const dates = records.map((r) => r.date).sort();
        resolve({
          id,
          name: file.name,
          source,
          hash: message.hash,
          importedAt: new Date().toISOString(),
          ...message.result,
          sensors: [...new Set(records.map((r) => r.sensor))],
          satellites: [...new Set(records.map((r) => r.satellite))],
          versions: [...new Set(records.map((r) => r.version))],
          start: dates[0],
          end: dates[dates.length - 1],
        });
      };
      worker.postMessage({ file, id });
    });
  },
};
export function addDataset(
  existing: Dataset[],
  candidate: Dataset,
): { datasets: Dataset[]; message: string } {
  if (existing.some((d) => d.hash === candidate.hash))
    throw new Error(
      `${candidate.name} is already loaded (identical file content).`,
    );
  const seen = new Set(existing.flatMap((d) => d.records.map((r) => r.id)));
  const records = candidate.records.filter((r) => !seen.has(r.id));
  const overlap = candidate.records.length - records.length;
  if (!records.length)
    throw new Error(
      "All valid observations in this file are already loaded. No duplicate observations were added.",
    );
  if (seen.size + records.length > MAX_RECORDS)
    throw new Error(
      "Workspace limit: 100,000 observations. Remove a dataset or use a smaller regional subset.",
    );
  const dates = records.map((r) => r.date).sort();
  const added: Dataset = {
    ...candidate,
    records,
    sensors: [...new Set(records.map((r) => r.sensor))],
    satellites: [...new Set(records.map((r) => r.satellite))],
    versions: [...new Set(records.map((r) => r.version))],
    start: dates[0],
    end: dates[dates.length - 1],
    duplicates: candidate.duplicates + overlap,
    warnings: overlap
      ? [
          ...candidate.warnings,
          `${overlap} overlapping observations skipped; first imported record wins, including across source versions. Removing that first dataset does not restore skipped records; reimport this file if needed.`,
        ]
      : candidate.warnings,
  };
  return {
    datasets: [...existing, added],
    message: `${records.length.toLocaleString()} observations imported from ${candidate.name}. ${candidate.rejected} rejected; ${added.duplicates} duplicates skipped.`,
  };
}
