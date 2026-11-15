import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

// Deterministic: the live Convex layer is blocked, so data ends at the bundle's
// planEnd (2026-11-14). The point-export endpoint is mocked (no FIRMS quota).
async function offline(page: Page) {
  await page.route(/\.convex\.cloud\//, (r) => r.abort());
}
const status = (page: Page) => page.locator(".fc-status");
async function ready(page: Page) {
  await expect(status(page)).toContainText("Data through 2026-11-14", { timeout: 60000 });
  await expect(status(page)).toContainText("query");
}

test("default calendar: whole US, focus month vs history, keyboard grid, URL state", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await offline(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Harmonized fire calendar" })).toBeVisible();
  await ready(page);
  await expect(page.getByRole("heading", { name: "Nov 2026 vs other years" })).toBeVisible();
  await expect(page.locator(".fc-focus")).toContainText("% of multi-year average");
  await expect(page.locator(".fc-focus")).toContainText("Month to date: days 1–14");
  // 313 months, Nov 2000 – Nov 2026
  await expect(page.locator(".fc-heat button[data-month]")).toHaveCount(313);
  const aug = page.locator('[data-month="2020-08"]');
  await expect(aug).toHaveAttribute("aria-label", /Aug 2020: [\d,]+ MODIS-eq\. fire-cell-days/);
  await expect(page.locator('[data-month="2024-08"]')).toHaveAttribute("aria-label", /estimated/);
  // keyboard: roving focus moves with arrow keys, Enter selects
  await aug.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-month="2020-09"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[data-month="2021-09"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/focus=2021-09/);
  await expect(page.getByRole("heading", { name: "Sep 2021 vs other years" })).toBeVisible();
  await expect(page.locator(".fc-focus")).toContainText("Whole month compared");
  expect(errors).toEqual([]);
});

test("state preset AOI: California rankings, raw hotspot scale, early warning", async ({ page }) => {
  await offline(page);
  await page.goto("/");
  await ready(page);
  await page.getByLabel("State", { exact: true }).selectOption({ label: "California" });
  await expect(page).toHaveURL(/aoi=preset:us-06/);
  await expect(page.locator(".fc-current")).toContainText("California");
  await ready(page);
  const topMonths = page.locator(".fc-table").filter({ has: page.locator("caption", { hasText: "Top months" }) });
  await expect(topMonths.locator("tbody tr").first()).toContainText("Sep 2020");
  // Early warning (needs daily data)
  const ew = page.locator(".fc-ew");
  await expect(ew).toContainText("Last 7 days", { timeout: 60000 });
  await expect(ew).toContainText("Last 30 days");
  await expect(ew).toContainText("Next 4 weeks, historically");
  await expect(ew).toContainText("critical period");
  // Hotspot-count scale: units follow the scale
  await page.getByLabel("Scale", { exact: true }).selectOption("hotspots-modis");
  await expect(page).toHaveURL(/scale=hotspots-modis/);
  await expect(page.locator('[data-month="2020-09"]')).toHaveAttribute("aria-label", /^Sep 2020: [0-9,]+ MODIS hotspots, rank 1 of 313$/);
  await expect(page.locator("#fc-calendar-title + .fc-sub")).toContainText("hotspots per month");
  await expect(topMonths.locator("thead")).toContainText("Hotspots");
});

test("Iberia quantile mapping: Aug 2025 is the record month", async ({ page }) => {
  await offline(page);
  await page.goto("/?r=iberia&focus=2025-08");
  await ready(page);
  const focus = page.locator(".fc-focus");
  await expect(focus).toContainText("Aug 2025 vs other years");
  await expect(focus).toContainText("quantile mapping");
  await expect(focus).toContainText("rank 1 of 26");
  await expect(page.locator(".fc-method")).toContainText("quantile mapping");
});

test("exports: harmonized CSV, provenance JSON, calendar PNG and AOI point CSV", async ({ page }) => {
  await offline(page);
  // Mocked backend export: two points, one inside the circle AOI.
  await page.route(/\.convex\.site\/hotspots\.csv/, (r) =>
    r.fulfill({
      status: 200,
      headers: { "Content-Type": "text/csv", "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "X-FireLens-Rows, X-FireLens-Sources", "X-FireLens-Rows": "2", "X-FireLens-Sources": "VIIRS_NOAA20_NRT" },
      body: "source,platform,instrument,latitude,longitude,acq_date\nVIIRS_NOAA20_NRT,NOAA-20,VIIRS,39.76,-121.60,2026-11-10\nVIIRS_NOAA20_NRT,NOAA-20,VIIRS,34.00,-118.00,2026-11-10\n",
    }),
  );
  await page.goto("/?r=us&aoi=circle:-121.6,39.76,50&from=2012-01&to=2026-11");
  await ready(page);
  const exports = page.locator(".fc-exports");
  const grab = async (name: string) => {
    const [d] = await Promise.all([page.waitForEvent("download"), exports.getByRole("button", { name }).click()]);
    return { name: d.suggestedFilename(), body: fs.readFileSync((await d.path())!) };
  };
  const csv = await grab("Harmonized monthly CSV");
  expect(csv.name).toMatch(/^firelens_us_.*_2012-01_2026-11_monthly\.csv$/);
  const lines = csv.body.toString().trim().split("\n");
  expect(lines[0]).toContain("modis_eq_fire_cell_days");
  expect(lines[0]).toContain("pct_of_mean");
  expect(lines).toHaveLength(1 + 179); // 2012-01 .. 2026-11
  expect(lines.find((l) => l.startsWith("2024-08"))).toMatch(/ESTIMATED from VIIRS: stratified ratio/);

  await expect(page.locator(".fc-status")).not.toContainText("Loading daily", { timeout: 60000 });
  const prov = JSON.parse((await grab("Provenance JSON")).body.toString());
  expect(prov.methodVersion).toBe("fcd-harmonize-v2");
  expect(prov.selection.selected).toBe("stratified");
  expect(prov.aoi.encoded).toBe("circle:-121.6,39.76,50");
  expect(prov.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(prov.filesUsed.length).toBeGreaterThan(1);
  expect(prov.zeroMeaning).toMatch(/no matching records/);

  const png = await grab("Calendar PNG");
  expect(png.body.subarray(1, 4).toString()).toBe("PNG");
  expect(png.body.length).toBeGreaterThan(10000);

  await exports.getByLabel("From").fill("2026-11-08");
  await exports.getByLabel("To").fill("2026-11-14");
  const [d] = await Promise.all([page.waitForEvent("download"), exports.getByRole("button", { name: "Download points CSV" }).click()]);
  const pts = fs.readFileSync((await d.path())!).toString().trim().split("\n");
  expect(pts).toHaveLength(2); // header + the one point inside the circle
  await expect(exports).toContainText("Downloaded 1 detections inside the area (2 in its bounding box");
});

test("bounding-box form and invalid URL settings", async ({ page }) => {
  await offline(page);
  await page.goto("/?r=us&from=2030-01&scale=nope");
  await expect(page.getByRole("alert")).toContainText("Some link settings were ignored");
  await ready(page);
  await page.getByText("Bounding box", { exact: true }).click();
  await page.getByLabel("West", { exact: true }).fill("-125");
  await page.getByLabel("South", { exact: true }).fill("32");
  await page.getByLabel("East", { exact: true }).fill("-114");
  await page.getByLabel("North", { exact: true }).fill("42");
  await page.getByRole("button", { name: "Apply box" }).click();
  await expect(page).toHaveURL(/aoi=bbox:-125,32,-114,42/);
  await ready(page);
  await expect(page.locator(".fc-current")).toContainText("res-5 cells with data");
});
