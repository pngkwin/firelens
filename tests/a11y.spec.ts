import { test, expect, type Page } from "@playwright/test";

// Regression tests for the accessibility, UI and header findings in
// docs/review-findings.md. Deterministic: the live Convex layer is blocked.
async function offline(page: Page) {
  await page.route(/\.convex\.cloud\//, (r) => r.abort());
}
async function ready(page: Page) {
  await expect(page.locator(".fc-status")).toContainText("Data through 2026-11-14", { timeout: 60000 });
}

test("A11Y-1/8: the month grid keeps one tab stop when To is before the focus month", async ({ page }) => {
  await offline(page);
  await page.goto("/?r=us&to=2020-12");
  await ready(page);
  await expect(page.locator('.fc-heat button[tabindex="0"]')).toHaveCount(1);
  // The focus month is clamped into the range, and its button carries the selected state.
  await expect(page.getByRole("heading", { name: "Dec 2020 vs other years" })).toBeVisible();
  await expect(page.locator('[data-month="2020-12"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".fc-heat")).not.toHaveAttribute("role", "grid");
  // Tab from the To select reaches the calendar.
  await page.getByRole("group", { name: "Calendar settings" }).getByLabel("To", { exact: true }).focus();
  let inGrid = false;
  for (let i = 0; i < 80 && !inGrid; i++) {
    await page.keyboard.press("Tab");
    inGrid = await page.evaluate(() => !!document.activeElement?.closest(".fc-heat"));
  }
  expect(inGrid).toBe(true);
});

test("A11Y-7: each month button's accessible name starts with its visible text", async ({ page }) => {
  await offline(page);
  await page.goto("/");
  await ready(page);
  const pairs = await page.locator(".fc-heat button[data-month]").evaluateAll((els) => els.slice(-40).map((b) => [b.textContent?.trim() ?? "", b.getAttribute("aria-label") ?? ""]));
  for (const [text, name] of pairs) if (text) expect(name.startsWith(`${text}, `)).toBe(true);
});

test("A11Y-6: the skip link keeps the current view and focuses main", async ({ page }) => {
  await offline(page);
  await page.goto("/#workspace");
  await expect(page.getByRole("heading", { level: 1, name: "Research workspace" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Research workspace" })).toBeVisible();
  await expect(page.locator("main#main")).toBeFocused();
  expect(new URL(page.url()).hash).toBe("#workspace");
});

test("A11Y-4/12: polygon vertices form, and invalid input is linked to its error", async ({ page }) => {
  await offline(page);
  await page.goto("/");
  await ready(page);
  // Invalid box: the inputs are marked invalid and described by the alert.
  await page.getByText("Bounding box", { exact: true }).click();
  await page.getByLabel("West", { exact: true }).fill("-110");
  await page.getByLabel("South", { exact: true }).fill("32");
  await page.getByLabel("East", { exact: true }).fill("-120");
  await page.getByLabel("North", { exact: true }).fill("42");
  await page.getByRole("button", { name: "Apply box" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("west < east");
  const west = page.getByLabel("West", { exact: true });
  await expect(west).toHaveAttribute("aria-invalid", "true");
  await expect(west).toHaveAttribute("aria-describedby", (await alert.getAttribute("id"))!);
  await expect(page.getByLabel(/Radius \(km, ≤ 2,000\)/)).not.toHaveAttribute("max", /.*/);
  // Polygon by keyboard.
  await page.getByText("Polygon vertices", { exact: true }).click();
  await page.getByLabel(/Vertices: one/).fill("-122.5, 38.5\n-121.0, 38.5\n-121.0, 39.5\n-122.5, 39.5");
  await page.getByRole("button", { name: "Apply polygon" }).click();
  await expect(page).toHaveURL(/aoi=poly:-122\.5,38\.5;-121,38\.5;-121,39\.5;-122\.5,39\.5/);
  await expect(page.locator(".fc-current")).toContainText("Drawn polygon (4 vertices)");
  await expect(west).not.toHaveAttribute("aria-invalid", /.*/);
  // A11Y-12: the draw tools are a plain group and the map wrapper has no application role.
  await expect(page.getByRole("group", { name: "Draw an area on the map" })).toBeVisible();
  await expect(page.locator('[role="toolbar"], .fc-map[role="application"]')).toHaveCount(0);
});

test("A11Y-5: day-of-year values are reachable by keyboard", async ({ page }) => {
  await offline(page);
  await page.goto("/?r=us&aoi=preset:us-06");
  await ready(page);
  const canvas = page.locator("canvas.fc-doy");
  await expect(canvas).toBeVisible({ timeout: 90000 });
  await canvas.focus();
  await page.keyboard.press("ArrowRight"); // first key places the cursor on the last day (2026-11-14)
  await page.keyboard.press("ArrowLeft");
  const hover = page.locator(".fc-hover");
  await expect(hover).toHaveText(/^2026-11-13: /);
  await expect(hover).toHaveAttribute("aria-live", "polite");
  await page.keyboard.press("ArrowUp");
  await expect(hover).toHaveText(/^2025-11-13: /);
});

test("A11Y-9/10: no nested or whole-panel live regions; trend chart has a text table", async ({ page }) => {
  await offline(page);
  await page.goto("/");
  await ready(page);
  await expect(page.locator('[aria-live]:not([aria-live="off"]) [aria-live]:not([aria-live="off"]), [aria-live]:not([aria-live="off"]) [role="status"], [role="status"] [role="status"]')).toHaveCount(0);
  await expect(page.locator("section[aria-live]")).toHaveCount(0);
  // Timing text is outside the announced status.
  await expect(page.locator('.fc-status [role="status"]')).not.toContainText("query");
  const trend = page.locator("section", { has: page.getByRole("heading", { name: "Annual totals and trend" }) });
  await expect(trend.locator("table caption", { hasText: "Annual totals" })).toHaveCount(1);
  await expect(trend.locator("table tbody tr").last()).toContainText("partial year");
});

test("BUG-2: copy link reports failure when the clipboard is unavailable", async ({ page }) => {
  await offline(page);
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "Copy share link" }).click();
  await expect(page.locator(".fc-status")).toContainText("Copy failed");
  await expect(page.getByRole("button", { name: "Link copied" })).toHaveCount(0);
});

test("SEC-4: security headers are served and the calendar runs without CSP violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  await offline(page);
  const res = await page.goto("/");
  const h = res!.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  await ready(page);
  await expect(page.locator(".fc-map canvas")).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(3000); // let basemap tiles, workers and fonts load
  expect(violations).toEqual([]);
});
