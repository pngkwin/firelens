import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  emptyFilters,
  type Dataset,
  type Filters,
  type Observation,
} from "../data/types";
import { filterRecords } from "../data/analytics";
import { recordWindows } from "../data/research";
function useStudyState() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [calendarSensor, setCalendarSensor] = useState<"MODIS" | "VIIRS">(
    "VIIRS",
  );
  const records = useMemo(() => datasets.flatMap((d) => d.records), [datasets]);
  const windows = useMemo(() => recordWindows(datasets), [datasets]);
  const scoped = useMemo(
    () => filterRecords(records, filters, false),
    [records, filters],
  );
  const focused = useMemo(
    () =>
      filters.month
        ? scoped.filter((r) => r.date.startsWith(filters.month!))
        : scoped,
    [scoped, filters.month],
  );
  const selected: Observation | undefined = useMemo(
    () => focused.find((r) => r.id === selectedId),
    [focused, selectedId],
  );
  const extent = useMemo(() => {
    const dates = records.map((r) => r.date).sort();
    return { start: dates[0] ?? "", end: dates.at(-1) ?? "" };
  }, [records]);
  function updateFilters(update: Partial<Filters>) {
    setFilters((old) => ({ ...old, ...update }));
    setSelectedId(null);
  }
  return {
    datasets,
    setDatasets,
    filters,
    setFilters,
    records,
    windows,
    scoped,
    focused,
    selected,
    calendarSensor,
    setCalendarSensor,
    setSelectedId,
    extent,
    updateFilters,
  };
}
const StudyContext = createContext<ReturnType<typeof useStudyState> | null>(
  null,
);
export function StudyProvider({ children }: { children: ReactNode }) {
  const value = useStudyState();
  return (
    <StudyContext.Provider value={value}>{children}</StudyContext.Provider>
  );
}
export function useStudy() {
  const value = useContext(StudyContext);
  if (!value) throw new Error("StudyProvider missing");
  return value;
}
