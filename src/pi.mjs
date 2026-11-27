// pi.mjs — run one pi turn and translate its JSON event stream into the
// handful of events the UI cares about.
//
// Invocation contract (unchanged from the zsh wrapper):
//   PI_CODING_AGENT_DIR=<repo>/pi  pi --mode json -nc \
//       --exclude-tools bash,edit,write --session <runtime>/session \
//       --append-system-prompt <fingerprint> "<prompt>"        < /dev/null
// pi's stdin MUST be closed: json mode blocks forever on an open non-tty
// stdin. bash/edit/write stay excluded here AND in the extension — never
// re-enable them.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { findPi } from "./platform.mjs";

const BLOCKED_PREFIX = "BLOCKED (read-only)";
const DENIED_PREFIX = "DENIED:";

const toolText = (result) =>
  (result?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

const assistantText = (messages) =>
  (messages || [])
    .filter((m) => m.role === "assistant")
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");

// Stage machine: start → thinking → tool:<name> → writing → done.
// Feed it raw pi events; it calls `emit` with normalised ones:
//   stage · thinking · text · text_break · tool_start · tool_end · usage ·
//   response · retry · failure
export class EventTranslator {
  constructor(emit) {
    this.emit = emit;
    this.stage = "";
    this.sawText = false;
    this.settled = false;
    this.failure = "";
    this.#stage("start");
  }

  #stage(stage) {
    if (stage === this.stage) return;
    this.stage = stage;
    this.emit({ type: "stage", stage });
  }

  feed(ev) {
    switch (ev.type) {
      case "message_start":
        if (ev.message?.role === "assistant") this.emit({ type: "response" });
        break;
      case "message_update": {
        if (ev.usage?.output > 0) this.emit({ type: "usage", output: ev.usage.output });
        const a = ev.assistantMessageEvent || {};
        if (a.type === "thinking_start" || a.type === "thinking_delta") {
          this.#stage("thinking");
          // A new thinking block gets a space so thoughts don't run together.
          this.emit({ type: "thinking", delta: a.type === "thinking_start" ? " " : a.delta || "" });
        } else if (a.type === "text_start") {
          this.emit({ type: "text_break" });
        } else if (a.type === "text_delta") {
          this.#stage("writing");
          this.sawText = true;
          if (a.delta) this.emit({ type: "text", delta: a.delta });
        } else if (a.type === "toolcall_start" && a.toolName) {
          this.#stage(`tool:${a.toolName}`);
        } else if (a.type === "error") {
          this.failure = a.error?.errorMessage || a.reason || this.failure;
        }
        break;
      }
      case "message_end":
        if (ev.message?.role === "assistant" && ev.message.stopReason === "error") {
          this.failure = ev.message.errorMessage || "the model returned an error";
        }
        break;
      case "tool_execution_start":
        this.#stage(`tool:${ev.toolName || ""}`);
        this.emit({ type: "tool_start", id: ev.toolCallId, name: ev.toolName || "", args: ev.args || {} });
        break;
      case "tool_execution_end":
        this.emit({
          type: "tool_end",
          id: ev.toolCallId,
          name: ev.toolName || "",
          isError: Boolean(ev.isError),
          blocked: toolText(ev.result).startsWith(BLOCKED_PREFIX),
          denied: toolText(ev.result).startsWith(DENIED_PREFIX),
          durationMs: ev.durationMs,
        });
        break;
      case "auto_retry_start":
        this.failure = "";
        this.emit({ type: "retry", attempt: ev.attempt, max: ev.maxAttempts });
        break;
      case "agent_end":
        // Fallback for providers that never streamed deltas.
        if (!this.sawText) {
          const text = assistantText(ev.messages);
          if (text) { this.sawText = true; this.#stage("writing"); this.emit({ type: "text", delta: text }); }
        }
        if (!ev.willRetry) this.#stage("done");
        break;
      case "agent_settled":
        this.settled = true;
        this.#stage("done");
        break;
      default:
        break;
    }
  }
}

// JSONL framing per pi's docs: split on LF only (readline would also split on
// Unicode separators that are legal inside JSON strings).
function lineSplitter(onLine) {
  let buf = "";
  return {
    write(chunk) {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line) onLine(line);
      }
    },
    end() { if (buf.trim()) onLine(buf.trim()); buf = ""; },
  };
}

export function piArgs({ runtime, fingerprint, prompt }) {
  const args = ["--mode", "json", "-nc", "--exclude-tools", "bash,edit,write",
    "--session", path.join(runtime, "session")];
  if (fingerprint) args.push("--append-system-prompt", fingerprint);
  // The prompt is a bare positional. Not `-- prompt`: pi only learned the
  // `--` separator after 0.82, and older builds die with "Unknown option: --".
  // A question that starts with a dash gets a leading space instead, which
  // every version reads as a message rather than a flag.
  args.push(prompt.startsWith("-") ? ` ${prompt}` : prompt);
  return args;
}

// Run one turn. Resolves with { rc, timedOut, aborted, failure, errTail }.
// `onEvent` receives the normalised events; `handle.abort()` stops the run.
// `askDir`, when given, is where the probe tool may leave approval requests
// for the human (see pi/probe-guard.ts); without it, such probes are blocked.
export function runPi({ prompt, home, runtime, fingerprint, timeoutMs = 120000, onEvent, env = process.env, askDir = "" }) {
  const outFile = path.join(runtime, "last.out");
  const errFile = path.join(runtime, "last.err");
  fs.writeFileSync(outFile, "");
  fs.writeFileSync(errFile, "");
  const outLog = fs.createWriteStream(outFile);
  const errLog = fs.createWriteStream(errFile);
  let errTail = "";
  let timedOut = false;
  let aborted = false;

  // LIL_PI_BIN lets tests (and the curious) substitute the binary.
  const bin = findPi(env) || "pi";
  const child = spawn(bin, piArgs({ runtime, fingerprint, prompt }), {
    cwd: runtime,
    env: { ...env, PI_CODING_AGENT_DIR: path.join(home, "pi"), LIL_RUNTIME: runtime, LIL_ASK_DIR: askDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const translator = new EventTranslator(onEvent);
  const splitter = lineSplitter((line) => {
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    translator.feed(ev);
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { outLog.write(chunk); splitter.write(chunk); });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { errLog.write(chunk); errTail = (errTail + chunk).slice(-2000); });

  let deadline = Date.now() + timeoutMs;
  const timer = setInterval(() => {
    if (Date.now() >= deadline) { timedOut = true; child.kill("SIGTERM"); clearInterval(timer); }
  }, 250);

  const done = new Promise((resolve) => {
    let spawnError = null;
    child.on("error", (err) => { spawnError = err; });
    child.on("close", (code, signal) => {
      clearInterval(timer);
      splitter.end();
      outLog.end();
      errLog.end();
      let rc = code ?? (signal ? 143 : 1);
      if (spawnError) {
        rc = 127;
        errTail = spawnError.code === "ENOENT"
          ? `pi not found on PATH (looked for "${bin}")`
          : String(spawnError.message || spawnError);
      }
      resolve({ rc, timedOut, aborted, failure: translator.failure, errTail: errTail.trim(), sawText: translator.sawText });
    });
  });

  return {
    done,
    abort() { aborted = true; child.kill("SIGTERM"); },
    // Time spent waiting on a human keypress is not the model's fault.
    extend(ms) { deadline += ms; },
  };
}

// Replay a scripted event timeline through the same translator — powers
// `lil --demo`, which needs neither pi nor an API key.
export function replay({ timeline, onEvent, speed = 1 }) {
  const translator = new EventTranslator(onEvent);
  let aborted = false;
  let timer = null;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  let i = 0;
  const step = () => {
    if (aborted) return;
    if (i >= timeline.length) {
      finish({ rc: 0, timedOut: false, aborted: false, failure: translator.failure, errTail: "", sawText: translator.sawText });
      return;
    }
    const [wait, ev] = timeline[i++];
    timer = setTimeout(() => { translator.feed(ev); step(); }, wait / speed);
  };
  step();
  return {
    done,
    abort() {
      aborted = true;
      clearTimeout(timer);
      finish({ rc: 143, timedOut: false, aborted: true, failure: "", errTail: "", sawText: translator.sawText });
    },
    extend() {},
  };
}
