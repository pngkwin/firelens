#!/usr/bin/env node
// Copy FIRMS_MAP_KEY from .env.local to the Convex deployment's environment.
// The key travels only via stdin to the Convex CLI: it is never printed,
// never placed on a command line, and CLI output is redacted.
//
//   node scripts/convex/set-firms-key.mjs [--prod]
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { loadKey } from "../ingest/firms-client.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const key = loadKey(ROOT);
const args = ["convex", "env", "set", "FIRMS_MAP_KEY", ...(process.argv.includes("--prod") ? ["--prod"] : [])];
const r = spawnSync("npx", args, { cwd: ROOT, input: key, encoding: "utf8", shell: process.platform === "win32" });
const redact = (s) => String(s ?? "").split(key).join("<MAP_KEY>");
process.stdout.write(redact(r.stdout));
process.stderr.write(redact(r.stderr));
process.exit(r.status ?? 1);
