#!/usr/bin/env node
// fake-pi.mjs — stands in for the `pi` binary in tests (LIL_PI_BIN).
// Replays a JSONL fixture on stdout the way `pi --mode json` would.
//   FAKE_PI_SCRIPT   path to the JSONL fixture (default: fixtures/pi-run.jsonl)
//   FAKE_PI_DELAY    ms between records (default 0)
//   FAKE_PI_ARGS_OUT write the argv + relevant env here as JSON
//   FAKE_PI_EXIT     exit code (default 0)
//   FAKE_PI_STDERR   text to print on stderr
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = process.env.FAKE_PI_SCRIPT || path.join(here, "fixtures", "pi-run.jsonl");
const delay = Number(process.env.FAKE_PI_DELAY) || 0;

if (process.env.FAKE_PI_ARGS_OUT) {
  fs.writeFileSync(process.env.FAKE_PI_ARGS_OUT, JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    LIL_RUNTIME: process.env.LIL_RUNTIME,
    stdinIsTTY: Boolean(process.stdin.isTTY),
  }));
}
if (process.env.FAKE_PI_STDERR) process.stderr.write(process.env.FAKE_PI_STDERR + "\n");

const lines = fs.readFileSync(script, "utf8").split("\n").filter(Boolean);
for (const line of lines) {
  process.stdout.write(line + "\n");
  if (delay) await new Promise((r) => setTimeout(r, delay));
}
process.exitCode = Number(process.env.FAKE_PI_EXIT) || 0;
