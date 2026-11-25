import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { osc52, userVar, osKind, clipboardTools, fingerprint } from "../src/platform.mjs";
import { validSayings, loadSayings } from "../src/sayings.mjs";
import { width, sliceCells, stripAnsi, fit, tail, setCaps, rgb, RGB } from "../src/ui/ansi.mjs";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("OSC 52 carries base64 text (tmux-wrapped when inside tmux)", () => {
  const seq = osc52("ls -la");
  assert.ok(seq.includes(`52;c;${Buffer.from("ls -la").toString("base64")}`));
  if (process.env.TMUX) assert.ok(seq.startsWith("\x1bPtmux;")); else assert.ok(seq.startsWith("\x1b]52;"));
});

test("WezTerm user-var is the same sequence the zsh wrapper emitted", () => {
  const seq = userVar(1);
  assert.ok(seq.includes("1337;SetUserVar=LIL_SCRATCHPAD=MQ=="));
});

test("platform detection and clipboard table are well-formed", () => {
  assert.ok(["mac", "linux", "wsl", "termux", "other"].includes(osKind()));
  for (const [name, read, write] of clipboardTools()) {
    assert.ok(name && Array.isArray(read) && Array.isArray(write));
  }
});

test("fingerprint is cached, and regenerated when the shell changes", async () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "lil-fp-"));
  const a = await fingerprint(runtime, "bash");
  assert.match(a, /\nshell: bash/);
  const stamp = fs.statSync(path.join(runtime, "fingerprint.txt")).mtimeMs;
  assert.equal(await fingerprint(runtime, "bash"), a);
  assert.equal(fs.statSync(path.join(runtime, "fingerprint.txt")).mtimeMs, stamp);
  assert.match(await fingerprint(runtime, "sh"), /\nshell: sh/);
});

test("sayings: seeded from the repo, validated like the zsh refresh did", () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "lil-say-"));
  const pool = loadSayings({ home: repo, runtime, env: {}, refresh: true });
  assert.ok(pool.length >= 60);
  assert.equal(fs.readFileSync(path.join(runtime, "sayings.uses"), "utf8"), "1");
  const fresh = validSayings(["short", "A perfectly fine new saying.", pool[0], "x".repeat(71), "Tabs\tget flattened here.", "Sixth is ignored, five per round."], pool);
  assert.deepEqual(fresh, ["A perfectly fine new saying.", "Tabs get flattened here."]);
});

test("width helpers: ANSI is free, CJK is double, slices respect cells", () => {
  setCaps({ color: true, truecolor: true });
  const styled = `${rgb(RGB.green)}héllo${"\x1b[0m"} 世界`;
  assert.equal(width(styled), 10);
  assert.equal(stripAnsi(sliceCells(styled, 7)), "héllo ");
  assert.equal(fit("世界ab", 3), "世");
  assert.equal(tail("abc世界", 3), "界");
  setCaps({ truecolor: false });
  assert.equal(rgb(RGB.green), "\x1b[38;5;84m");   // degrades onto the original palette
  assert.equal(rgb(RGB.amber), "\x1b[38;5;214m");
});
