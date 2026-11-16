#!/usr/bin/env node
// Runs the wall-clock performance tests (AOI query < 1 s, episode clustering < 3 s)
// on their own, one file at a time, so other test files do not compete for CPU.
import { spawnSync } from "node:child_process";
const r = spawnSync("npx", ["vitest", "run"], { stdio: "inherit", env: { ...process.env, FIRELENS_PERF: "1" }, shell: process.platform === "win32" });
process.exit(r.status ?? 1);
