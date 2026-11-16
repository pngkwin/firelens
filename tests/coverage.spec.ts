import { test, expect, type Page } from "@playwright/test";

// Observation coverage in the real UI (method v3): satellite outages are not
// read as low fire, pre-launch periods have no value, and raw-scale trends are
// not driven by satellites being added. The live Convex layer is blocked.
async function offline(page: Page) {
  await page.route(/\.convex\.cloud\//, (r) => r.abort());
}
async function ready(page: Page) {
  await expect(page.locator(".fc-status")).toContainText("Data through 2026-11-14", { timeout: 60000 });
}

test("July 2024 (S-NPP outage) is estimated from NOAA-20 and is not a false low anomaly", async ({ page }) => {
  await offline(page);
  await page.goto("/?r=us&focus=2024-07");
  await ready(page);
  const focus = page.locator(".fc-focus");
  await expect(focus).toContainText("VIIRS reference: NOAA-20");
  await expect(focus).toContainText("Above the historical median");
  await expect(focus).not.toContainText("Below the historical median");
});

test("a month with a Terra outage is marked reduced coverage and not compared", async ({ page }) => {
  await offline(page);
  await page.goto("/?r=us&focus=2001-06");
  await ready(page);
  const focus = page.locator(".fc-focus");
  await expect(focus).toContainText("Reduced satellite coverage");
  await expect(focus).toContainText("Not compared: reduced satellite coverage");
  await expect(focus).not.toContainText("Percentile");
  await expect(page.locator('[data-month="2001-06"]')).toHaveClass(/reduced/);
  await expect(page.locator('[data-month="2001-06"]')).toHaveAttribute("aria-label", /reduced satellite coverage: Terra not observing/);
});

test("raw VIIRS has no value before S-NPP and no trend across satellite configurations", async ({ page }) => {
  await offline(page);
  await page.goto("/?r=us&scale=raw-viirs&focus=2005-07");
  await ready(page);
  await expect(page.locator(".fc-focus")).toContainText("Not observed");
  await expect(page.locator('[data-month="2005-07"]')).toHaveClass(/\bna\b/);
  await expect(page.locator('[data-month="2005-07"]')).toHaveAttribute("aria-label", /not observed/);
  const trend = page.locator("section", { has: page.getByRole("heading", { name: "Annual totals and trend" }) });
  await expect(trend).not.toContainText("per decade");
  await expect(trend).toContainText("not comparable");
});
