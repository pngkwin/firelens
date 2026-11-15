#!/usr/bin/env node
// Resumable FIRMS area-API downloader.
//
//   node scripts/ingest/download.mjs --region us [--sources MODIS_SP,VIIRS_SNPP_SP]
//        [--end YYYY-MM-DD] [--budget 3000] [--concurrency 4] [--dry-run]
//
// - One gzip CSV per (source, box, <=5-day window) under data/raw/firms-api/.
//   A window is complete iff its file exists (atomic tmp -> rename), so a crash
//   or Ctrl-C loses at most the in-flight windows; rerunning resumes.
// - Transaction budget: dispatch only while the server-reported transaction
//   count plus the estimated cost of in-flight calls stays below --budget, and
//   a client-side 10-minute ledger agrees. FIRMS weights large calls (a 5-day
//   CONUS VIIRS call costs ~10 transactions), so cost is learned per source.
// - Logs counts only. The MAP_KEY never reaches stdout or log files.
// - Keeps Windows awake (SetThreadExecutionState) while running.
import { mkdirSync, existsSync, writeFileSync, renameSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { loadKey, makeClient } from "./firms-client.mjs";
import { planJobs, addDays } from "./plan.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => {
    if (!a.startsWith("--")) return [];
    const [k, v] = a.slice(2).split("=");
    return [k, v ?? (all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true)];
  }).filter((x) => x.length),
);
const ROOT = resolve(import.meta.dirname, "../..");
const config = JSON.parse(readFileSync(join(ROOT, "config/regions.json"), "utf8"));
const region = config.regions.find((r) => r.id === (args.region ?? "us"));
if (!region) throw Error(`Unknown region ${args.region}`);
const BUDGET = Number(args.budget ?? 3000);
const CONCURRENCY = Number(args.concurrency ?? 8);
const WINDOW_MS = 10 * 60_000;
const OUT = join(ROOT, "data/raw/firms-api", region.id);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const END = args.end ?? yesterday;
const wanted = args.sources ? new Set(String(args.sources).split(",")) : null;
const sources = config.sources.filter((s) => !wanted || wanted.has(s.id));

mkdirSync(OUT, { recursive: true });
const logFile = join(OUT, "progress.log");
const log = (msg) => {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  appendFileSync(logFile, line + "\n");
};

const client = makeClient(loadKey(ROOT));
const fileFor = (j) => join(OUT, j.source, j.box, j.date.slice(0, 4), `${j.date}_${j.days}.csv.gz`);

function validate(job, text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0] ?? "";
  if (!header.startsWith("latitude,longitude"))
    return { ok: false, reason: `unexpected body: ${header.slice(0, 80)}` };
  const dateIdx = header.split(",").indexOf("acq_date");
  const last = addDays(job.date, job.days - 1);
  let outside = 0;
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i].split(",")[dateIdx];
    if (d < job.date || d > last) outside++;
  }
  if (outside) return { ok: false, reason: `${outside} rows outside window` };
  return { ok: true, rows: lines.length - 1 };
}

// ---- keep the machine awake ------------------------------------------------
let awake;
if (process.platform === "win32" && !args["dry-run"]) {
  const ps = `$s=Add-Type -Name P -Namespace W -PassThru -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'; while($true){ [void]$s::SetThreadExecutionState([uint32]"0x80000001"); Start-Sleep -Seconds 30 }`;
  awake = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore" });
  const stop = () => { try { awake.kill(); } catch {} };
  process.on("exit", stop);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stop(); process.exit(130); });
}

// ---- plan ------------------------------------------------------------------
// The plan is frozen per output directory: availability + end date are saved
// on the first run and reused on resume, so a resumed run (or the aggregator)
// sees exactly the same windows even though FIRMS availability changes daily.
// Pass --replan to extend an existing plan (e.g. for new NRT days).
const availFile = join(OUT, "availability.json"), endFile = join(OUT, "plan-end.json");
let availability, planEnd = END;
if (existsSync(availFile) && !args.replan) {
  availability = JSON.parse(readFileSync(availFile, "utf8"));
  planEnd = JSON.parse(readFileSync(endFile, "utf8")).end;
} else {
  availability = await client.availability();
  if (!args["dry-run"]) {
    writeFileSync(availFile, JSON.stringify(availability, null, 1));
    writeFileSync(endFile, JSON.stringify({ end: END }));
  }
}
const jobs = planJobs({ sources, availability, region, end: planEnd });
const pending = jobs.filter((j) => !existsSync(fileFor(j)));
log(`region=${region.id} end=${planEnd} jobs=${jobs.length} done=${jobs.length - pending.length} pending=${pending.length} budget=${BUDGET}/10min concurrency=${CONCURRENCY}`);
for (const s of sources) {
  const a = availability[s.id];
  log(`  ${s.id}: available ${a?.min ?? "-"}..${a?.max ?? "-"}, jobs ${jobs.filter((j) => j.source === s.id).length}`);
}
if (args["dry-run"]) process.exit(0);

// ---- budgeted dispatch -----------------------------------------------------
const ledger = []; // {t, cost}
// Measured 2026-11-15: FIRMS charges 2 transactions per day of window,
// independent of box area (5-day CONUS = 10; 16 tiles of the same window = 160).
const costEst = {}; // source -> observed transactions per call (reported only)
const est = (j) => 2 * j.days;
let serverTx = 0, serverAt = 0, inflight = new Map();
async function refreshServer() {
  try {
    serverTx = (await client.status()).current_transactions;
    serverAt = Date.now();
  } catch (e) { log(`status error: ${client.redact(e.message)}`); }
}
const ledgerSum = () => {
  const cutoff = Date.now() - WINDOW_MS;
  while (ledger.length && ledger[0].t < cutoff) ledger.shift();
  return ledger.reduce((s, x) => s + x.cost, 0);
};
const inflightCost = () => [...inflight.values()].reduce((s, c) => s + c, 0);
const canDispatch = (j) =>
  serverTx + inflightCost() + est(j) <= BUDGET && ledgerSum() + est(j) <= BUDGET;

let done = 0, failed = 0, rows = 0, bytes = 0;
const failures = join(OUT, "failures.jsonl");
const ledgerFile = join(OUT, "ledger.jsonl");

async function runJob(j) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const t0 = Date.now();
    let r;
    try {
      r = await client.area(j.source, j.bbox, j.days, j.date);
    } catch (e) {
      r = { status: 0, text: client.redact(e.message) };
    }
    const v = r.status === 200 ? validate(j, r.text) : { ok: false, reason: `HTTP ${r.status} ${r.text.slice(0, 80)}` };
    if (v.ok) {
      const file = fileFor(j);
      mkdirSync(dirname(file), { recursive: true });
      const gz = gzipSync(r.text);
      writeFileSync(file + ".tmp", gz);
      renameSync(file + ".tmp", file);
      appendFileSync(ledgerFile, JSON.stringify({ id: j.id, rows: v.rows, bytes: r.text.length, sha256: createHash("sha256").update(r.text).digest("hex"), ms: Date.now() - t0, at: new Date().toISOString() }) + "\n");
      rows += v.rows; bytes += r.text.length;
      return true;
    }
    const wait = Math.min(600_000, 15_000 * 2 ** (attempt - 1));
    log(`retry ${attempt}/6 ${j.id}: ${client.redact(v.reason)}; waiting ${wait / 1000}s`);
    if (/exceed|limit/i.test(v.reason)) await refreshServer();
    await new Promise((res) => setTimeout(res, wait));
  }
  appendFileSync(failures, JSON.stringify({ id: j.id, at: new Date().toISOString() }) + "\n");
  return false;
}

await refreshServer();
const started = Date.now();
let lastReport = 0;
// Newest windows first: the multi-sensor overlap years (needed for
// calibration) complete early even if a long run is interrupted.
const queue = [...pending].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)));
await new Promise((finish) => {
  const tick = async () => {
    if (Date.now() - serverAt > 20_000) await refreshServer();
    while (inflight.size < CONCURRENCY && queue.length && canDispatch(queue[0])) {
      const j = queue.shift();
      const cost = est(j);
      inflight.set(j.id, cost);
      ledger.push({ t: Date.now(), cost });
      const before = serverTx;
      runJob(j).then(async (ok) => {
        inflight.delete(j.id);
        ok ? done++ : failed++;
        // Learn per-source cost from server deltas when this call ran alone.
        if (inflight.size === 0) {
          await refreshServer();
          const delta = serverTx - before;
          if (delta > 0 && delta < 200) costEst[j.source] = delta;
        }
      });
    }
    if (Date.now() - lastReport > 60_000) {
      lastReport = Date.now();
      const mins = (Date.now() - started) / 60_000;
      const rate = done / Math.max(mins, 0.01);
      const eta = rate ? Math.round((queue.length + inflight.size) / rate) : "?";
      log(`progress done=${done}/${pending.length} failed=${failed} rows=${rows} MB=${(bytes / 1e6).toFixed(1)} serverTx=${serverTx}/${BUDGET} inflight=${inflight.size} rate=${rate.toFixed(1)}/min eta=${eta}min cost=${JSON.stringify(costEst)}`);
    }
    if (!queue.length && !inflight.size) return finish();
    setTimeout(tick, 1000);
  };
  tick();
});
log(`finished done=${done} failed=${failed} rows=${rows} MB=${(bytes / 1e6).toFixed(1)} minutes=${((Date.now() - started) / 60_000).toFixed(1)}`);
process.exit(failed ? 2 : 0);
