import type { Dataset, Filters, Observation, Sensor } from "./types";
import {
  activityRows,
  countScale,
  periodAvailability,
  recordWindows,
  studyDates,
  type DateWindow,
} from "./research";
export async function calendarImage(
  records: Observation[],
  datasets: Dataset[],
  filters: Filters,
  extent: DateWindow,
  sensor: Sensor,
): Promise<Blob> {
  await document.fonts.ready;
  const dates = studyDates(filters, extent),
    windows = recordWindows(datasets),
    rows = activityRows(records, dates, windows, sensor);
  if (!rows.length)
    throw new Error("No calendar periods in the selected scope.");
  const bins = new Map(rows.map((r) => [r.period, r]));
  const years = [...new Set(rows.map((r) => +r.period.slice(0, 4)))];
  const max = Math.max(1, ...rows.map((r) => r[sensor] ?? 0)),
    scale = countScale(max);
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 390 + years.length * 45 + datasets.length * 85;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create a calendar image.");
  const c = context;
  const css = getComputedStyle(document.documentElement);
  const color = (name: string) =>
    css.getPropertyValue("--" + name).trim() || "#203c34";
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, canvas.width, canvas.height);
  const text = (
    value: string,
    x: number,
    y: number,
    size = 16,
    weight = 400,
    ink = "ink",
  ) => {
    c.fillStyle = color(ink);
    c.font = weight + " " + size + 'px "Source Sans 3", sans-serif';
    c.fillText(value, x, y);
  };
  text("FireLens · Burning activity calendar", 40, 49, 30, 600);
  text(
    sensor +
      " raw detection records · " +
      dates.start +
      " to " +
      dates.end +
      " UTC",
    40,
    82,
    19,
  );
  text(
    "Study: " +
      (filters.bounds
        ? JSON.stringify(filters.bounds)
        : "All loaded locations") +
      (filters.month ? " · focused month " + filters.month : ""),
    40,
    112,
    16,
  );
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
  const x0 = 120,
    w = 118,
    y0 = 170;
  text("Year", 40, 151, 16, 600);
  months.forEach((month, i) => text(month, x0 + i * w + 35, 151, 16, 600));
  for (const [index, year] of years.entries()) {
    const y = y0 + index * 45;
    text(String(year), 40, y + 25, 18, 600);
    for (let i = 0; i < 12; i++) {
      const period = year + "-" + String(i + 1).padStart(2, "0"),
        value = bins.get(period)?.[sensor] ?? null,
        status = periodAvailability(period, dates, windows[sensor]);
      const level = scale.find((s) => (value ?? 0) <= s.high)?.level ?? 5;
      c.fillStyle = color(
        value === null ? "soft" : value === 0 ? "background" : "heat" + level,
      );
      c.fillRect(x0 + i * w, y, w - 6, 36);
      text(
        value === null
          ? "n/a"
          : value.toLocaleString() +
              (status === "partial-record-interval" ? "*" : ""),
        x0 + i * w + 15,
        y + 24,
        15,
        600,
        level === 5 && value !== null && value > 0 ? "surface" : "ink",
      );
    }
  }
  let y = y0 + years.length * 45 + 30;
  text("Detections / month (linear count ranges)", 40, y, 17, 600);
  y += 25;
  scale.forEach((s, i) => {
    c.fillStyle = color("heat" + s.level);
    c.fillRect(40 + i * 270, y, 25, 17);
    text(
      s.low.toLocaleString() + "–" + s.high.toLocaleString(),
      75 + i * 270,
      y + 15,
      15,
    );
  });
  y += 52;
  const wrap = (value: string) => {
    const words = value.split(" ");
    let line = "";
    c.font = '15px "Source Sans 3", sans-serif';
    for (const word of words) {
      if (c.measureText(line + word).width > 1500) {
        text(line, 40, y, 15);
        y += 21;
        line = "";
      }
      line += word + " ";
    }
    if (line) {
      text(line, 40, y, 15);
      y += 23;
    }
  };
  wrap(
    "Zero = no matching records. Dash = outside loaded record/study dates. * = partial record/date interval. Satellite observation coverage remains unknown.",
  );
  wrap(
    "Raw records only: not unique fires, burned area, or a scientifically harmonized index. Source-specific confidence and sensor differences are preserved.",
  );
  for (const d of datasets) {
    wrap(
      "Source: " +
        d.name +
        " · " +
        d.sensors.join("/") +
        " · " +
        d.satellites.join("/") +
        " · version " +
        d.versions.join("/"),
    );
    wrap("SHA-256: " + d.hash);
    wrap(d.source);
  }
  text(
    "Generated " + new Date().toISOString() + " · NASA FIRMS",
    40,
    y + 15,
    14,
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Calendar PNG could not be generated.")),
      "image/png",
    ),
  );
}
