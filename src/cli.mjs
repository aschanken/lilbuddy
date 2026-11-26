#!/usr/bin/env node
// cli.mjs — entry point. Everything after `lil` is the question unless the
// FIRST argument is one of the few flags below, so `lil what does -l do in ls`
// needs no quoting gymnastics.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { App } from "./app.mjs";
import { PAL, setCaps } from "./ui/ansi.mjs";
import { SCENARIOS } from "./demo.mjs";

const HOME = process.env.LIL_HOME && fs.existsSync(path.join(process.env.LIL_HOME, "pi"))
  ? process.env.LIL_HOME
  : path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RUNTIME = process.env.LIL_RUNTIME
  || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "lil");

const version = () => JSON.parse(fs.readFileSync(path.join(HOME, "package.json"), "utf8")).version;

function help() {
  const k = (s) => `${PAL.AMBER}${s}${PAL.RESET}`;
  const d = (s) => `${PAL.DIM}${s}${PAL.RESET}`;
  return [
    `${PAL.GREEN}${PAL.BOLD}lil${PAL.RESET} ${d(`— Lil Buddy ${version()}, your pocket sysadmin`)}`,
    "",
    `  ${k('lil how do I find what is on port 8080')}   ${d("ask (quotes optional)")}`,
    `  ${k("lil")}                                      ${d("ask without fighting shell quoting")}`,
    `  ${k("lil --demo")} ${d("[" + Object.keys(SCENARIOS).join("|") + "]")}   ${d("watch him work, no API key needed")}`,
    `  ${k("lil --doctor")}                             ${d("check this machine is set up")}`,
    `  ${k("lil --version")}  ${k("lil --help")}`,
    "",
    `  ${d("While he works:")}   ${k("Esc")} ${d("stand down ·")} ${k("any key")} ${d("poke him")}`,
    `  ${d("Scratchpad:")}       ${k("⏎")} ${d("dismiss ·")} ${k("^R")} ${d("run ·")} ${k("^Y")} ${d("copy ·")} ${k("^E")} ${d("edit ·")} ${d("type to reply")}`,
    "",
    `  ${d("Tuning (env):")} LIL_MOTION=full|compact|off  LIL_RAMP=classic  LIL_PARA_GAP=1`,
    `                LIL_NERD_FONT=0|1  LIL_TIMEOUT_SECS=120  LIL_HEAVY_SECS=25  NO_COLOR=1`,
  ].join("\n");
}

async function main(argv) {
  // Piped or redirected: plain text, unless colour is forced.
  if (!process.stdout.isTTY && !process.env.FORCE_COLOR && !process.env.CLICOLOR_FORCE) setCaps({ color: false });
  const [first, ...rest] = argv;
  if (first === "--help" || first === "-h") { console.log(help()); return 0; }
  if (first === "--version" || first === "-V") { console.log(`lil ${version()}`); return 0; }
  if (first === "--doctor") {
    const { doctor } = await import("./doctor.mjs");
    return doctor({ home: HOME, runtime: RUNTIME });
  }
  let demo = null;
  let words = argv;
  if (first === "--demo") {
    demo = rest[0] || "port";
    if (!SCENARIOS[demo]) {
      console.log(`Demos: ${Object.entries(SCENARIOS).map(([n, s]) => `\n  ${n.padEnd(8)} ${s.about}`).join("")}`);
      return demo === "list" ? 0 : 1;
    }
    words = [SCENARIOS[demo].question];
  } else if (first === "--") {
    words = rest;
  }
  const app = new App({ home: HOME, runtime: RUNTIME, demo });
  return app.run(words.join(" ").trim());
}

// `lil … | head` closes the pipe early; that is not an error worth a stack trace.
process.stdout.on("error", (err) => { if (err.code === "EPIPE") process.exit(0); else throw err; });

main(process.argv.slice(2)).then(
  (rc) => { process.exitCode = rc; },
  (err) => {
    process.stdout.write("\x1b[?25h");
    console.error(`${PAL.AMBER} ⚠ lil tripped over its own feet: ${err?.stack || err}${PAL.RESET}`);
    process.exitCode = 70;
  },
);
