import { useEffect, useMemo, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { useStudy } from "../state/StudyContext";
import {
  activityRows,
  availabilityText,
  countScale,
  periodAvailability,
  studyDates,
} from "../data/research";
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export function Calendar() {
  const { datasets, scoped, filters, extent, windows, updateFilters } =
    useStudy();
  const { calendarSensor: chosenSensor, setCalendarSensor: setChosenSensor } =
    useStudy();
  const sensor = filters.sensor === "all" ? chosenSensor : filters.sensor;
  const dates = studyDates(filters, extent, false);
  const rows = useMemo(
    () => activityRows(scoped, dates, windows),
    [scoped, dates.start, dates.end, windows],
  );
  const bins = useMemo(() => new Map(rows.map((r) => [r.period, r])), [rows]);
  const max = Math.max(1, ...rows.map((r) => r[sensor] ?? 0)),
    scale = countScale(max);
  const years =
    dates.start && dates.end && dates.start <= dates.end
      ? Array.from(
          {
            length: Math.min(
              201,
              +dates.end.slice(0, 4) - +dates.start.slice(0, 4) + 1,
            ),
          },
          (_, i) => +dates.start.slice(0, 4) + i,
        )
      : [];
  const [page, setPage] = useState(0),
    [hover, setHover] = useState("");
  useEffect(() => setPage(0), [dates.start, dates.end, sensor]);
  useEffect(() => {
    if (filters.month && years.length)
      setPage(
        Math.max(0, Math.floor((+filters.month.slice(0, 4) - years[0]) / 25)),
      );
  }, [filters.month]);
  const sourceLoaded = datasets.some((d) =>
    d.records.some((r) => r.sensor === sensor),
  );
  return (
    <section className="calendar-panel" aria-labelledby="calendar-title">
      <div className="section-heading">
        <div>
          <h2 id="calendar-title">Burning activity calendar</h2>
          <p>Monthly detection counts · raw observations</p>
        </div>
        <CalendarDays size={18} className="muted-icon" />
      </div>
      <div className="calendar-toolbar">
        <div className="segmented" role="group" aria-label="Calendar sensor">
          {(["MODIS", "VIIRS"] as const).map((s) => (
            <button
              key={s}
              className={sensor === s ? "active" : ""}
              aria-pressed={sensor === s}
              disabled={filters.sensor !== "all" && filters.sensor !== s}
              onClick={() => {
                setChosenSensor(s);
                updateFilters({ month: null });
              }}
            >
              {s}
              <span className={"sensor-dot " + s.toLowerCase()} />
            </button>
          ))}
        </div>
        <span className="calendar-unit">Records / month</span>
      </div>
      <div className="calendar-scroll">
        <table className="calendar-table">
          <caption className="sr-only">
            Monthly {sensor} detection counts. Asterisks indicate partial
            record/date intervals; observation coverage is always unknown.
          </caption>
          <thead>
            <tr>
              <th scope="col">Year</th>
              {months.map((m) => (
                <th scope="col" key={m}>
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.slice(page * 25, page * 25 + 25).map((year) => (
              <tr key={year}>
                <th scope="row">{year}</th>
                {months.map((month, index) => {
                  const period =
                    year + "-" + String(index + 1).padStart(2, "0");
                  const status = periodAvailability(
                      period,
                      dates,
                      windows[sensor],
                    ),
                    count = bins.get(period)?.[sensor] ?? null;
                  const unavailable = count === null,
                    partial = status === "partial-record-interval",
                    level =
                      scale.find((s) => (count ?? 0) <= s.high)?.level ?? 5;
                  const label =
                    month +
                    " " +
                    year +
                    ": " +
                    (unavailable
                      ? availabilityText(status)
                      : count.toLocaleString() +
                        " " +
                        sensor +
                        " detections; " +
                        (partial ? "partial record/date interval; " : "") +
                        "coverage unknown");
                  return (
                    <td key={period} title={label}>
                      <button
                        disabled={unavailable}
                        aria-label={label}
                        aria-pressed={filters.month === period}
                        title={
                          label +
                          (unavailable
                            ? ""
                            : ". Select to focus the map and timeline.")
                        }
                        className={
                          "heat-cell " +
                          (unavailable
                            ? "unknown"
                            : count === 0
                              ? "zero"
                              : "heat-" + level) +
                          (filters.month === period ? " selected" : "") +
                          (partial ? " partial" : "")
                        }
                        onMouseEnter={() => setHover(label)}
                        onMouseLeave={() => setHover("")}
                        onFocus={() => setHover(label)}
                        onBlur={() => setHover("")}
                        onClick={() =>
                          updateFilters({
                            month: filters.month === period ? null : period,
                          })
                        }
                      >
                        {unavailable ? "—" : count.toLocaleString()}
                        {partial && !unavailable && (
                          <sup aria-hidden="true">*</sup>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!years.length && (
          <div className="calendar-empty">
            <CalendarDays size={28} />
            <h3>Your historical record starts here</h3>
            <p>
              Import official FIRMS observations to reveal monthly patterns
              across years.
            </p>
          </div>
        )}
        {years.length > 0 && !sourceLoaded && (
          <p className="inline-note">
            No {sensor} dataset loaded. Import this instrument to compare its
            monthly history.
          </p>
        )}
      </div>
      {years.length > 25 && (
        <div className="pagination calendar-pagination">
          <button
            className="button small"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous years
          </button>
          <span>
            {years[page * 25]}–
            {years[Math.min(years.length - 1, page * 25 + 24)]}
          </span>
          <button
            className="button small"
            disabled={(page + 1) * 25 >= years.length}
            onClick={() => setPage((p) => p + 1)}
          >
            Next years
          </button>
        </div>
      )}
      <div className="calendar-readout" aria-live="polite">
        {hover ||
          (filters.month
            ? "Selected " + filters.month + " · map and timeline focused"
            : "Select a month to focus the linked map and timeline.")}
        {filters.month && (
          <button
            className="text-button"
            onClick={() => updateFilters({ month: null })}
          >
            Clear <X size={12} />
          </button>
        )}
      </div>
      <div
        className="count-scale"
        role="group"
        aria-label={
          sensor + " monthly detection count scale, linear, current study"
        }
      >
        <span className="scale-title">Detections / month</span>
        <span>
          <i className="zero" />0
        </span>
        {scale.map((s) => (
          <span key={s.level}>
            <i className={"heat-" + s.level} />
            {s.low === s.high
              ? s.low.toLocaleString()
              : s.low.toLocaleString() + "–" + s.high.toLocaleString()}
          </span>
        ))}
        <span>
          <i className="unknown" />— Outside record/study extent
        </span>
      </div>
      <div className="calendar-note">
        <strong>Observation history, not a harmonized index.</strong>
        <p>
          Values count loaded {sensor} records. Zero = no matching records. * =
          partial record/date interval. Coverage remains unknown, including
          months without an asterisk.
        </p>
      </div>
    </section>
  );
}
