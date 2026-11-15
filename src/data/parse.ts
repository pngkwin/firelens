import Papa from "papaparse";
import {
  normalizeHeader,
  normalizeRow,
  validateHeaders,
  type Row,
} from "./normalize";
import { MAX_RECORDS, type ParseResult } from "./types";
export function parseCSV(
  text: string,
  datasetId: string,
  progress?: (rows: number) => void,
): ParseResult {
  const result: ParseResult = {
    records: [],
    rejected: 0,
    duplicates: 0,
    warnings: [],
  };
  const seen = new Set<string>();
  let rowCount = 0;
  let checked = false;
  const warn = (message: string) => {
    if (result.warnings.length < 50) result.warnings.push(message);
  };
  Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
    step(step, parser) {
      if (!checked) {
        validateHeaders(step.meta.fields ?? []);
        checked = true;
      }
      rowCount++;
      if (rowCount > MAX_RECORDS) {
        parser.abort();
        throw new Error(
          `File exceeds ${MAX_RECORDS.toLocaleString()} rows. Split or preprocess the dataset before import.`,
        );
      }
      try {
        if (step.errors.length)
          throw new Error(step.errors.map((e) => e.message).join("; "));
        const record = normalizeRow(step.data, datasetId);
        if (seen.has(record.id)) result.duplicates++;
        else {
          seen.add(record.id);
          result.records.push(record);
        }
      } catch (error) {
        result.rejected++;
        warn(`Data row ${rowCount}: ${(error as Error).message}`);
      }
      if (rowCount % 2000 === 0) progress?.(rowCount);
    },
  });
  if (!checked)
    throw new Error(
      "The file contains no data rows. Import a FIRMS CSV with observations.",
    );
  if (!result.records.length)
    throw new Error(
      `No valid observations found. ${result.rejected} rejected rows. ${result.warnings[0] ?? ""}`,
    );
  const missing = result.records.filter(
    (r) => r.version === "Not supplied" || r.confidence === "Not supplied",
  ).length;
  if (missing)
    warn(
      `${missing.toLocaleString()} records lack version or confidence metadata; missing values are preserved as unknown.`,
    );
  return result;
}
