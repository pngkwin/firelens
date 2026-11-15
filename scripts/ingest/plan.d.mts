// Types for plan.mjs (used by the Convex backend and tests).
export declare const addDays: (d: string, n: number) => string;
export declare function windows(start: string, end: string, size?: number): Array<{ date: string; days: number }>;
export declare function sourceSpans(
  sources: Array<{ id: string; kind: string; after?: string; endOfProduction?: string }>,
  availability: Record<string, { min: string; max: string }>,
  end: string,
): Array<{ id: string; start: string; end: string }>;
export declare function planJobs(opts: { sources: unknown[]; availability: Record<string, { min: string; max: string }>; region: { id: string; boxes: Array<{ id: string; bbox: number[] }> }; end: string; size?: number }): Array<{ id: string; region: string; source: string; box: string; bbox: number[]; date: string; days: number }>;
