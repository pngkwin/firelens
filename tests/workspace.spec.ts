import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseCSV } from "../src/data/parse";
import { filterRecords } from "../src/data/analytics";
import { emptyFilters } from "../src/data/types";

function readSource(name: string, _encoding?: string) {
  const filename = name.replaceAll("\\", "/").split("/").at(-1)!;
  return gunzipSync(
    fs.readFileSync("public/data/demo/v1/" + filename + ".gz"),
  ).toString("utf8");
}
const m = parseCSV(
  readSource(
    "data/raw/DL_FIRE_M-C61_850214/fire_archive_M-C61_850214.csv",
    "utf8",
  ),
  "m",
).records;
const v = parseCSV(
  readSource(
    "data/raw/DL_FIRE_SV-C2_850215/fire_archive_SV-C2_850215.csv",
    "utf8",
  ),
  "v",
).records;
const all = [...m, ...v];
test("unavailable sensor dates appear as unknown rather than zero", async ({
  page,
}) => {
  await page.goto("/#workspace");
  await expect(page.getByText("2 datasets loaded")).toBeVisible({timeout:90000});
  await page.getByRole("button", { name: "Datasets", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Remove", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "No datasets loaded" }),
  ).toBeVisible();
  const subset = (path: string, month: string) => {
    // Hash-verified v1 demo copy of the original archive (data/raw is not always present).
    const [header, ...rows] = readSource(path)
      .trim()
      .split(/\r?\n/);
    return Buffer.from(
      [header, ...rows.filter((r) => r.includes(`,${month}-`))].join("\n"),
    );
  };
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  await page.getByLabel("Import FIRMS CSV files").setInputFiles([
    {
      name: "authentic-modis-january-subset.csv",
      mimeType: "text/csv",
      buffer: subset(
        "data/raw/DL_FIRE_M-C61_850214/fire_archive_M-C61_850214.csv",
        "2024-01",
      ),
    },
    {
      name: "authentic-viirs-december-subset.csv",
      mimeType: "text/csv",
      buffer: subset(
        "data/raw/DL_FIRE_SV-C2_850215/fire_archive_SV-C2_850215.csv",
        "2024-12",
      ),
    },
  ]);
  await expect(page.getByText("2 datasets loaded")).toBeVisible({timeout:90000});
  await page.getByRole("button", { name: "Close import panel" }).click();
  await page.getByRole("button", { name: "CSV workspace", exact: true }).click();
  await expect(
    page.getByText(
      "Load both instruments with overlapping record dates to compare.",
    ),
  ).toBeVisible();
  await page
    .getByText("View counts and select a period with keyboard", { exact: true })
    .click();
  const january = page
    .locator(".timeline-panel tbody tr")
    .filter({ hasText: "2024-01" });
  const december = page
    .locator(".timeline-panel tbody tr")
    .filter({ hasText: "2024-12" });
  await expect(january.locator("td").nth(0)).toHaveText("579");
  await expect(january.locator("td").nth(1)).toHaveText(
    "Unknown / outside extent",
  );
  await expect(december.locator("td").nth(0)).toHaveText(
    "Unknown / outside extent",
  );
  await expect(december.locator("td").nth(1)).toHaveText("3,315");
  await expect(page.locator(".map-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.screenshot({
    path: ".impeccable/review/availability.png",
    fullPage: true,
  });
  await page.getByLabel("Start date").fill("2023-01-01");
  await page.getByLabel("End date").fill("2023-12-31");
  await expect(page.getByText("0 records in focus")).toBeVisible();
  await expect(page.locator(".timeline-panel tbody tr").first()).toContainText(
    "2023-01",
  );
  await expect(
    page
      .locator(".timeline-panel tbody td")
      .filter({ hasText: "Unknown / outside extent" }),
  ).toHaveCount(24);
});
test("authentic archives drive linked filters, calendar, inspection, and provenance", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#workspace");
  await expect(page.getByText("2 datasets loaded")).toBeVisible({timeout:90000});
  await expect(page.getByText("54,191 records in focus")).toBeVisible();
  await expect(page.locator(".comparison-count").nth(0)).toHaveText("6,827");
  await expect(page.locator(".comparison-count").nth(1)).toHaveText("47,364");
  await page.getByLabel("Sensor filter").selectOption("MODIS");
  await expect(page.getByText("6,827 records in focus")).toBeVisible();
  const june = m.filter((r) => r.date.startsWith("2024-06")).length;
  await page
    .getByRole("button", {
      name: `Jun 2024: ${june.toLocaleString()} MODIS detections; coverage unknown`,
      exact: true,
    })
    .click();
  await expect(
    page.getByText(`${june.toLocaleString()} records in focus`),
  ).toBeVisible();
  await page.getByRole("button", { name: "Focused on 2024-06" }).click();
  await page.getByLabel("Sensor filter").selectOption("VIIRS");
  await expect(page.getByText("47,364 records in focus")).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page
    .getByRole("button", { name: "All loaded locations", exact: true })
    .click();
  for (const [k, n] of Object.entries({
    west: -101,
    south: 30,
    east: -99,
    north: 33,
  }))
    await page.getByLabel(`${k} coordinate`).fill(String(n));
  await page.getByRole("button", { name: "Apply region" }).click();
  const expected = filterRecords(all, {
    ...emptyFilters,
    bounds: { west: -101, south: 30, east: -99, north: 33 },
  }).length;
  await expect(
    page.getByText(`${expected.toLocaleString()} records in focus`),
  ).toBeVisible();
  await page.getByLabel("Start date").fill("2024-06-01");
  await page.getByLabel("End date").fill("2024-06-30");
  const narrowed = filterRecords(all, {
    ...emptyFilters,
    bounds: { west: -101, south: 30, east: -99, north: 33 },
    start: "2024-06-01",
    end: "2024-06-30",
  }).length;
  await expect(
    page.getByText(`${narrowed.toLocaleString()} records in focus`),
  ).toBeVisible();
  await page
    .getByText("Inspect observations in an accessible table", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Inspect", exact: true })
    .first()
    .click();
  await expect(page.locator(".hotspot-inspector")).toContainText("Source file");
  await expect(page.locator(".hotspot-inspector")).toContainText(
    "Confidence (source)",
  );
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page
    .getByRole("button", { name: "Close hotspot details" })
    .count()
    .then(async (n) => {
      if (n)
        await page
          .getByRole("button", { name: "Close hotspot details" })
          .click();
    });
  await page
    .getByText("Inspect observations in an accessible table", { exact: true })
    .click();
  fs.mkdirSync(".impeccable/review", { recursive: true });
  await expect(
    page.getByRole("button", { name: "Draw region", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".map-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.screenshot({
    path: ".impeccable/review/desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Datasets", exact: true }).click();
  await expect(page.locator(".dataset-entry")).toHaveCount(2);
  await expect(page.locator(".dataset-entry").first()).toContainText(
    "Terra, Aqua",
  );
  await page
    .locator(".dataset-entry")
    .first()
    .getByText("Provenance and validation details")
    .click();
  await expect(page.locator(".dataset-entry").first()).toContainText(
    "4b726464",
  );
  await page.screenshot({
    path: ".impeccable/review/datasets.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  await page
    .getByLabel("Import FIRMS CSV files")
    .setInputFiles({
      name: "fire_archive_M-C61_850214.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(readSource("fire_archive_M-C61_850214.csv")),
    });
  await expect(page.getByRole("alert")).toContainText("already loaded");
  await page.getByRole("button", { name: "Dismiss error" }).click();
  await page.getByLabel("Import FIRMS CSV files").setInputFiles({
    name: "invalid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,value\nnot,firms"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "Missing required columns",
  );
  await page.getByRole("button", { name: "Dismiss error" }).click();
  await page.getByRole("button", { name: "Close import panel" }).click();
  await page
    .getByRole("button", { name: "Methods & provenance", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reading the observation record" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "CSV workspace", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".map-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByRole("heading", { name: "Burning activity calendar" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({
    path: ".impeccable/review/mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("real map hotspot selection, region drawing, removal and successful reimport", async ({
  page,
}) => {
  await page.goto("/#workspace");
  await expect(page.getByText("2 datasets loaded")).toBeVisible({timeout:90000});
  await page.getByLabel("Sensor filter").selectOption("MODIS");
  await page
    .getByRole("button", { name: "All loaded locations", exact: true })
    .click();
  const first = m[0];
  for (const [key, value] of Object.entries({
    west: first.longitude - 0.0001,
    east: first.longitude + 0.0001,
    south: first.latitude - 0.0001,
    north: first.latitude + 0.0001,
  }))
    await page.getByLabel(`${key} coordinate`).fill(String(value));
  await page.getByRole("button", { name: "Apply region" }).click();
  await expect(page.getByText("1 records in focus")).toBeVisible();
  await page.getByRole("button", { name: "Fit extent", exact: true }).click();
  await expect(page.locator(".map-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const canvas = page.locator(".map-canvas canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Map canvas missing");
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.locator(".hotspot-inspector")).toContainText(
    "MODIS · Terra",
  );
  await expect(page.locator(".hotspot-inspector")).toContainText(
    `${first.latitude}, ${first.longitude}`,
  );
  await page.screenshot({
    path: ".impeccable/review/hotspot.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close hotspot details" }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByRole("button", { name: "Fit extent", exact: true }).click();
  await expect(page.locator(".map-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByRole("button", { name: "Draw region", exact: true }).click();
  await canvas.click({
    position: { x: box.width * 0.35, y: box.height * 0.35 },
  });
  await expect(
    page.getByText("Select the opposite corner to apply the region."),
  ).toBeVisible();
  await canvas.click({
    position: { x: box.width * 0.6, y: box.height * 0.65 },
  });
  await expect(
    page.getByRole("button", { name: "Clear region", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByRole("button", { name: "Datasets", exact: true }).click();
  await page
    .locator(".dataset-entry")
    .first()
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.locator(".dataset-entry")).toHaveCount(1);
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  await page
    .getByLabel("Import FIRMS CSV files")
    .setInputFiles({
      name: "fire_archive_M-C61_850214.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(readSource("fire_archive_M-C61_850214.csv")),
    });
  await expect(page.locator(".dataset-entry")).toHaveCount(2);
  await expect(page.getByText("2 datasets loaded")).toBeVisible({timeout:90000});
  await page.getByRole("button", { name: "Close import panel" }).click();
  await page.getByRole("button", { name: "CSV workspace", exact: true }).click();
  await expect(page.getByText("54,191 records in focus")).toBeVisible();
});
