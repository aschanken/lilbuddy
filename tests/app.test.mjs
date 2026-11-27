// app.test.mjs — whole invocations of the CLI with a fake pi, no terminal.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { setCaps } from "../src/ui/ansi.mjs";
import { header } from "../src/ui/panel.mjs";
import { render, scratchpadBox } from "../src/render.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(here);
const cli = path.join(repo, "src", "cli.mjs");

function lil(args, env = {}) {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "lil-app-"));
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    input: "",
    env: {
      PATH: process.env.PATH, HOME: runtime, LIL_RUNTIME: runtime, COLUMNS: "80", LIL_NERD_FONT: "1",
      LIL_PI_BIN: path.join(here, "fake-pi.mjs"), DEEPSEEK_API_KEY: "test", LIL_AUTO_UPDATE: "0", ...env,
    },
  });
  return { ...r, runtime };
}

test("piped: prints header, the answer and the command box — plain text, no motion", () => {
  const r = lil(["where", "to"]);
  assert.equal(r.status, 0, r.stderr);
  setCaps({ color: false });
  const expected = [
    header(true),
    render("Hop over to `/tmp` and leave a **marker** behind.", 80),
    ...scratchpadBox("cd /tmp && LIL_MARK=vault111", 80),
  ].join("\n") + "\n";
  assert.equal(r.stdout, expected);
  assert.ok(!r.stdout.includes("\x1b"));
});

test("a fresh session file per invocation; snapshots and fingerprint are written", () => {
  const r = lil(["where", "to"]);
  const fp = fs.readFileSync(path.join(r.runtime, "fingerprint.txt"), "utf8");
  assert.match(fp, /^## ENVIRONMENT FINGERPRINT/);
  for (const key of ["os:", "arch:", "kernel:", "shell:", "userland:", "pkgmgr:", "clipboard:", "node:"]) {
    assert.ok(fp.includes(`\n${key}`), key);
  }
});

test("missing API key is caught before pi is spawned", () => {
  const r = lil(["hello"], { DEEPSEEK_API_KEY: "" });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /\$DEEPSEEK_API_KEY isn't set/);
});

test("pi failure: exit code 2 and the reason is shown", () => {
  const r = lil(["hello"], { FAKE_PI_EXIT: "1", FAKE_PI_STDERR: "Error: 401 Authentication Fails" });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /pi exited \(1\)/);
  assert.match(r.stdout, /401 Authentication Fails/);
});

test("no prompt and no terminal: the original nudge", () => {
  const r = lil([]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /lil needs a prompt, boss/);
});

test("--demo needs neither pi nor a key; --version and --help work", () => {
  const demo = lil(["--demo", "concept"], { LIL_PI_BIN: "", DEEPSEEK_API_KEY: "", LIL_DEMO_SPEED: "200" });
  assert.equal(demo.status, 0, demo.stderr);
  assert.match(demo.stdout, /TWO NAMES, ONE FILE/);
  assert.match(lil(["--version"]).stdout, /^lil \d+\.\d+\.\d+/);
  assert.match(lil(["--help"]).stdout, /lil --doctor/);
});

test("a question that starts with a dash is still a question", () => {
  const out = path.join(os.tmpdir(), `lil-args-${process.pid}.json`);
  lil(["-l", "flag", "of", "ls?"], { FAKE_PI_ARGS_OUT: out });
  const argv = JSON.parse(fs.readFileSync(out, "utf8")).argv;
  assert.equal(argv.at(-1), " -l flag of ls?");
  assert.ok(!argv.includes("--"));
});
