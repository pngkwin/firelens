// Pure job planning for FIRMS area-API ingestion.
const DAY = 86_400_000;
const toMs = (d) => Date.parse(`${d}T00:00:00Z`);
const toDate = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d, n) => toDate(toMs(d) + n * DAY);
const min = (a, b) => (a < b ? a : b);
const max = (a, b) => (a > b ? a : b);

/** Inclusive [start, end] split into windows of at most `size` days. */
export function windows(start, end, size = 5) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, size)) {
    const last = min(addDays(d, size - 1), end);
    out.push({ date: d, days: Math.round((toMs(last) - toMs(d)) / DAY) + 1 });
  }
  return out;
}

/**
 * Effective date span per source. SP spans are their availability. An NRT
 * span starts the day after its SP counterpart's last available date, so the
 * science-quality record always wins and nothing is counted twice, even when
 * the NRT archive itself reaches further back (VIIRS_NOAA21_NRT does). All
 * spans are clipped at `end` and at any documented end of production.
 */
export function sourceSpans(sources, availability, end) {
  return sources
    .filter((s) => availability[s.id])
    .map((s) => {
      const a = availability[s.id];
      let start = a.min;
      if (s.kind === "NRT" && s.after && availability[s.after])
        start = max(start, addDays(availability[s.after].max, 1));
      let stop = min(a.max, end);
      if (s.endOfProduction) stop = min(stop, s.endOfProduction);
      return { id: s.id, start, end: stop };
    })
    .filter((s) => s.start <= s.end);
}

export function planJobs({ sources, availability, region, end, size = 5 }) {
  const jobs = [];
  for (const span of sourceSpans(sources, availability, end))
    for (const box of region.boxes)
      for (const w of windows(span.start, span.end, size))
        jobs.push({
          id: `${region.id}/${span.id}/${box.id}/${w.date}_${w.days}`,
          region: region.id,
          source: span.id,
          box: box.id,
          bbox: box.bbox,
          date: w.date,
          days: w.days,
        });
  return jobs;
}
