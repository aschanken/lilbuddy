// probe-guard.ts — pure read-only guard for the `probe` tool.
//
// Lives OUTSIDE pi/extensions/ so pi never auto-discovers it as an extension
// (extension discovery globs only <configdir>/extensions/*.ts). No pi/typebox
// imports: unit-testable directly with `node` type-stripping.
//
// Policy: reject anything that could mutate state or run arbitrary code;
// allow a fixed allowlist of read-only inspection commands, each narrowed to
// its read-only flags and subcommands. When in doubt, block — a blocked
// probe costs one round trip, the model just hands the command to the human.
//
// The persona's promises are flavor. THIS is the enforcement.

import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const BLOCKED_MESSAGE =
  "BLOCKED (read-only): Lil Buddy proposes commands; the human runs them. Put it in the lilcmd block instead.";

const ALLOWLIST = new Set([
  // everywhere
  "man", "apropos", "which", "type", "command", "uname", "arch", "hostname", "id",
  "whoami", "groups", "who", "w", "last", "tty", "pwd", "date", "uptime", "ls", "cat",
  "head", "tail", "wc", "file", "stat", "readlink", "realpath", "basename", "dirname",
  "df", "du", "ps", "pgrep", "lsof", "netstat", "printenv", "env", "echo", "grep",
  "awk", "sed", "sort", "uniq", "tr", "cut", "column", "xargs", "find", "locale",
  "getconf", "git", "tmux", "node", "python3", "zsh", "bash", "fish", "pip", "pip3",
  "npm",
  // macOS
  "sw_vers", "launchctl", "brew", "defaults", "sysctl", "ioreg", "system_profiler",
  "mdfind",
  // Linux
  "lsb_release", "hostnamectl", "systemctl", "journalctl", "loginctl", "timedatectl",
  "localectl", "resolvectl", "ip", "ss", "free", "vmstat", "nproc", "lscpu", "lsblk",
  "lsusb", "lspci", "lsmod", "lsns", "findmnt", "mount", "getent", "dmesg", "sensors",
  "dpkg", "dpkg-query", "apt", "apt-cache", "rpm", "dnf", "pacman", "zypper", "apk",
  "snap", "flatpak", "fc-list", "fc-match",
]);

// Interpreters are code executors: the ONLY acceptable invocation is a bare
// version probe (sole argument --version/-V).
const INTERPRETERS = new Set(["node", "python3", "zsh", "bash", "fish"]);
const INTERPRETER_ARGS = new Set(["--version", "-V"]);

// Commands limited to a fixed set of read-only subcommands (first non-flag
// argument). "" in a set means "no subcommand at all" is fine too.
const SUBCMD: Record<string, Set<string>> = {
  brew: new Set(["info", "list", "ls", "search", "deps", "uses", "outdated", "leaves", "desc", "config", "--prefix", "--cellar", "--version", "-v"]),
  npm: new Set(["ls", "list", "view", "outdated", "root", "prefix", "--version", "-v"]),
  pip: new Set(["list", "show", "freeze", "--version"]),
  pip3: new Set(["list", "show", "freeze", "--version"]),
  launchctl: new Set(["list", "print"]),
  defaults: new Set(["read", "domains", "find"]),
  tmux: new Set([
    "display-message", "display", "list-sessions", "ls", "list-windows", "list-panes",
    "list-clients", "show", "show-options", "show-window-options", "show-environment",
    "-V",
  ]),
  systemctl: new Set([
    "status", "show", "cat", "list-units", "list-unit-files", "list-timers",
    "list-sockets", "list-dependencies", "list-jobs", "is-active", "is-enabled",
    "is-failed", "is-system-running", "get-default", "show-environment", "--version", "",
  ]),
  loginctl: new Set(["list-sessions", "list-users", "list-seats", "show-session", "show-user", "session-status", "user-status", "show", ""]),
  timedatectl: new Set(["status", "show", "list-timezones", "timesync-status", "show-timesync", ""]),
  localectl: new Set(["status", "list-locales", "list-keymaps", ""]),
  hostnamectl: new Set(["status", "--version", ""]),
  resolvectl: new Set(["status", "query", "statistics", ""]),
  apt: new Set(["list", "show", "search", "policy", "depends", "rdepends", "--version", "-v"]),
  "apt-cache": new Set(["show", "search", "policy", "depends", "rdepends", "madison", "showpkg", "pkgnames", "stats"]),
  dnf: new Set(["list", "info", "search", "repolist", "provides", "repoquery", "--version"]),
  zypper: new Set(["search", "se", "info", "if", "repos", "lr", "packages", "pa", "what-provides", "wp", "--version"]),
  apk: new Set(["info", "list", "search", "version", "policy", "stats", "--version"]),
  snap: new Set(["list", "info", "find", "version", "services", "connections"]),
  flatpak: new Set(["list", "info", "search", "remotes", "history", "--version"]),
};

// Per-command flags that turn a reader into a writer (or make it hang).
const DENY_FLAGS: Record<string, RegExp> = {
  journalctl: /^(--vacuum-\w+|--rotate|--flush|--sync|--relinquish-var|--smart-relinquish-var|--setup-keys|--update-catalog|-f|--follow)(=|$)/,
  dmesg: /^(-[a-zA-Z]*[cCDEnw][a-zA-Z]*|--clear|--read-clear|--console-\w+|--follow(-new)?)$/,
  sysctl: /^(-[a-zA-Z]*[wp][a-zA-Z]*|--write|--load|--system)(=|$)/,
  sort: /^(-[a-zA-Z]*o|--output|--compress-program)/,
  man: /^(-P|--pager|-H|--html)/,
  ss: /^(-[a-zA-Z]*[KD][a-zA-Z]*|--kill|--diag)(=|$)/,
  tail: /^(-[a-zA-Z0-9]*[fF]|--follow|--retry)/,
  file: /^(-[a-zA-Z]*C|--compile)/,
  sensors: /^(-[a-zA-Z]*s|--set)$/,
  hostname: /^(-[a-zA-Z]*[bF][a-zA-Z]*|--boot|--file)(=|$)/,
  date: /^(--set(=.*)?|-(?!I)[a-zA-Z]*s)$/,
  awk: /^(-f|--file|-i|--include|-l|--load|-E|--exec)(=|$)/,
  ip: /^(-b|-batch|-force)$/,
};

const IP_MUTATING = new Set([
  "add", "del", "delete", "set", "flush", "change", "replace", "append", "prepend",
  "exec", "save", "restore", "monitor", "attach", "detach", "up", "down",
]);

const GIT_OK = new Set([
  "version", "--version", "status", "log", "diff", "show", "branch", "remote",
  "rev-parse", "describe", "ls-files", "blame", "shortlog", "tag", "stash",
]);

// The only places `>` may legally appear. Longest first: they are removed in
// this order before the redirection check.
const ALLOWED_REDIRECTS = ["2>/dev/null", "&>/dev/null", ">/dev/null", "2>&1"];

export interface GuardResult {
  allowed: boolean;
  reason: string;
}

const no = (reason: string): GuardResult => ({ allowed: false, reason });

export function guardProbe(rawCmd: string): GuardResult {
  if (typeof rawCmd !== "string" || rawCmd.trim() === "") return no("empty command");
  const cmd = rawCmd.trim();

  // Rule 1: banned substrings, with the allowed redirect literals exempt.
  let bare = cmd;
  for (const lit of ALLOWED_REDIRECTS) bare = bare.split(lit).join(" ");
  if (cmd.includes("sudo")) return no("contains sudo");
  if (cmd.includes("`")) return no("contains backtick");
  if (cmd.includes("$(")) return no("contains $(");
  if (bare.includes(">") || bare.includes("<")) return no("contains redirection");

  // Rule 2: split on `||`, `&&`, `;`, `|`, `&`, newline. Every non-empty
  // segment's first token must be in the allowlist. (A lone `&` chains
  // commands just as well as `;` does.)
  const segments = bare.split(/\|\||&&|[;|&\n]/);
  for (const seg of segments) {
    const tokens = seg.trim().split(/\s+/);
    if (tokens.length === 0 || tokens[0] === "") continue;
    const first = tokens[0];
    const second = tokens[1];
    const args = tokens.slice(1);
    const positional = args.filter((t) => !t.startsWith("-"));

    if (!ALLOWLIST.has(first)) return no(`first token not allowlisted: ${first}`);

    // Rule 3: per-command constraints.
    if (INTERPRETERS.has(first)) {
      if (tokens.length !== 2 || !INTERPRETER_ARGS.has(second)) {
        return no(`interpreter ${first} may only run --version/-V`);
      }
      continue;
    }
    const deny = DENY_FLAGS[first];
    if (deny) {
      const bad = args.find((t) => deny.test(t));
      if (bad) return no(`${first} ${bad} is not read-only`);
    }

    switch (first) {
      case "xargs":
        return no("xargs blocked entirely (read-only guard)");
      case "env":
        // `env CMD …` runs CMD. Bare `env` (print the environment) only.
        if (args.length > 0) return no("env may only be run bare (use printenv NAME)");
        continue;
      case "command":
        if (second !== "-v" && second !== "-V") return no("command may only be used as `command -v`");
        continue;
      case "find":
        if (/-(delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)\b/.test(seg)) {
          return no("find with -delete/-exec/-ok/-fprint");
        }
        continue;
      case "sed":
        if (args.some((t) => /^-[a-zA-Z]*i/.test(t) || t.startsWith("--in-place"))) return no("sed -i is a mutation");
        // `w file` writes, `e` executes — in any position of the script.
        if (/(^|[\s;{}'"\/])w\s+\S/.test(seg) || /\/[gpIi0-9]*[we]['"\s;}]/.test(seg) || /(^|[\s;{'"])e(\s|;|'|"|$)/.test(args.join(" "))) {
          return no("sed w/e commands are mutations");
        }
        continue;
      case "awk":
        if (seg.includes("system(")) return no("awk system() is a mutation");
        continue;
      case "uniq":
        if (positional.length > 1) return no("uniq with an output file");
        continue;
      case "hostname":
        if (positional.length > 0) return no("hostname NAME sets the hostname");
        continue;
      case "date":
        // BSD/GNU `date MMDDhhmm…` sets the clock.
        if (!args.includes("-j") && args.some((t, i) => /^\d{4,}(\.\d\d)?$/.test(t) && !/^(-r|-d|-f|-v|--date|--reference)$/.test(args[i - 1] || ""))) {
          return no("date with a timestamp operand sets the clock");
        }
        continue;
      case "sysctl":
        if (args.some((t) => t.includes("="))) return no("sysctl name=value is a write");
        continue;
      case "mount":
        if (args.length > 0 && !(args.length === 1 && second === "-l")) return no("mount may only list");
        continue;
      case "ip":
        if (args.some((t) => IP_MUTATING.has(t))) return no("ip: only show/list forms are allowed");
        continue;
      case "tmux":
        // tmux formats can shell out: #(command).
        if (seg.includes("#(")) return no("tmux #() runs a shell command");
        break;
      case "rpm":
        if (!second || !/^(-q|--query|--version)/.test(second)) return no("rpm: query mode (-q…) only");
        continue;
      case "dpkg":
        if (!second || !/^(-l|-s|-L|-S|-p|-C|--list|--status|--listfiles|--search|--print-architecture|--get-selections|--audit|--version)$/.test(second)) {
          return no("dpkg: query flags only");
        }
        continue;
      case "pacman":
        if (!second || !/^(-Q[a-z]*|-S[sigl]+|-F[lox]*|-V|--version)$/.test(second)) return no("pacman: -Q / -Ss / -Si / -F queries only");
        continue;
      case "git": {
        if (second === "config") {
          if (!["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(tokens[2])) {
            return no("git config must be read-only (--get/--list only)");
          }
          continue;
        }
        if (!GIT_OK.has(second)) return no(`subcommand not allowlisted: git ${second ?? ""}`);
        const rest = tokens.slice(2);
        if (rest.some((t) => t.startsWith("--output"))) return no("git --output writes a file");
        if (second === "branch") {
          if (rest.some((t) => /^(-[a-zA-Z]*[dDmMcCfu][a-zA-Z]*|--delete|--move|--copy|--force|--set-upstream-to.*|--unset-upstream|--edit-description)$/.test(t))) {
            return no("git branch: listing only");
          }
          const listing = rest.some((t) => /^(-l|--list|-a|-r|--all|--remotes|--contains|--no-contains|--merged|--no-merged|--points-at)$/.test(t));
          if (rest.some((t) => !t.startsWith("-")) && !listing) return no("git branch NAME creates a branch");
        } else if (second === "remote") {
          const sub = rest.find((t) => !t.startsWith("-"));
          if (sub && sub !== "show" && sub !== "get-url") return no("git remote: listing only");
        } else if (second === "tag") {
          const listing = rest.length === 0 || rest.some((t) => /^(-l|--list|-n\d*|--contains|--points-at|--merged|--no-merged)$/.test(t));
          if (!listing || rest.some((t) => /^(-[a-zA-Z]*[adfsum][a-zA-Z]*|--delete|--force|--annotate|--sign)$/.test(t))) {
            return no("git tag: listing only");
          }
        } else if (second === "stash") {
          if (tokens[2] !== "list" && tokens[2] !== "show") return no("git stash: list/show only");
        }
        continue;
      }
      default:
        break;
    }

    const allowed = SUBCMD[first];
    if (allowed) {
      // The subcommand is the first argument that is not an option. Options
      // listed in the set themselves (--version, -V…) count as subcommands.
      const sub = args.find((t) => !t.startsWith("-") || allowed.has(t)) ?? "";
      if (!allowed.has(sub)) return no(`subcommand not allowlisted: ${first} ${sub}`);
    }
  }

  return { allowed: true, reason: "" };
}

// Probes run under plain POSIX sh on every platform. zsh would add ways to
// execute code that a text guard cannot see — =(…) substitution, glob
// qualifiers like *(e:'cmd':) — so it is never used here.
export const PROBE_SHELL = "/bin/sh";

// Execute an already-guarded command. Never mutate; returns output only.
export async function runProbe(cmd: string): Promise<string> {
  const cwd = process.env.LIL_RUNTIME || tmpdir();
  try {
    const { stdout, stderr } = await execFileAsync(PROBE_SHELL, ["-c", cmd], {
      timeout: 10_000,
      maxBuffer: 1_000_000,
      cwd,
    });
    const text = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
    return text.length > 8000 ? text.slice(-8000) : text;
  } catch (err) {
    const e = err as { message?: string; stdout?: string | Buffer; stderr?: string | Buffer };
    const out = String(e.stdout ?? "").trim();
    const errText = String(e.stderr ?? "").trim();
    const msg = e.message ?? String(err);
    const text =
      out || errText
        ? `${out}${errText ? `\n${errText}` : ""}`
        : `probe failed: ${msg}`;
    return text.length > 8000 ? text.slice(-8000) : text;
  }
}
