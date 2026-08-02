// Lil Buddy context snapshot tools.
// Snapshot files (clip.txt, term.txt) are written by the `lil` zsh wrapper
// BEFORE pi launches. The extension only reads them via LIL_RUNTIME; there is
// no live capture inside pi.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

export default function (pi: ExtensionAPI) {
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
}
