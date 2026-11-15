/** Descriptive historical utilities, never an automatic coverage correction. */
export type HistoricalValue = {
  month: string;
  count: number | null;
  seriesKey: string; // Must encode sensor/platform, region/cell, resolution, metric and processing policy.
  eligible: boolean; // Caller must establish comparability/coverage; record extent alone cannot set this true.
};
export function quantile(values: number[], p: number): number | null {
  if (p < 0 || p > 1 || !Number.isFinite(p))
    throw Error("Quantile probability must be within 0–1");
  if (!values.length) return null;
  if (values.some((v) => !Number.isFinite(v)))
    throw Error("Non-finite baseline value");
  const sorted = [...values].sort((a, b) => a - b),
    index = (sorted.length - 1) * p;
  const lo = Math.floor(index),
    hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}
export function historicalBaseline(
  series: HistoricalValue[],
  target: string,
  minimumYears = 3,
) {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(target) ||
    !Number.isInteger(minimumYears) ||
    minimumYears < 3
  )
    throw Error("Use a valid month and at least three prior years");
  if (new Set(series.map((v) => v.seriesKey)).size > 1)
    throw Error(
      "Incompatible series: do not mix raw sensors or processing policies",
    );
  if (new Set(series.map((v) => v.month)).size !== series.length)
    throw Error("Duplicate monthly values");
  if (
    series.some(
      (v) =>
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(v.month) ||
        (v.count !== null && (!Number.isFinite(v.count) || v.count < 0)),
    )
  )
    throw Error("Invalid monthly value");
  const prior = series.filter(
    (v) =>
      v.month < target &&
      v.month.slice(5) === target.slice(5) &&
      v.eligible &&
      v.count !== null,
  );
  const years = prior.map((v) => +v.month.slice(0, 4)).sort((a, b) => a - b);
  const base = {
    target,
    years,
    minimumYears,
    seriesKey: series[0]?.seriesKey ?? "",
    baselinePeriod: years.length ? `${years[0]}–${years.at(-1)}` : null,
  };
  if (prior.length < minimumYears)
    return {
      ...base,
      status: "insufficient-history" as const,
      median: null,
      q25: null,
      q75: null,
      relativeDeviation: null,
    };
  const values = prior.map((v) => v.count!),
    median = quantile(values, 0.5)!;
  const current = series.find((v) => v.month === target);
  return {
    ...base,
    status:
      current?.eligible && current.count !== null
        ? ("descriptive-baseline" as const)
        : ("target-not-comparable" as const),
    median,
    q25: quantile(values, 0.25),
    q75: quantile(values, 0.75),
    relativeDeviation:
      current?.eligible && current.count !== null && median > 0
        ? (current.count - median) / median
        : null,
  };
}
