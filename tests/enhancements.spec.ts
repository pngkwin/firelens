import { test, expect } from "@playwright/test";
import fs from "node:fs";
import Papa from "papaparse";
test("explicit gzip delivery also loads both verified source streams", async ({
  page,
}) => {
  await page.route("**/data/demo/v1/*.gz", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: fs.readFileSync(
        "public/data/demo/v1/" +
          new URL(route.request().url()).pathname.split("/").at(-1),
      ),
    }),
  );
  await page.goto("/#workspace");
  await expect(page.getByText("2 datasets loaded")).toBeVisible({timeout:90000});
  await expect(page.getByText("54,191 records in focus")).toBeVisible();
});
test("production bundle, monthly comparisons, filtered CSV downloads and calendar PNG", async ({
  page,
}) => {
  test.setTimeout(180000);
  fs.mkdirSync(".impeccable/review", { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#workspace");
  await expect(page.getByText("2 datasets loaded")).toBeVisible({timeout:90000});
  await expect(page.getByText("54,191 records in focus")).toBeVisible();
  await expect(page.locator(".map-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByRole("group", { name: /VIIRS monthly detection count scale/ }),
  ).toContainText("1–1,348");
  await page
    .getByText("Monthly patterns & within-sensor shares", { exact: true })
    .click();
  const feb = page
    .locator(".monthly-comparison tbody tr")
    .filter({ hasText: "2024-02" });
  await expect(feb).toContainText("1,438");
  await expect(feb).toContainText("6,744");
  await page.getByLabel("Show each month’s share").check();
  await expect(feb).toContainText("21.1%");
  await expect(feb).toContainText("14.2%");
  await expect(page.locator(".comparison-panel")).toContainText("Terra: 3,596");
  await expect(page.locator(".comparison-panel")).toContainText("Aqua: 3,231");
  await page.getByLabel("Sensor filter").selectOption("MODIS");
  await expect(page.locator(".comparison-scope-note")).toContainText(
    "other instrument is excluded",
  );
  await page
    .getByRole("button", {
      name: "Jun 2024: 377 MODIS detections; coverage unknown",
      exact: true,
    })
    .click();
  await expect(page.getByText("377 records in focus")).toBeVisible();
  await page
    .getByRole("button", { name: "Export results", exact: true })
    .click();
  const observationDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Observations CSV", exact: true })
    .click();
  const observation = await observationDownload;
  const observationPath = await observation.path();
  expect(observationPath).toBeTruthy();
  const parsed = Papa.parse<Record<string, string>>(
    fs.readFileSync(observationPath!, "utf8"),
    { header: true, skipEmptyLines: true },
  );
  expect(parsed.data).toHaveLength(377);
  expect(
    parsed.data.every(
      (r) =>
        r.sensor === "MODIS" &&
        r.acq_date_utc.startsWith("2024-06") &&
        r.acq_time_utc.length === 4,
    ),
  ).toBe(true);
  expect(parsed.data[0].dataset_sha256).toBe(
    "4b726464ac6d7ae6444a597f6e0c448f57a19e07dcde1b06135ba13e2e5a0850",
  );
  expect(JSON.parse(parsed.data[0].study_filters).month).toBe("2024-06");
  const summaryDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Monthly summary CSV", exact: true })
    .click();
  const summary = await summaryDownload;
  const summaryRows = Papa.parse<Record<string, string>>(
    fs.readFileSync((await summary.path())!, "utf8"),
    { header: true, skipEmptyLines: true },
  );
  expect(summaryRows.data).toHaveLength(1);
  expect(summaryRows.data[0]).toMatchObject({
    year: "2024",
    month: "06",
    MODIS_count: "377",
    VIIRS_count: "",
    VIIRS_status: "Excluded by sensor filter",
  });
  const pngDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Calendar PNG", exact: true }).click();
  const png = await pngDownload;
  const pngPath = (await png.path())!;
  expect(fs.readFileSync(pngPath).subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  fs.copyFileSync(pngPath, ".impeccable/review/calendar-export.png");
  await expect(
    page.getByRole("status").filter({ hasText: "Export prepared." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close export panel" }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByLabel("Start date").fill("2000-01-01");
  await page.getByLabel("End date").fill("2030-12-31");
  await expect(page.getByRole("button", { name: "Next years" })).toBeVisible();
  await expect(page.locator(".calendar-table tbody tr")).toHaveCount(25);
  await page.getByRole("button", { name: "Next years" }).click();
  await expect(page.locator(".calendar-table tbody tr")).toHaveCount(6);
  await expect(page.locator(".calendar-table")).toContainText("2030");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByLabel("Start date").fill("2024-02-10");
  await page.getByLabel("End date").fill("2024-02-20");
  await expect(page.locator(".heat-cell.partial")).toHaveCount(1);
  await expect(page.locator(".heat-cell.partial")).toHaveAttribute(
    "title",
    /partial record\/date interval/,
  );
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.locator(".map-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.screenshot({
    path: ".impeccable/review/refined-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.locator(".map-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".impeccable/review/refined-tablet.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".map-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Export results", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Export current study" }),
  ).toBeVisible();
  await page.screenshot({
    path: ".impeccable/review/refined-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
