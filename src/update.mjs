// update.mjs — keep a git checkout of Lil Buddy current.
//
// At most once a day, a `lil` run kicks off a detached child that fetches
// origin and fast-forwards the checkout. It is never waited on, so it cannot
// slow an answer down, and it only ever moves forward:
//   * the checkout must be a git clone, on the `main` branch
//   * tracked files must be unmodified (local hacks are never touched)
//   * the merge is --ff-only: no merge commits, no rebases, no resets
// Anything else is a skip, logged to $LIL_RUNTIME/update.log. The run after
// an update shows one line saying what changed. LIL_AUTO_UPDATE=0 turns the
// background check off; `lil --update` does the same thing in the foreground.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DAY = 86_400_000;
const BRANCH = "main";

function git(home, args, timeout = 30_000) {
  return execFileSync("git", ["-C", home, ...args], {
    encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },   // never sit waiting for credentials
  }).trim();
}

// → { status: "updated" | "current" | "skipped" | "failed", detail, from?, to?, subject?, count? }
export function update(home) {
  if (!fs.existsSync(path.join(home, ".git"))) {
    return { status: "skipped", detail: "not a git checkout — re-run install.sh to update" };
  }
  try {
    const branch = git(home, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch !== BRANCH) return { status: "skipped", detail: `on branch ${branch}, not ${BRANCH}` };
    if (git(home, ["status", "--porcelain", "--untracked-files=no"])) {
      return { status: "skipped", detail: "local changes in the checkout" };
    }
    const from = git(home, ["rev-parse", "--short", "HEAD"]);
    git(home, ["fetch", "--quiet", "origin", BRANCH], 60_000);
    const count = Number(git(home, ["rev-list", "--count", "HEAD..FETCH_HEAD"]));
    if (!count) return { status: "current", detail: `already up to date (${from})` };
    git(home, ["merge", "--ff-only", "--quiet", "FETCH_HEAD"]);
    const to = git(home, ["rev-parse", "--short", "HEAD"]);
    const subject = git(home, ["log", "-1", "--no-merges", "--format=%s"]);
    return { status: "updated", detail: `${from} → ${to}`, from, to, subject, count };
  } catch (err) {
    const why = String(err.stderr || err.message || err).trim().split("\n").pop();
    return { status: "failed", detail: why };
  }
}

// Called at the start of a run: cheap stat, then (rarely) a detached child.
export function maybeUpdate({ home, runtime, env = process.env, now = Date.now() }) {
  if (env.LIL_AUTO_UPDATE === "0") return false;
  if (!fs.existsSync(path.join(home, ".git"))) return false;
  const stamp = path.join(runtime, "update.checked");
  try { if (now - fs.statSync(stamp).mtimeMs < DAY) return false; } catch { /* never checked */ }
  try {
    fs.writeFileSync(stamp, "");
    const log = fs.openSync(path.join(runtime, "update.log"), "a");
    spawn(process.execPath, [fileURLToPath(import.meta.url), "--background", home, runtime], {
      detached: true, stdio: ["ignore", log, log], env,
    }).unref();
    fs.closeSync(log);
    return true;
  } catch { return false; }
}

// The one-line "you were updated" message, shown once.
export function takeNotice(runtime) {
  const file = path.join(runtime, "update.notice");
  try {
    const text = fs.readFileSync(file, "utf8").trim();
    fs.rmSync(file, { force: true });
    return text;
  } catch { return ""; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === "--background") {
  const [home, runtime] = process.argv.slice(3);
  const logFile = path.join(runtime, "update.log");
  try { if (fs.statSync(logFile).size > 10_000) fs.writeFileSync(logFile, ""); } catch { /* no log yet */ }
  const res = update(home);
  console.log(`${new Date().toISOString()} ${res.status}: ${res.detail}`);
  if (res.status === "updated") {
    const more = res.count > 1 ? ` (+${res.count - 1} more)` : "";
    fs.writeFileSync(path.join(runtime, "update.notice"), `updated ${res.detail} — ${res.subject}${more}`);
  }
}
