import { test, expect, type Page } from "@playwright/test";

// The investigation workflow: casebook -> disagreement atlas -> transition ->
// evidence lab -> regional brief. Live Convex layer blocked (deterministic).
async function offline(page: Page) {
  await page.route(/\.convex\.cloud\//, (r) => r.abort());
}
async function ready(page: Page) {
  await expect(page.locator(".fc-status")).toContainText("Data through 2026-11-14", { timeout: 60000 });
}

test("casebook opens the Iberia case on the transition step, where the trend reverses sign", async ({ page }) => {
  await offline(page);
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "Open this case" }).nth(1).click();
  await expect(page).toHaveURL(/r=iberia.*focus=2025-08.*tab=transition/);
  const panel = page.locator("#fc-tabpanel");
  await expect(panel).toContainText("+36% per decade", { timeout: 60000 });
  await expect(panel).toContainText("-35% per decade");
  await expect(panel).toContainText("not comparable");
  await expect(page.getByRole("tab", { name: /Why harmonization matters/ })).toHaveAttribute("aria-selected", "true");
});

test("atlas categories, linked map layer and keyboard tabs", async ({ page }) => {
  await offline(page);
  await page.goto("/?r=us&tab=atlas");
  await ready(page);
  const panel = page.locator("#fc-tabpanel");
  await expect(panel).toContainText("VIIRS only");
  await expect(panel).toContainText("add up to the cell-days detected by either sensor");
  await page.getByRole("button", { name: "VIIRS-only share" }).click();
  await expect(page).toHaveURL(/map=viirs-only/);
  await expect(page.locator(".fc-map-wrap").locator("..")).toContainText("VIIRS-only share of each");
  await page.getByRole("tab", { name: /Sensor disagreement/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /Why harmonization matters/ })).toBeFocused();
  await expect(page).toHaveURL(/tab=transition/);
});

test("evidence lab states the validation target and the small-area interval fix", async ({ page }) => {
  await offline(page);
  await page.goto("/?r=us&tab=evidence");
  await ready(page);
  const panel = page.locator("#fc-tabpanel");
  await expect(panel).toContainText("not a comparison with fires on the ground");
  await expect(panel).toContainText("Nested: method chosen inside each held-out year");
  await expect(panel).toContainText(/76\.0% → 88\.\d%|7\d\.\d% → \d\d\.\d%/);
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Held-out validation CSV" }).click();
  expect((await csv).suggestedFilename()).toBe("firelens_us_heldout_validation.csv");
});

test("regional brief for California downloads as Markdown with caveats and provenance", async ({ page }) => {
  await offline(page);
  await page.goto("/?r=us&aoi=preset:us-06&from=2003-01&to=2025-12&focus=2020-09&tab=brief");
  await ready(page);
  const panel = page.locator(".fc-brief");
  await expect(panel).toContainText("Sep 2020: 20,461", { timeout: 60000 });
  await expect(panel).toContainText("not a fire-risk forecast");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download brief (Markdown)" }).click();
  const d = await dl;
  const body = await (await d.createReadStream())!.toArray().then((c) => Buffer.concat(c).toString());
  expect(body).toContain("# FireLens regional brief: California");
  expect(body).toContain("not ground truth");
  expect(body).toMatch(/calibration sha256 [0-9a-f]{64}/);
});

test("phone width: no horizontal page scroll in any investigation step", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await offline(page);
  await page.goto("/?r=iberia");
  await ready(page);
  for (const tab of ["Fire season", "Sensor disagreement", "Why harmonization matters", "Evidence lab", "Documented fires", "Regional brief"]) {
    await page.getByRole("tab", { name: new RegExp(tab) }).click();
    await page.waitForTimeout(1500);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, tab).toBeLessThanOrEqual(1);
  }
});

test("Texas case opens on the fire-season step; documented fires and HTML brief work", async ({ page }) => {
  await offline(page);
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "Open this case" }).nth(2).click();
  await expect(page).toHaveURL(/aoi=preset:us-48.*focus=2011-04/);
  const panel = page.locator("#fc-tabpanel");
  await expect(panel).toContainText("Fire season evolution: Texas", { timeout: 60000 });
  await expect(panel).toContainText("Peak month Mar");
  await expect(panel).toContainText("No change in the seasonal centre");
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Season profiles and tests (CSV)" }).click();
  expect((await csv).suggestedFilename()).toBe("firelens_fire_season_texas.csv");
  await page.getByRole("tab", { name: /Documented fires/ }).click();
  await expect(panel).toContainText("Smokehouse Creek Fire");
  await expect(panel).toContainText("Apr 2011 in Texas: 4,432 MODIS-equivalent fire-cell-days");
  await expect(panel.getByRole("link", { name: /Texas A&M Forest Service/ })).toHaveAttribute("href", /^https:\/\/tfsweb\.tamu\.edu\//);
  await page.getByRole("tab", { name: /Regional brief/ }).click();
  await expect(page.locator(".fc-brief")).toContainText("Planning context (historical pattern, not a forecast)", { timeout: 60000 });
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download brief \(HTML/ }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/^firelens_brief_texas_.*\.html$/);
  const body = await (await d.createReadStream())!.toArray().then((c) => Buffer.concat(c).toString());
  expect(body).toContain("<h2>Fire season evolution</h2>");
  expect(body).toContain("Smokehouse Creek Fire");
});

test("California documented fires: origin points on the map and a 50 km area around one", async ({ page }) => {
  await offline(page);
  await page.goto("/?r=us&aoi=preset:us-06&focus=2020-09&tab=context");
  await ready(page);
  await expect(page.locator(".fc-hint")).toContainText("Ringed dots: published origin points of August Complex", { timeout: 60000 });
  const panel = page.locator("#fc-tabpanel");
  await expect(panel).toContainText("Sep 2020 in California: 20,461 MODIS-equivalent fire-cell-days (observed MODIS)");
  await page.getByRole("button", { name: /within 50 km of the published origin/ }).nth(1).click();
  await expect(page).toHaveURL(/aoi=circle:-119\.2612,37\.1915,50/);
});
