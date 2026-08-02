// probe-guard.ts — pure read-only guard for the `probe` tool.
//
// Lives OUTSIDE pi/extensions/ so pi never auto-discovers it as an extension
// (extension discovery globs only <configdir>/extensions/*.ts). No pi/typebox
// imports: unit-testable directly with `node` type-stripping.
//
// Guard policy (see brief 1b): reject anything that could mutate state;
// allow a fixed allowlist of read-only inspection commands only.

import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const BLOCKED_MESSAGE =
  "BLOCKED (read-only): Lil Buddy proposes commands; the human runs them. Put it in the lilcmd block instead.";

const ALLOWLIST = new Set([
  "man", "apropos", "which", "whence", "type", "uname", "sw_vers", "hostname",
  "id", "whoami", "date", "uptime", "ls", "cat", "head", "tail", "wc", "file",
  "stat", "df", "du", "ps", "pgrep", "lsof", "netstat", "launchctl", "printenv",
  "env", "echo", "grep", "awk", "sed", "sort", "uniq", "tr", "cut", "column",
  "xargs", "git", "brew", "tmux", "defaults", "sysctl", "ioreg",
  "system_profiler", "mdfind", "find", "node", "python3", "zsh", "bash",
  "pip3", "npm",
]);

// Interpreters are code executors: the ONLY acceptable invocation is a
// bare version probe (sole argument --version/-V).
const INTERPRETERS = new Set(["node", "python3", "zsh", "bash"]);
const INTERPRETER_ARGS = new Set(["--version", "-V"]);

const GIT_OK = new Set([
  "version", "--version", "status", "log", "diff", "show", "branch", "remote",
]);

const SUBCMD: Record<string, Set<string>> = {
  brew: new Set(["info", "list", "search", "deps", "outdated", "--version", "-v"]),
  npm: new Set(["ls", "list", "view", "--version", "-v"]),
  pip3: new Set(["list", "show", "--version"]),
  launchctl: new Set(["list", "print"]),
  defaults: new Set(["read"]),
  tmux: new Set([
    "display-message", "list-sessions", "list-panes", "show", "-g", "show-options",
  ]),
};

// The only places `>` / `<` may legally appear (rule 1 exceptions).
const ALLOWED_REDIRECTS = ["2>/dev/null", "2>&1"];

export interface GuardResult {
  allowed: boolean;
  reason: string;
}

export function guardProbe(rawCmd: string): GuardResult {
  if (typeof rawCmd !== "string" || rawCmd.trim() === "") {
    return { allowed: false, reason: "empty command" };
  }
  const cmd = rawCmd.trim();

  // Rule 1: banned substrings, with the two allowed redirect literals exempt.
  let redirFree = cmd;
  for (const lit of ALLOWED_REDIRECTS) {
    redirFree = redirFree.split(lit).join("");
  }
  if (cmd.includes("sudo")) return { allowed: false, reason: "contains sudo" };
  if (cmd.includes("`")) return { allowed: false, reason: "contains backtick" };
  if (cmd.includes("$(")) return { allowed: false, reason: "contains $(" };
  if (redirFree.includes(">") || redirFree.includes("<")) {
    return { allowed: false, reason: "contains redirection" };
  }

  // Rule 2: split on `||`, `&&`, `;`, `|`, newline. Every non-empty segment's
  // first token must be in the allowlist.
  const segments = cmd.split(/\|\||&&|[;|\n]/);
  for (const seg of segments) {
    const tokens = seg.trim().split(/\s+/);
    if (tokens.length === 0 || tokens[0] === "") continue;
    const first = tokens[0];
    const second = tokens[1];

    if (!ALLOWLIST.has(first)) {
      return { allowed: false, reason: `first token not allowlisted: ${first}` };
    }

    // Rule 3: subcommand constraints on the second token.
    if (INTERPRETERS.has(first)) {
      if (tokens.length !== 2 || !INTERPRETER_ARGS.has(second)) {
        return {
          allowed: false,
          reason: `interpreter ${first} may only run --version/-V`,
        };
      }
      continue;
    }
    if (first === "xargs") {
      // Chosen simplest-correct option from brief 1b rule 3: block entirely.
      return { allowed: false, reason: "xargs blocked entirely (read-only guard)" };
    }
    if (first === "find") {
      if (/-(delete|exec|ok)\b/.test(cmd)) {
        return { allowed: false, reason: "find with -delete/-exec/-ok" };
      }
      continue;
    }
    if (first === "sed") {
      if (cmd.includes("-i")) return { allowed: false, reason: "sed -i is a mutation" };
      continue;
    }
    if (first === "awk") {
      if (cmd.includes("system(")) return { allowed: false, reason: "awk system() is a mutation" };
      continue;
    }
    if (first === "git") {
      if (second === "config") {
        if (tokens[2] !== "--get" && tokens[2] !== "--list") {
          return {
            allowed: false,
            reason: "git config must be read-only (--get/--list only)",
          };
        }
      } else if (!GIT_OK.has(second)) {
        return { allowed: false, reason: `subcommand not allowlisted: git ${second ?? ""}` };
      }
      continue;
    }
    const allowed = SUBCMD[first];
    if (allowed && !allowed.has(second)) {
      return { allowed: false, reason: `subcommand not allowlisted: ${first} ${second ?? ""}` };
    }
  }

  return { allowed: true, reason: "" };
}

// Execute an already-guarded command. Never mutate; returns output only.
export async function runProbe(cmd: string): Promise<string> {
  const cwd = process.env.LIL_RUNTIME || tmpdir();
  try {
    const { stdout, stderr } = await execFileAsync("/bin/zsh", ["-c", cmd], {
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
