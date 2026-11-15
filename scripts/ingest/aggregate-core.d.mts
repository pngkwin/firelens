// Types for aggregate-core.mjs (used by the Convex backend and tests).
export declare const FINE_RES: number;
export declare const PLATFORM_BIT: Record<string, number>;
export declare const PLATFORMS: string[];
export declare const MODIS_MASK: number;
export declare const VIIRS_MASK: number;
export declare const ALL_MASK: number;
export declare function platformOf(sat: string): string;
export declare function unionCount(hist: Record<string, number>, subset: number): number;
export declare function maskMatches(hist: Record<string, number>, a: number, b: number): number;
export type CoarseRow = { cell: string; period: string; any: Record<string, number>; day: Record<string, number>; night: Record<string, number>; det: Record<string, number>; frp: Record<string, number> };
export declare class CellDayAccumulator {
  constructor(opts?: { staticCells?: Set<string> | null; start?: string | null; end?: string | null; inRegion?: ((cell8: string) => boolean) | null });
  cells: Map<string, { d: number; n: number; det: Record<string, number>; frp: Record<string, number> }>;
  accepted: number;
  excludedStatic: number;
  outsideRegion: number;
  outOfWindow: number;
  rejected: number;
  add(row: { latitude: string | number; longitude: string | number; acq_date: string; satellite: string; daynight: string; frp?: string | number | null }): void;
  coarse(res: number, by?: "month" | "day"): CoarseRow[];
}
