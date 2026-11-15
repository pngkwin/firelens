import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import { useStudy } from "../state/StudyContext";
import { activityRows, studyDates } from "../data/research";
export function Timeline() {
  const { focused, filters, extent, updateFilters, datasets, windows } =
    useStudy();
  const [unit, setUnit] = useState<"month" | "year">("month");
  const bins = useMemo(
    () =>
      activityRows(
        focused,
        studyDates(filters, extent),
        windows,
        filters.sensor,
        unit,
      ),
    [focused, filters, extent, unit, windows],
  );
  const sensors = new Set(datasets.flatMap((d) => d.sensors));
  return (
    <section className="timeline-panel" aria-labelledby="timeline-title">
      <div className="section-heading">
        <div>
          <h2 id="timeline-title">Detection history</h2>
          <p>
            {filters.month
              ? `Focused on ${filters.month} · clear month to restore history`
              : "Aligned time bins, separate sensor streams · select a period to focus"}
          </p>
        </div>
        <label className="compact-select">
          Aggregate
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as typeof unit)}
          >
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
          </select>
        </label>
      </div>
      <div className="timeline-legend">
        <span>
          <i className="sensor-line modis" /> MODIS{" "}
          {sensors.has("MODIS") ? "" : "· not loaded"}
        </span>
        <span>
          <i className="sensor-line viirs" /> VIIRS{" "}
          {sensors.has("VIIRS") ? "" : "· not loaded"}
        </span>
        <span>Counts of records · coverage unknown</span>
      </div>
      {bins.length ? (
        <>
          <div
            className="chart-container"
            role="img"
            aria-label="Time series of raw detection counts. Exact values and keyboard selection are available in the table below."
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={bins}
                margin={{ top: 15, right: 18, bottom: 0, left: 0 }}
                onClick={(state) => {
                  const period = state?.activeLabel;
                  if (typeof period === "string") {
                    if (unit === "month")
                      updateFilters({
                        month: filters.month === period ? null : period,
                      });
                    else
                      updateFilters({
                        start: `${period}-01-01`,
                        end: `${period}-12-31`,
                        month: null,
                      });
                  }
                }}
              >
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 12, fill: "var(--muted)" }}
                  minTickGap={35}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  width={48}
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: "var(--muted)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  content={({ active, label }) => {
                    const bin = bins.find((b) => b.period === String(label));
                    return active && bin ? (
                      <div className="chart-tooltip">
                        <strong>{String(label ?? "")} · UTC</strong>
                        {(["MODIS", "VIIRS"] as const)
                          .filter(
                            (s) =>
                              filters.sensor === "all" || filters.sensor === s,
                          )
                          .map((s) => (
                            <p key={s}>
                              {s}:{" "}
                              {bin[s] === null
                                ? "Unknown / outside loaded record extent"
                                : `${bin[s].toLocaleString()} records`}
                            </p>
                          ))}
                        <small>Loaded records only; coverage unknown</small>
                      </div>
                    ) : null;
                  }}
                />
                {filters.month && unit === "month" && (
                  <ReferenceArea
                    x1={filters.month}
                    x2={filters.month}
                    fill="var(--selection)"
                  />
                )}
                {sensors.has("MODIS") && filters.sensor !== "VIIRS" && (
                  <Line
                    type="linear"
                    dataKey="MODIS"
                    stroke="var(--fire)"
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                    isAnimationActive={false}
                  />
                )}
                {sensors.has("VIIRS") && filters.sensor !== "MODIS" && (
                  <Line
                    type="linear"
                    dataKey="VIIRS"
                    stroke="var(--viirs)"
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                    isAnimationActive={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details className="data-table-details">
            <summary>View counts and select a period with keyboard</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>UTC period</th>
                    <th>MODIS records</th>
                    <th>VIIRS records</th>
                    <th>Focus</th>
                  </tr>
                </thead>
                <tbody>
                  {bins.map((b) => (
                    <tr
                      key={b.period}
                      className={
                        b.period === filters.month ? "focused-row" : ""
                      }
                    >
                      <th scope="row">{b.period}</th>
                      <td>
                        {sensors.has("MODIS") && filters.sensor !== "VIIRS"
                          ? b.MODIS === null
                            ? "Unknown / outside extent"
                            : b.MODIS.toLocaleString()
                          : "Not in scope"}
                      </td>
                      <td>
                        {sensors.has("VIIRS") && filters.sensor !== "MODIS"
                          ? b.VIIRS === null
                            ? "Unknown / outside extent"
                            : b.VIIRS.toLocaleString()
                          : "Not in scope"}
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() =>
                            unit === "month"
                              ? updateFilters({
                                  month:
                                    filters.month === b.period
                                      ? null
                                      : b.period,
                                })
                              : updateFilters({
                                  start: `${b.period}-01-01`,
                                  end: `${b.period}-12-31`,
                                  month: null,
                                })
                          }
                        >
                          {filters.month === b.period ? "Clear" : "Select"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <div className="timeline-empty">
          Your time series will appear when observations are loaded.
        </div>
      )}
      <p className="analysis-caution">
        Sensor counts are not directly equivalent. Differences can reflect
        instrument characteristics and observation opportunities, not changes in
        fire incidence.
      </p>
    </section>
  );
}
