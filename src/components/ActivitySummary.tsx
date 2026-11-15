import { useMemo } from "react";
import { useStudy } from "../state/StudyContext";
export function ActivitySummary() {
  const { focused, filters } = useStudy();
  const counts = useMemo(() => {
    const counts = { MODIS: 0, VIIRS: 0 };
    const platforms = new Set<string>();
    for (const r of focused) {
      counts[r.sensor]++;
      platforms.add(r.satellite);
    }
    return { ...counts, platforms: platforms.size };
  }, [focused]);
  return (
    <p className="activity-summary" aria-live="polite">
      <strong>{focused.length.toLocaleString()} detection records</strong>
      <span>
        MODIS {counts.MODIS.toLocaleString()} · VIIRS{" "}
        {counts.VIIRS.toLocaleString()}
      </span>
      <span>
        {counts.platforms} platforms represented
        {filters.month ? ` · focused on ${filters.month}` : ""}
      </span>
    </p>
  );
}
