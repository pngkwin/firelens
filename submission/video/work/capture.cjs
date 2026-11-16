// Captures real FireLens screens for the 30 s video.
// Usage: node capture.cjs <outDir> [baseUrl]
// Writes <name>.png (3840x2160, deviceScaleFactor 2) and shots.json with
// click-target and highlight boxes in 1920x1080 CSS pixels.
const path = require("path");
const fs = require("fs");
const req = require("module").createRequire("C:/Users/athar/firelens-handoff/FireLens/package.json");
const { chromium } = req("@playwright/test");

const out = process.argv[2];
const base = process.argv[3] || "http://127.0.0.1:5173/";
fs.mkdirSync(out, { recursive: true });
const meta = {};

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  const box = async (loc) => {
    if (!(await loc.count())) return null;
    const b = await loc.first().boundingBox({ timeout: 5000 }).catch(() => null);
    return b && { x: b.x, y: b.y, w: b.width, h: b.height };
  };
  const shot = async (name, extra = {}) => {
    await page.mouse.move(2, 1078); // park the pointer so no chart tooltip is open
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, name + ".png") });
    meta[name] = extra;
    console.log("shot", name);
  };
  // Scroll so an element's top sits at `top` px from the viewport top.
  const scrollTo = async (loc, top = 90) => {
    await loc.first().evaluate((el, t) => { window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - t); }, top);
    await page.waitForTimeout(500);
  };

  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator(".fc-status").filter({ hasText: "Data through" }).waitFor({ timeout: 90000 });
  await page.waitForTimeout(2500); // map tiles
  await shot("01-calendar", { heading: await box(page.locator(".workspace-heading h1")), focus: await box(page.locator(".fc-main .fc-panel")) });

  const heat = page.locator(".fc-panel", { hasText: "Burning-activity calendar" });
  await scrollTo(heat, 70);
  await shot("02-heatmap", { panel: await box(heat) });

  // Step 3: naive splice vs harmonized.
  const tabs = page.locator(".fc-tabs");
  await scrollTo(tabs, 60);
  const t3 = page.getByRole("tab", { name: "3 · Why harmonization matters" });
  await shot("03a-tabs", { target: await box(t3) });
  await t3.click();
  await page.locator("#fc-tabpanel").filter({ hasText: "per decade" }).waitFor();
  await scrollTo(tabs, 60);
  const cards = page.locator("#fc-tabpanel .fc-stat");
  await shot("03b-transition", { naive: await box(cards.nth(0)), harmonized: await box(cards.nth(1)) });

  // Texas case: the third case card.
  const cases = page.locator(".fc-case-grid");
  await scrollTo(cases, 120);
  const open = page.getByRole("button", { name: "Open this case" }).nth(2);
  await shot("04a-cases", { target: await box(open), card: await box(page.locator(".fc-case").nth(2)) });
  await open.click();
  const panel = page.locator("#fc-tabpanel");
  await panel.filter({ hasText: "Fire season evolution: Texas" }).waitFor({ timeout: 90000 });
  await page.waitForTimeout(1500);
  await scrollTo(panel, 60);
  await shot("04b-texas", { finding: await box(panel.locator("li", { hasText: "Peak month Mar" })), chart: await box(panel.locator(".recharts-wrapper")) });

  // Evidence lab.
  await scrollTo(tabs, 60);
  const t4 = page.getByRole("tab", { name: "4 · Evidence lab" });
  await shot("05a-tabs", { target: await box(t4) });
  await t4.click();
  await page.waitForTimeout(1500);
  await scrollTo(tabs, 60);
  await shot("05b-evidence", { stats: await box(panel.locator(".fc-stat").first()) });

  // Documented fires: Smokehouse Creek.
  const t5 = page.getByRole("tab", { name: "5 · Documented fires" });
  await shot("06a-tabs", { target: await box(t5) });
  await t5.click();
  const smoke = panel.locator(".fc-incident", { hasText: "Smokehouse Creek" });
  await smoke.waitFor({ timeout: 60000 });
  await scrollTo(smoke, 200);
  await shot("06b-fires", { card: await box(smoke) });

  // Regional brief + HTML download.
  await scrollTo(tabs, 60);
  const t6 = page.getByRole("tab", { name: "6 · Regional brief" });
  await t6.click();
  await page.locator(".fc-brief").filter({ hasText: "Planning context" }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1000);
  await scrollTo(tabs, 60);
  await shot("07-brief", { target: await box(page.getByRole("button", { name: /Download brief \(HTML/ })), title: await box(page.locator("#fc-brief-title")) });

  fs.writeFileSync(path.join(out, "shots.json"), JSON.stringify(meta, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
