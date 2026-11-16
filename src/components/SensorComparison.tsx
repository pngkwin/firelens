import { useMemo, useState } from "react";
import { useStudy } from "../state/StudyContext";
import { availabilityText, comparisonData, sensors } from "../data/research";
export function SensorComparison() {
  const { records, datasets, filters, extent, windows, updateFilters } =
    useStudy();
  const [distribution, setDistribution] = useState(false);
  const comparison = useMemo(
    () => comparisonData(records, filters, windows, extent),
    [records, filters, windows, extent],
  );
  const totals = {
    MODIS: comparison.records.filter((r) => r.sensor === "MODIS").length,
    VIIRS: comparison.records.filter((r) => r.sensor === "VIIRS").length,
  };
  const max = Math.max(
    1,
    ...comparison.rows.flatMap((r) => [r.MODIS ?? 0, r.VIIRS ?? 0]),
  );
  return (
    <section className="comparison-panel" aria-labelledby="comparison-title">
      <h2 id="comparison-title">Sensor comparison</h2>
      <p>Same region and overlapping record dates. Separate observations.</p>
      {filters.sensor !== "all" && (
        <p className="comparison-scope-note">
          {filters.sensor} filter is active. The other instrument is excluded.
          Select “Both instruments” to compare.
        </p>
      )}
      <div className="sensor-comparison">
        {sensors.map((s) => {
          const loaded = windows[s].length > 0,
            excluded = filters.sensor !== "all" && filters.sensor !== s;
          const peak = comparison.rows.reduce<{
            period: string;
            count: number;
          } | null>(
            (best, r) =>
              r[s] !== null && r[s]! > 0 && (!best || r[s]! > best.count)
                ? { period: r.period, count: r[s]! }
                : best,
            null,
          );
          const platforms = [
            ...new Set(
              comparison.records
                .filter((r) => r.sensor === s)
                .map((r) => r.satellite),
            ),
          ];
          return (
            <div key={s}>
              <h3>
                <i className={"sensor-dot " + s.toLowerCase()} />
                {s}
              </h3>
              <strong className="comparison-count">
                {!loaded || excluded || !comparison.start
                  ? "n/a"
                  : totals[s].toLocaleString()}
              </strong>
              <span>
                {!loaded
                  ? "Not loaded"
                  : excluded
                    ? "Filtered out"
                    : comparison.start
                      ? "Detection records"
                      : "No shared interval"}
              </span>
              <p>
                {platforms.length
                  ? platforms
                      .map(
                        (p) =>
                          p +
                          ": " +
                          comparison.records
                            .filter((r) => r.sensor === s && r.satellite === p)
                            .length.toLocaleString(),
                      )
                      .join(" · ")
                  : [
                      ...new Set(
                        datasets
                          .filter((d) => d.sensors.includes(s))
                          .flatMap((d) => d.satellites),
                      ),
                    ].join(" / ") || "No platform loaded"}
              </p>
              {peak && !excluded && (
                <p>
                  Highest loaded monthly count:{" "}
                  <strong>
                    {peak.period} · {peak.count.toLocaleString()}
                  </strong>
                  {comparison.rows.filter((r) => r[s] === peak.count).length > 1
                    ? " (tied)"
                    : ""}
                  .
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="comparison-period">
        {comparison.start
          ? "Shared record-date interval: " +
            comparison.start +
            " – " +
            comparison.end
          : "Load both instruments with overlapping record dates to compare."}
      </p>
      {comparison.rows.length > 0 && (
        <details className="monthly-comparison">
          <summary>Monthly patterns & within-sensor shares</summary>
          <label className="share-toggle">
            <input
              type="checkbox"
              checked={distribution}
              onChange={(e) => setDistribution(e.target.checked)}
            />
            Show each month’s share of its instrument’s selected records
          </label>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Month UTC</th>
                  <th>MODIS</th>
                  <th>VIIRS</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr key={row.period}>
                    <th scope="row">
                      <button
                        className="text-button"
                        onClick={() =>
                          updateFilters({
                            month:
                              filters.month === row.period ? null : row.period,
                          })
                        }
                      >
                        {row.period}
                      </button>
                    </th>
                    {sensors.map((s) => {
                      const value = row[s],
                        excluded =
                          filters.sensor !== "all" && filters.sensor !== s,
                        share =
                          value !== null && totals[s] > 0
                            ? (value / totals[s]) * 100
                            : 0;
                      return (
                        <td
                          key={s}
                          title={
                            excluded
                              ? "Excluded by global sensor filter"
                              : availabilityText(
                                  row[
                                    (s + "_status") as
                                      "MODIS_status" | "VIIRS_status"
                                  ],
                                )
                          }
                        >
                          {value === null ? (
                            excluded ? (
                              "Filtered out"
                            ) : (
                              "Unknown"
                            )
                          ) : (
                            <>
                              <span>
                                {distribution
                                  ? share.toFixed(1) + "%"
                                  : value.toLocaleString()}
                              </span>
                              <span
                                className={"comparison-bar " + s.toLowerCase()}
                                style={{
                                  width:
                                    (distribution
                                      ? share
                                      : (value / max) * 100) + "%",
                                }}
                                aria-hidden="true"
                              />
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Shares use each instrument’s own total in the selected overlap. They
            do not calibrate the sensors. Partial record intervals remain
            incomplete; coverage is unknown.
          </p>
        </details>
      )}
      <p className="analysis-caution">
        No correction factors applied. Counts are not unique fires or burned
        area. Shared record dates do not establish equal observation coverage.
      </p>
    </section>
  );
}
