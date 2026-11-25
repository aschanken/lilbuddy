// pi.test.mjs — the stage machine, and the contract with the pi binary
// (exercised against tests/fake-pi.mjs via LIL_PI_BIN).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EventTranslator, runPi, replay, piArgs } from "../src/pi.mjs";
import { SCENARIOS } from "../src/demo.mjs";
import { extractCmd } from "../src/lilcmd.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(here);
const fakePi = path.join(here, "fake-pi.mjs");

function translate(events) {
  const out = [];
  const t = new EventTranslator((e) => out.push(e));
  for (const e of events) t.feed(e);
  return { out, t };
}
const stages = (out) => out.filter((e) => e.type === "stage").map((e) => e.stage);
const text = (out) => out.filter((e) => e.type === "text").map((e) => e.delta).join("");
const upd = (a) => ({ type: "message_update", assistantMessageEvent: a });

test("stage sequence: start → thinking → tool → writing → done", () => {
  const { out } = translate([
    { type: "agent_start" },
    upd({ type: "thinking_start" }),
    upd({ type: "thinking_delta", delta: "x" }),
    { type: "tool_execution_start", toolCallId: "c1", toolName: "read_clipboard", args: {} },
    upd({ type: "text_delta", delta: "answer" }),
    { type: "agent_end", messages: [] },
  ]);
  assert.deepEqual(stages(out), ["start", "thinking", "tool:read_clipboard", "writing", "done"]);
});

test("thinking after a tool is still thinking, not writing", () => {
  const { out } = translate([
    { type: "tool_execution_start", toolCallId: "c1", toolName: "probe", args: { command: "ls" } },
    upd({ type: "thinking_delta", delta: "hmm" }),
    upd({ type: "text_delta", delta: "ok" }),
  ]);
  assert.deepEqual(stages(out), ["start", "tool:probe", "thinking", "writing"]);
});

test("text deltas concatenate byte-faithfully", () => {
  const { out } = translate([
    upd({ type: "text_delta", delta: "Here is the plan:\n" }),
    upd({ type: "text_delta", delta: "```lilcmd\nls -la\n```\n" }),
    { type: "agent_end", messages: [] },
  ]);
  assert.equal(text(out), "Here is the plan:\n```lilcmd\nls -la\n```\n");
  assert.equal(extractCmd(text(out)), "ls -la");
});

test("no deltas: falls back to the final assistant message", () => {
  const { out } = translate([{
    type: "agent_end",
    messages: [{ role: "user", content: "q" }, { role: "assistant", content: [{ type: "text", text: "late answer" }] }],
  }]);
  assert.equal(text(out), "late answer");
});

test("a blocked probe is flagged; usage and retries pass through", () => {
  const { out, t } = translate([
    { type: "message_update", usage: { output: 42 }, assistantMessageEvent: { type: "thinking_delta", delta: "a" } },
    { type: "tool_execution_start", toolCallId: "c1", toolName: "probe", args: { command: "brew install eza" } },
    { type: "tool_execution_end", toolCallId: "c1", toolName: "probe", isError: false, durationMs: 3,
      result: { content: [{ type: "text", text: "BLOCKED (read-only): Lil Buddy proposes commands; the human runs them." }] } },
    { type: "auto_retry_start", attempt: 1, maxAttempts: 3 },
    { type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "401 bad key" } },
  ]);
  assert.equal(out.find((e) => e.type === "usage").output, 42);
  assert.equal(out.find((e) => e.type === "tool_end").blocked, true);
  assert.deepEqual(out.find((e) => e.type === "retry"), { type: "retry", attempt: 1, max: 3 });
  assert.equal(t.failure, "401 bad key");
});

test("argv contract: json mode, no context files, write tools excluded, prompt after --", () => {
  assert.deepEqual(piArgs({ runtime: "/rt", fingerprint: "FP", prompt: "-l in ls?" }), [
    "--mode", "json", "-nc", "--exclude-tools", "bash,edit,write",
    "--session", "/rt/session", "--append-system-prompt", "FP", "--", "-l in ls?",
  ]);
});

test("runPi: spawns pi isolated, stdin closed, and streams the answer", async () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "lil-pi-"));
  const argsOut = path.join(runtime, "args.json");
  const events = [];
  const res = await runPi({
    prompt: "where to", home: repo, runtime, fingerprint: "## FP",
    onEvent: (e) => events.push(e),
    env: { ...process.env, LIL_PI_BIN: fakePi, FAKE_PI_ARGS_OUT: argsOut },
  }).done;
  assert.equal(res.rc, 0);
  assert.ok(!res.timedOut && !res.aborted);
  assert.deepEqual(stages(events), ["start", "thinking", "tool:probe", "writing", "done"]);
  assert.equal(extractCmd(text(events)), "cd /tmp && LIL_MARK=vault111");
  const seen = JSON.parse(fs.readFileSync(argsOut, "utf8"));
  assert.equal(seen.PI_CODING_AGENT_DIR, path.join(repo, "pi"));
  assert.equal(seen.LIL_RUNTIME, runtime);        // the extension reads snapshots from here
  assert.equal(seen.cwd, fs.realpathSync(runtime));
  assert.equal(seen.stdinIsTTY, false);
  assert.equal(seen.argv.at(-1), "where to");
  assert.ok(fs.readFileSync(path.join(runtime, "last.out"), "utf8").includes('"agent_end"'));
});

test("runPi: non-zero exit and stderr are reported, timeouts kill the run", async () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "lil-pi-"));
  const base = { prompt: "q", home: repo, runtime, fingerprint: "", onEvent: () => {} };
  const bad = await runPi({ ...base, env: { ...process.env, LIL_PI_BIN: fakePi, FAKE_PI_EXIT: "3", FAKE_PI_STDERR: "boom" } }).done;
  assert.equal(bad.rc, 3);
  assert.equal(bad.errTail, "boom");
  const slow = await runPi({ ...base, timeoutMs: 150, env: { ...process.env, LIL_PI_BIN: fakePi, FAKE_PI_DELAY: "200" } }).done;
  assert.ok(slow.timedOut);
  const gone = await runPi({ ...base, env: { ...process.env, LIL_PI_BIN: path.join(runtime, "nope") } }).done;
  assert.equal(gone.rc, 127);
});

test("every demo scenario replays through the real translator", async () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const events = [];
    const res = await replay({ timeline: scenario.build(), onEvent: (e) => events.push(e), speed: 1000 }).done;
    assert.equal(res.rc, 0, name);
    assert.equal(stages(events).at(-1), "done", name);
    if (name === "error") assert.ok(res.failure, name); else assert.ok(text(events).length > 20, name);
  }
  assert.equal(extractCmd(SCENARIOS.concept.build().map(([, e]) => e.assistantMessageEvent?.type === "text_delta" ? e.assistantMessageEvent.delta : "").join("")), "");
});
