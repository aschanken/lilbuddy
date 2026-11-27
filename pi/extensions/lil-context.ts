// Lil Buddy context snapshot tools + read-only `probe`.
// Snapshot files (clip.txt, term.txt) are written by the `lil` engine
// (src/platform.mjs) BEFORE pi launches. The extension only reads them via
// LIL_RUNTIME, which the engine exports to pi; there is no live capture
// inside pi.
//
// Read-only enforcement (v3): on session_start we pin the ACTIVE tool set to
// the read-only surface {read, probe, read_clipboard, read_terminal}. This
// removes pi's built-in bash/edit/write/grep/find/ls from what the model can
// call, regardless of how pi is invoked with this config dir. Belt-and-
// suspenders: src/pi.mjs also passes `--exclude-tools bash,edit,write`.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { guardProbe, runProbe, requestApproval, BLOCKED_MESSAGE, DENIED_MESSAGE } from "../probe-guard.ts";

const MAX_CHARS = 8000;

function snapshot(file: string): string {
  const runtime = process.env.LIL_RUNTIME;
  if (!runtime) return "no snapshot available";
  try {
    const text = readFileSync(join(runtime, file), "utf8");
    return text.length > MAX_CHARS ? text.slice(-MAX_CHARS) : text;
  } catch {
    return "no snapshot available";
  }
}

// The ONLY tools the model may call. `read` stays (read-only by nature);
// bash/edit/write/grep/find/ls are excluded. probe covers read-only inspection.
const ACTIVE_TOOLS = ["read", "probe", "read_clipboard", "read_terminal"];

export default function (pi: ExtensionAPI) {
  // Enforce the read-only tool surface at session start, before any turn.
  // This is the tool-layer fix for the auto-approved `brew install` incident.
  pi.on("session_start", async () => {
    pi.setActiveTools(ACTIVE_TOOLS);
  });

  pi.registerTool({
    name: "read_clipboard",
    label: "Read Clipboard",
    description:
      "Read the snapshot of the user's clipboard taken at invocation time.",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text", text: snapshot("clip.txt") }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "read_terminal",
    label: "Read Terminal",
    description:
      "Read the snapshot of the user's terminal scrollback taken at invocation time.",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text", text: snapshot("term.txt") }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "probe",
    label: "Probe",
    description:
      "Run an inspection command on the user's machine. Read-only commands run at once. Anything else is shown to the human, who must approve that exact command before it runs; expect BLOCKED or DENIED otherwise. Never use this to carry out what the user asked for — that goes in the lilcmd block.",
    parameters: Type.Object({
      command: Type.String({
        description: "Inspection command to run (POSIX sh).",
      }),
    }),
    async execute(_callId, params) {
      const verdict = guardProbe(params.command);
      let text: string;
      if (verdict.allowed) {
        text = await runProbe(params.command);
      } else if (!verdict.ask) {
        text = BLOCKED_MESSAGE;
      } else {
        // Not on the read-only list: only the human can let it through.
        const approval = await requestApproval(params.command);
        text = approval === "approved" ? await runProbe(params.command)
          : approval === "denied" ? DENIED_MESSAGE
          : BLOCKED_MESSAGE;
      }
      return { content: [{ type: "text", text }], details: {} };
    },
  });
}
