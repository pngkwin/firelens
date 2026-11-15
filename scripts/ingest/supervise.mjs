#!/usr/bin/env node
// Crash-resilient sequential ingestion.
//
//   node scripts/ingest/supervise.mjs --regions us,iberia [--wait-pid 1234]
//
// Runs download.mjs for each region in order, restarting it (it resumes from
// its file checkpoints) until it exits 0 with zero failed windows. The next
// region starts only after the previous one finished cleanly. --wait-pid lets
// it adopt an already-running download first. Logs counts only.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, renameSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
const ROOT = resolve(import.meta.dirname, "../..");
const regions = String(args.regions ?? "us").split(",");
const LOG = join(ROOT, "data/raw/firms-api/supervisor.log");
mkdirSync(join(ROOT, "data/raw/firms-api"), { recursive: true });
const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); appendFileSync(LOG, l + "\n"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Keep the machine awake for the whole supervised run, including back-off waits.
if (process.platform === "win32") {
  const ps = `$s=Add-Type -Name P -Namespace W -PassThru -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'; while($true){ [void]$s::SetThreadExecutionState([uint32]"0x80000001"); Start-Sleep -Seconds 30 }`;
  const awake = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore" });
  process.on("exit", () => { try { awake.kill(); } catch {} });
}

if (args["wait-pid"]) {
  const pid = Number(args["wait-pid"]);
  log(`waiting for existing download pid ${pid}`);
  while (alive(pid)) await sleep(30_000);
  log(`pid ${pid} exited`);
}

for (const region of regions) {
  for (let attempt = 1; attempt <= 50; attempt++) {
    const failures = join(ROOT, "data/raw/firms-api", region, "failures.jsonl");
    // Failed windows are retried by the next run (their files do not exist);
    // archive the old failure list so this run's list is fresh.
    if (existsSync(failures)) renameSync(failures, failures.replace(".jsonl", `.${Date.now()}.jsonl`));
    log(`${region}: starting download attempt ${attempt}`);
    const code = await new Promise((res) => {
      const extra = args.budget ? ["--budget", String(args.budget)] : [];
      const p = spawn(process.execPath, ["scripts/ingest/download.mjs", "--region", region, ...extra], { cwd: ROOT, stdio: "ignore" });
      p.on("exit", (c) => res(c ?? 1));
    });
    const failed = existsSync(failures) ? readFileSync(failures, "utf8").trim().split("\n").filter(Boolean).length : 0;
    log(`${region}: attempt ${attempt} exited code=${code} failedWindows=${failed}`);
    if (code === 0 && failed === 0) break;
    if (attempt === 50) { log(`${region}: giving up after 50 attempts`); process.exit(1); }
    await sleep(Math.min(30 * 60_000, 60_000 * attempt));
  }
  log(`${region}: complete`);
}
log("all regions complete");
