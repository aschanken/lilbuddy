// platform.mjs — everything that differs between macOS, Linux and WSL:
// clipboard, terminal scrollback capture, the environment fingerprint.

import { execFile, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const env = process.env;

export function osKind() {
  if (process.platform === "darwin") return "mac";
  if (process.platform === "linux") {
    if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return "wsl";
    if (env.TERMUX_VERSION) return "termux";
    return "linux";
  }
  return "other";
}

export function which(cmd) {
  for (const dir of (env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, cmd);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return "";
}

// Where is pi? PATH first, then ~/.local/bin — the installer's no-sudo spot,
// which may not be on PATH yet in the shell that just installed it.
export function findPi(e = env) {
  if (e.LIL_PI_BIN) return e.LIL_PI_BIN;
  const onPath = which("pi");
  if (onPath) return onPath;
  const local = path.join(os.homedir(), ".local", "bin", "pi");
  try { fs.accessSync(local, fs.constants.X_OK); return local; } catch { return ""; }
}

// Run a short command, never throw, never hang.
export function run(cmd, args = [], { timeout = 1500, input } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile(cmd, args, { timeout, maxBuffer: 4_000_000, encoding: "utf8" },
        (err, stdout) => resolve(err ? "" : stdout));
    } catch { resolve(""); return; }
    child.on("error", () => resolve(""));
    if (input !== undefined) child.stdin.end(input); else child.stdin?.end();
  });
}

const first = (s) => (s || "").split("\n")[0].trim();

// --- clipboard -------------------------------------------------------------

// [name, read argv, write argv] in preference order for this machine.
export function clipboardTools() {
  const kind = osKind();
  const tools = [];
  if (kind === "mac") tools.push(["pbcopy", ["pbpaste"], ["pbcopy"]]);
  if (kind === "termux") tools.push(["termux-api", ["termux-clipboard-get"], ["termux-clipboard-set"]]);
  if (kind === "wsl") {
    tools.push(["win32yank", ["win32yank.exe", "-o", "--lf"], ["win32yank.exe", "-i", "--crlf"]]);
    tools.push(["clip.exe", ["powershell.exe", "-NoProfile", "-Command", "Get-Clipboard"], ["clip.exe"]]);
  }
  if (env.WAYLAND_DISPLAY) tools.push(["wl-clipboard", ["wl-paste", "--no-newline"], ["wl-copy"]]);
  if (env.DISPLAY) {
    tools.push(["xclip", ["xclip", "-o", "-selection", "clipboard"], ["xclip", "-i", "-selection", "clipboard"]]);
    tools.push(["xsel", ["xsel", "--clipboard", "--output"], ["xsel", "--clipboard", "--input"]]);
  }
  return tools.filter(([, read]) => which(read[0]));
}

export async function readClipboard() {
  for (const [, read] of clipboardTools()) {
    const text = await run(read[0], read.slice(1), { timeout: 1000 });
    if (text) return text;
  }
  return "";
}

// OSC 52 puts text on the clipboard of the terminal you are *sitting at* —
// the only thing that works across SSH. Wrapped for tmux passthrough.
export function osc52(text) {
  const seq = `\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`;
  return env.TMUX ? `\x1bPtmux;${seq.replaceAll("\x1b", "\x1b\x1b")}\x1b\\` : seq;
}

// → the name of the mechanism that took it ("pbcopy", "xclip", "osc52"…).
export async function writeClipboard(text, tty = process.stdout) {
  const overSsh = Boolean(env.SSH_TTY || env.SSH_CONNECTION);
  if (!overSsh) {
    for (const [name, , write] of clipboardTools()) {
      const ok = await new Promise((resolve) => {
        let settled = false;
        const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
        try {
          // xclip / wl-copy stay alive to own the selection: don't wait on
          // them and don't keep the event loop open for them.
          const child = spawn(write[0], write.slice(1), { stdio: ["pipe", "ignore", "ignore"], detached: true });
          child.on("error", () => finish(false));
          child.on("close", (code) => finish(code === 0));
          child.stdin.on("error", () => finish(false));
          child.stdin.end(text, () => setTimeout(() => finish(true), 150));
          child.unref();
        } catch { finish(false); }
      });
      if (ok) return name;
    }
  }
  if (tty.isTTY) { tty.write(osc52(text)); return "osc52"; }
  return "";
}

// --- terminal scrollback ---------------------------------------------------

export async function readTerminal() {
  if (env.TMUX) {
    const t = await run("tmux", ["capture-pane", "-p", "-S", "-200"]);
    if (t.trim()) return t;
  }
  if (env.WEZTERM_PANE && which("wezterm")) {
    const t = await run("wezterm", ["cli", "get-text", "--pane-id", env.WEZTERM_PANE, "--start-line", "-200"]);
    if (t.trim()) return t;
  }
  if (env.KITTY_LISTEN_ON && which("kitty")) {
    const t = await run("kitty", ["@", "get-text", "--extent", "all"]);
    if (t.trim()) return t.split("\n").slice(-200).join("\n");
  }
  if (env.ZELLIJ && which("zellij")) {
    const tmp = path.join(os.tmpdir(), `lil-zellij-${process.pid}.txt`);
    await run("zellij", ["action", "dump-screen", tmp]);
    try { const t = fs.readFileSync(tmp, "utf8"); fs.rmSync(tmp, { force: true }); if (t.trim()) return t; } catch { /* none */ }
  }
  return "";
}

// Taken BEFORE pi starts so the model sees the user's terminal, not ours.
export async function snapshot(runtime) {
  const [clip, term] = await Promise.all([readClipboard(), readTerminal()]);
  const put = (name, text) => {
    const file = path.join(runtime, name);
    if (text) fs.writeFileSync(file, text); else fs.rmSync(file, { force: true });
  };
  put("clip.txt", clip);
  put("term.txt", term);
}

// --- environment -----------------------------------------------------------

export function terminalName() {
  if (env.TERM_PROGRAM && env.TERM_PROGRAM !== "tmux") return env.TERM_PROGRAM;
  if (env.TMUX) {
    const r = spawnSync("tmux", ["show-environment", "-g", "TERM_PROGRAM"], { encoding: "utf8", timeout: 800 });
    const v = (r.stdout || "").trim().split("=")[1];
    if (v) return v;
  }
  if (env.KITTY_WINDOW_ID) return "kitty";
  if (env.ALACRITTY_WINDOW_ID) return "Alacritty";
  if (env.GNOME_TERMINAL_SCREEN || env.VTE_VERSION) return "VTE";
  if (env.KONSOLE_VERSION) return "Konsole";
  if (env.WT_SESSION) return "WindowsTerminal";
  return env.TERM_PROGRAM || "unknown";
}

// Is the robot glyph in the header (a Nerd Font codepoint) going to render?
// Terminals that bundle Nerd Font symbols always can; otherwise look for an
// installed Nerd Font. LIL_NERD_FONT=1/0 overrides.
export async function hasNerdFont(term = terminalName()) {
  if (env.LIL_NERD_FONT === "0") return false;
  if (env.LIL_NERD_FONT === "1") return true;
  if (/wezterm|ghostty|kitty/i.test(term)) return true;
  if (env.SSH_TTY || env.SSH_CONNECTION) return true; // fonts live on the other end
  const kind = osKind();
  if (kind === "mac") {
    for (const dir of [path.join(os.homedir(), "Library/Fonts"), "/Library/Fonts"]) {
      try { if (fs.readdirSync(dir).some((f) => /nerd/i.test(f))) return true; } catch { /* none */ }
    }
    return false;
  }
  if (kind === "wsl") return true; // rendered by the Windows terminal
  if (which("fc-list")) return /nerd/i.test(await run("fc-list", [":", "family"], { timeout: 2500 }));
  return false;
}

async function osLine() {
  const kind = osKind();
  if (kind === "mac") {
    const [n, v, b] = await Promise.all([
      run("sw_vers", ["-productName"]), run("sw_vers", ["-productVersion"]), run("sw_vers", ["-buildVersion"]),
    ]);
    return `${n.trim()} ${v.trim()} (${b.trim()})`;
  }
  let pretty = "";
  try {
    const rel = fs.readFileSync("/etc/os-release", "utf8");
    pretty = (rel.match(/^PRETTY_NAME="?([^"\n]*)"?/m) || [])[1] || "";
  } catch { /* not a systemd-era distro */ }
  if (!pretty) pretty = `${os.type()} ${os.release()}`;
  if (kind === "wsl") pretty += ` (WSL: ${env.WSL_DISTRO_NAME || "yes"})`;
  if (kind === "termux") pretty += " (Termux)";
  return pretty;
}

const PKG_MANAGERS = [
  ["brew", ["--version"]], ["apt", ["--version"]], ["dnf", ["--version"]], ["pacman", ["--version"]],
  ["zypper", ["--version"]], ["apk", ["--version"]], ["xbps-install", ["--version"]],
  ["emerge", ["--version"]], ["nix", ["--version"]], ["pkg", ["--version"]],
];

async function pkgLine() {
  const found = [];
  for (const [name, args] of PKG_MANAGERS) {
    if (name === "pkg" && osKind() !== "termux") continue;
    if (!which(name)) continue;
    const v = first((await run(name, args)).replace(/^\s+/, ""));
    found.push(v && v.length < 60 ? (v.toLowerCase().includes(name) ? v : `${name} ${v}`) : name);
  }
  return found.join("; ");
}

async function shellLine(shellName) {
  const name = shellName || path.basename(env.SHELL || "sh");
  const bin = which(name);
  if (!bin) return name;
  const out = first(await run(bin, ["--version"]));
  const ver = (out.match(/\d+\.\d+(\.\d+)?/) || [""])[0];
  return ver ? `${name} ${ver}` : name;
}

// Regenerate when missing, older than 24h, or written for a different shell.
export async function fingerprint(runtime, shellName = env.LIL_SHELL || "") {
  const file = path.join(runtime, "fingerprint.txt");
  const shell = await shellLine(shellName);
  try {
    const st = fs.statSync(file);
    const text = fs.readFileSync(file, "utf8");
    if (Date.now() - st.mtimeMs < 86_400_000 && text.includes(`\nshell: ${shell}\n`)) return text;
  } catch { /* regenerate */ }

  const kind = osKind();
  const v = (cmd, args = ["--version"]) => (which(cmd) ? run(cmd, args).then(first) : Promise.resolve(""));
  const term = terminalName();
  const [osl, pkg, tmux, node, py, git, bun, systemd, coreutils, nerd] = await Promise.all([
    osLine(), pkgLine(), v("tmux", ["-V"]), v("node"), v("python3"), v("git"), v("bun"),
    kind === "mac" ? "" : v("systemctl"),
    kind === "mac" ? "" : v("ls"),
    hasNerdFont(term),
  ]);
  const clip = clipboardTools().map(([name]) => name);
  const lines = [
    "## ENVIRONMENT FINGERPRINT (auto-generated; trust these versions)",
    `os: ${osl}`,
    `arch: ${os.arch() === "x64" ? "x86_64" : os.arch()}`,
    `kernel: ${os.type()} ${os.release()}`,
    `shell: ${shell}`,
    `userland: ${kind === "mac" ? "BSD (macOS base system)" : /busybox/i.test(coreutils) ? "BusyBox" : coreutils || "unknown"}`,
    `tmux: ${tmux.replace(/^tmux /, "")}`,
    `terminal: ${term}`,
    `pkgmgr: ${pkg}`,
  ];
  if (kind !== "mac") {
    lines.push(`init: ${systemd || (fs.existsSync("/run/systemd/system") ? "systemd" : "not systemd")}`);
    lines.push(`session: ${env.XDG_SESSION_TYPE || (env.WAYLAND_DISPLAY ? "wayland" : env.DISPLAY ? "x11" : "tty/ssh")}` +
      (env.XDG_CURRENT_DESKTOP ? ` (${env.XDG_CURRENT_DESKTOP})` : ""));
  }
  lines.push(
    `clipboard: ${clip.length ? clip.join(", ") : "no clipboard tool (OSC 52 only)"}`,
    `node: ${node}`,
    `python3: ${py}`,
    `git: ${git}`,
    `bun: ${bun}`,
  );
  const text = lines.join("\n") + "\n";
  fs.writeFileSync(file, text);
  fs.writeFileSync(path.join(runtime, "glyphs"), nerd ? "nerd" : "plain");
  return text;
}

// Cached alongside the fingerprint so the header never waits on fc-list.
export function cachedNerd(runtime) {
  if (env.LIL_NERD_FONT === "0") return false;
  if (env.LIL_NERD_FONT === "1") return true;
  try { return fs.readFileSync(path.join(runtime, "glyphs"), "utf8").trim() !== "plain"; } catch { return null; }
}

// WezTerm user-var (OSC 1337), tmux-passthrough-wrapped. The WezTerm snippet
// in integrations/ keys off LIL_SCRATCHPAD=1 to route ⌘⏎ / ⌘C to us.
export function userVar(value) {
  const b64 = Buffer.from(String(value)).toString("base64");
  return env.TMUX
    ? `\x1bPtmux;\x1b\x1b]1337;SetUserVar=LIL_SCRATCHPAD=${b64}\x07\x1b\\`
    : `\x1b]1337;SetUserVar=LIL_SCRATCHPAD=${b64}\x07`;
}
