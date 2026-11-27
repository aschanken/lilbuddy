// update.test.mjs — self-update against real throwaway git repos.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { update, maybeUpdate, takeNotice } from "../src/update.mjs";

const sh = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim();

// An "upstream" repo and a clone of it standing in for the user's checkout.
function pair() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lil-up-"));
  const origin = path.join(root, "origin");
  const home = path.join(root, "home");
  fs.mkdirSync(origin);
  sh(origin, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(origin, "a.txt"), "one\n");
  sh(origin, "add", "-A"); sh(origin, "commit", "-q", "-m", "feat: first");
  execFileSync("git", ["clone", "-q", "--depth", "1", `file://${origin}`, home]);
  return { origin, home, root };
}
function publish(origin, subject) {
  fs.appendFileSync(path.join(origin, "a.txt"), `${subject}\n`);
  sh(origin, "commit", "-q", "-am", subject);
}

test("fast-forwards a clean checkout on main, then reports it is current", () => {
  const { origin, home } = pair();
  assert.equal(update(home).status, "current");
  publish(origin, "fix: second");
  publish(origin, "feat: third");
  const res = update(home);
  assert.equal(res.status, "updated");
  assert.equal(res.count, 2);
  assert.equal(res.subject, "feat: third");
  assert.equal(sh(home, "rev-parse", "HEAD"), sh(origin, "rev-parse", "HEAD"));
  assert.equal(update(home).status, "current");
});

test("never touches local work: edits, other branches and diverged history are skipped", () => {
  const { origin, home } = pair();
  publish(origin, "fix: upstream change");
  const before = sh(home, "rev-parse", "HEAD");

  fs.writeFileSync(path.join(home, "a.txt"), "my hack\n");
  assert.deepEqual(update(home), { status: "skipped", detail: "local changes in the checkout" });
  assert.equal(fs.readFileSync(path.join(home, "a.txt"), "utf8"), "my hack\n");
  sh(home, "checkout", "-q", "--", "a.txt");

  fs.writeFileSync(path.join(home, "untracked.txt"), "scratch");     // untracked files don't block
  sh(home, "checkout", "-q", "-b", "wip");
  assert.match(update(home).detail, /on branch wip/);
  sh(home, "checkout", "-q", "main");
  assert.equal(sh(home, "rev-parse", "HEAD"), before);

  fs.writeFileSync(path.join(home, "b.txt"), "local commit\n");
  sh(home, "add", "b.txt"); sh(home, "commit", "-q", "-m", "local");
  const diverged = update(home);
  assert.equal(diverged.status, "failed");                            // ff-only refuses; nothing is rewritten
  assert.equal(sh(home, "log", "-1", "--format=%s"), "local");
});

test("a non-git install is skipped with a pointer to the installer", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lil-up-"));
  assert.match(update(dir).detail, /install\.sh/);
});

test("background check: once a day, off with LIL_AUTO_UPDATE=0, leaves a one-shot notice", async () => {
  const { origin, home, root } = pair();
  const runtime = path.join(root, "rt");
  fs.mkdirSync(runtime);
  assert.equal(maybeUpdate({ home, runtime, env: { ...process.env, LIL_AUTO_UPDATE: "0" } }), false);
  publish(origin, "feat: shiny");
  assert.equal(maybeUpdate({ home, runtime }), true);
  assert.equal(maybeUpdate({ home, runtime }), false, "second call the same day does nothing");
  assert.equal(maybeUpdate({ home, runtime, now: Date.now() + 2 * 86_400_000 }), true);
  for (let i = 0; i < 100 && !fs.existsSync(path.join(runtime, "update.notice")); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(takeNotice(runtime), /^updated \w+ → \w+ — feat: shiny$/);
  assert.equal(takeNotice(runtime), "");
  assert.match(fs.readFileSync(path.join(runtime, "update.log"), "utf8"), /updated:/);
});
