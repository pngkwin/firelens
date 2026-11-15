import { test, expect } from "@playwright/test";
import fs from "node:fs";
test("historical research uses authentic partitions, shared filters and separate source counts", async ({
  page,
}) => {
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const started = Date.now();
  await page.goto("/#workspace");
  await expect(page.getByText("2 datasets loaded")).toBeVisible({
    timeout: 90000,
  });
  const ready = Date.now() - started;
  await page
    .getByRole("button", { name: "Methods & provenance", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sensor analysis", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Spatial scale sensitivity" }),
  ).toContainText("27.8%");
  await page.getByLabel("Co-occurrence interval").selectOption("day");
  await expect(
    page.getByRole("region", { name: "Spatial scale sensitivity" }),
  ).toContainText("10.1%");
  await expect(
    page.getByText("Historical anomalies: insufficient history."),
  ).toBeVisible();
  const queryBegan = Date.now();
  await page
    .getByRole("button", { name: "Query historical aggregates" })
    .click();
  const calendar = page.getByRole("region", {
    name: "Aggregate historical calendar",
  });
  await expect(calendar).toBeVisible();
  await expect(calendar).toContainText("2024 MODIS");
  await expect(calendar).toContainText("2024 VIIRS");
  const queryMs = Date.now() - queryBegan;
  const totals = await calendar
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows.map((row) =>
        Array.from(row.querySelectorAll("td")).reduce(
          (n, cell) =>
            n + Number((cell.textContent ?? "").replace(/[,*]/g, "")),
          0,
        ),
      ),
    );
  expect(totals).toEqual([6827, 47364]);
  const filteredBegan = Date.now();
  await page
    .getByLabel("Historical platform", { exact: true })
    .selectOption("Aqua");
  await expect(calendar).not.toBeVisible();
  await page
    .getByRole("button", { name: "Query historical aggregates" })
    .click();
  await expect(calendar).toBeVisible();
  const aquaTotal = await calendar
    .locator("tbody tr")
    .first()
    .locator("td")
    .evaluateAll((cells) =>
      cells.reduce(
        (n, c) => n + Number((c.textContent ?? "").replace(/[,*]/g, "")),
        0,
      ),
    );
  expect(aquaTotal).toBe(3231);
  const filteredMs = Date.now() - filteredBegan;
  await page.getByLabel("Start date").fill("2023-12-01");
  await page.getByLabel("End date").fill("2025-01-31");
  await page
    .getByRole("button", { name: "Query historical aggregates" })
    .click();
  await expect(calendar).toBeVisible();
  await expect(calendar).toContainText("2025 VIIRS");
  await expect(calendar.locator("tbody tr").first()).toContainText("—");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: ".impeccable/review/history-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".impeccable/review/history-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "CSV workspace", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Burning activity calendar",
      exact: true,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  fs.writeFileSync(
    ".impeccable/review/history-browser-benchmark.json",
    JSON.stringify(
      {
        datasetReadyMs: ready,
        fullYearAggregateQueryMs: queryMs,
        platformQueryIncludingControlMs: filteredMs,
        viewport: "1440x1000 then 390x844",
        records: 54191,
      },
      null,
      2,
    ),
  );
});
test("historical partition integrity failure is visible and does not break loaded-point workspace", async ({
  page,
}) => {
  await page.route("**/data/history/**/*.json.gz", (route) =>
    route.fulfill({ status: 200, body: "[]", contentType: "application/json" }),
  );
  await page.goto("/#workspace");
  await expect(page.getByText("2 datasets loaded")).toBeVisible({
    timeout: 90000,
  });
  await page
    .getByRole("button", { name: "Methods & provenance", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Query historical aggregates" })
    .click();
  await expect(page.getByRole("alert")).toContainText("integrity");
  await page.getByRole("button", { name: "CSV workspace", exact: true }).click();
  await expect(page.getByText("54,191 records in focus")).toBeVisible();
});
