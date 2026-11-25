// doctor.mjs — `lil --doctor`: is this machine ready, and if not, what's the
// one command that fixes it.

import fs from "node:fs";
import path from "node:path";

import { PAL, caps, fit } from "./ui/ansi.mjs";
import { header } from "./ui/panel.mjs";
import { drawBuddy } from "./ui/sprite.mjs";
import { findPi, run, osKind, clipboardTools, terminalName, hasNerdFont } from "./platform.mjs";

export async function doctor({ home, runtime, env = process.env, out = process.stdout }) {
  const checks = [];
  const add = (ok, label, detail = "", fix = "") => checks.push({ ok, label, detail, fix });
  const kind = osKind();
  const term = terminalName();

  const major = Number(process.versions.node.split(".")[0]);
  add(major >= 20, "node", `v${process.versions.node}`, "Node 20+ is required (pi itself wants 22.19+).");

  const pi = findPi();
  const piVer = pi ? (await run(pi, ["--version"], { timeout: 8000 })).trim() : "";
  add(Boolean(pi), "pi", pi ? `${piVer || "found"} at ${pi}` : "not found",
    "npm install -g @earendil-works/pi-coding-agent");

  let keyName = "DEEPSEEK_API_KEY";
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(home, "pi", "settings.json"), "utf8"));
    const models = JSON.parse(fs.readFileSync(path.join(home, "pi", "models.json"), "utf8"));
    const k = models.providers?.[settings.defaultProvider]?.apiKey || "";
    if (k.startsWith("$")) keyName = k.slice(1);
  } catch { /* fall back to the default name */ }
  add(Boolean(env[keyName]), keyName, env[keyName] ? "set" : "not set in this shell",
    `export ${keyName}=…  in your shell rc`);

  let writable = true;
  try { fs.mkdirSync(runtime, { recursive: true }); fs.accessSync(runtime, fs.constants.W_OK); } catch { writable = false; }
  add(writable, "cache dir", runtime, `mkdir -p ${runtime}`);

  const shell = env.LIL_SHELL;
  add(Boolean(shell && env.LIL_HANDOFF), "shell integration",
    shell ? `${shell} — RUN executes in this shell` : "not loaded — RUN falls back to a child shell",
    `${path.join(home, "install.sh")}  then open a new shell`);

  const clip = clipboardTools().map(([n]) => n);
  const ssh = Boolean(env.SSH_TTY || env.SSH_CONNECTION);
  add(clip.length > 0 || ssh, "clipboard",
    ssh ? "over SSH — copies go to your local terminal via OSC 52" : clip.length ? clip.join(", ") : "no tool found — falling back to OSC 52",
    kind === "mac" ? "" : env.WAYLAND_DISPLAY ? "install wl-clipboard" : "install xclip (X11) or wl-clipboard (Wayland)");

  add(caps.truecolor, "truecolor", caps.truecolor ? `${term}, 24-bit` : `${term}, 256 colours — fades will be coarser`,
    "export COLORTERM=truecolor if your terminal supports it");

  const nerd = await hasNerdFont(term);
  add(nerd, "nerd font", nerd ? "robot glyph will render" : "none detected — using a plain glyph in the header",
    "install any Nerd Font, or set LIL_NERD_FONT=1 if you already use one");

  if (env.TMUX) {
    const pass = (await run("tmux", ["show", "-gv", "allow-passthrough"])).trim();
    add(pass === "on" || pass === "all", "tmux passthrough", pass || "off",
      "set -g allow-passthrough on   (only needed for the WezTerm ⌘⏎ / ⌘C chords)");
  }

  const allGood = checks.filter((c) => !c.ok && ["node", "pi", keyName, "cache dir"].includes(c.label)).length === 0;
  const buddy = drawBuddy(allGood ? "idle" : "heavy", 0, { distress: !allGood });
  const rows = checks.map((c) => {
    const mark = c.ok ? `${PAL.GREEN}✓` : `${PAL.AMBER}✗`;
    const room = Math.max(10, (out.columns || 80) - 42);
    return `${mark} ${PAL.RESET}${c.label.padEnd(18)}${PAL.DIM}${fit(c.detail, room)}${PAL.RESET}`;
  });
  out.write(header(nerd) + "\n");
  const n = Math.max(buddy.length, rows.length);
  for (let i = 0; i < n; i++) out.write(`  ${buddy[i] ?? " ".repeat(16)}   ${rows[i] ?? ""}\n`);
  const fixes = checks.filter((c) => !c.ok && c.fix);
  if (fixes.length) {
    out.write(`\n${PAL.AMBER}  To fix:${PAL.RESET}\n`);
    for (const c of fixes) out.write(`${PAL.GREEN} ▸ ${PAL.RESET}${c.label}: ${PAL.AMBER}${c.fix}${PAL.RESET}\n`);
  } else {
    out.write(`\n${PAL.GREEN}  All systems nominal, boss.${PAL.RESET}\n`);
  }
  return allGood ? 0 : 1;
}
