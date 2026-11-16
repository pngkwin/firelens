// Renders composition.html frame by frame.
// Usage: node render.cjs stills <outDir> <t1,t2,...>   (check stills)
//        node render.cjs frames <outDir>                (900 frames, 30 fps)
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const req = require("module").createRequire("C:/Users/athar/firelens-handoff/FireLens/package.json");
const { chromium } = req("@playwright/test");

const [mode, out, times] = process.argv.slice(2);
const work = __dirname;
fs.mkdirSync(out, { recursive: true });
const meta = JSON.parse(fs.readFileSync(path.join(work, "shots.json"), "utf8"));

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.addInitScript((m) => { window.META = m; }, meta);
  await page.goto(pathToFileURL(path.join(work, "composition.html")).href);
  await page.evaluate(() => window.ready());
  const ts = mode === "stills" ? times.split(",").map(Number) : Array.from({ length: 900 }, (_, i) => i / 30);
  for (const [i, t] of ts.entries()) {
    await page.evaluate((x) => window.render(x), t);
    const name = mode === "stills" ? `still-${t.toFixed(2)}.png` : `f${String(i).padStart(4, "0")}.png`;
    await page.screenshot({ path: path.join(out, name) });
    if (mode === "frames" && i % 150 === 0) console.log("frame", i);
  }
  await browser.close();
  console.log("done", ts.length);
})().catch((e) => { console.error(e); process.exit(1); });
