// demo.mjs — scripted pi event timelines for `lil --demo`.
//
// Each scenario is a list of [delayMs, rawPiEvent] pairs in the exact shape
// `pi --mode json` emits, so a demo exercises the same translator, renderer
// and UI as a real run — no pi, no API key, no network.

let callSeq = 0;

function chunks(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

const update = (event, output) => ({
  type: "message_update",
  usage: { input: 1200, output, totalTokens: 1200 + output },
  assistantMessageEvent: event,
});

class Script {
  constructor() {
    this.timeline = [[120, { type: "session", version: 3 }], [260, { type: "agent_start" }]];
    this.tokens = 0;
  }

  #open() {
    this.tokens = 0;
    this.timeline.push([90, { type: "turn_start" }], [0, { type: "message_start", message: { role: "assistant", content: [] } }]);
  }

  think(text, { first = 420, pace = 26 } = {}) {
    this.#open();
    this.timeline.push([first, update({ type: "thinking_start", contentIndex: 0 }, 0)]);
    for (const piece of chunks(text, 7)) {
      this.tokens += 2;
      this.timeline.push([pace + (piece.includes(".") ? 90 : 0), update({ type: "thinking_delta", contentIndex: 0, delta: piece }, this.tokens)]);
    }
    return this;
  }

  tool(name, args, { ms = 300, result = "ok", isError = false } = {}) {
    const id = `call_${++callSeq}`;
    this.timeline.push(
      [140, update({ type: "toolcall_start", contentIndex: 1, id, toolName: name }, this.tokens)],
      [160, { type: "tool_execution_start", toolCallId: id, toolName: name, args }],
      [ms, { type: "tool_execution_end", toolCallId: id, toolName: name, isError, durationMs: ms,
        result: { content: [{ type: "text", text: result }], details: {} } }],
      [40, { type: "turn_end" }],
    );
    return this;
  }

  say(text, { first = 260, pace = 22 } = {}) {
    this.timeline.push([first, update({ type: "text_start", contentIndex: 1 }, this.tokens)]);
    for (const piece of chunks(text, 9)) {
      this.tokens += 2;
      this.timeline.push([pace, update({ type: "text_delta", contentIndex: 1, delta: piece }, this.tokens)]);
    }
    return this;
  }

  fail(message) {
    this.timeline.push([400, { type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: message, content: [] } }]);
    return this;
  }

  end() {
    this.timeline.push([120, { type: "agent_end", messages: [], willRetry: false }], [30, { type: "agent_settled", aborted: false }]);
    return this.timeline;
  }
}

const FENCE = "```";

export const SCENARIOS = {
  port: {
    question: "what's listening on port 8080",
    about: "thinks, probes the machine, hands over a command",
    build: () => new Script()
      .think("The boss wants whatever is bound to TCP 8080 on this box. Fingerprint says Linux with iproute2, so ss is the native call; lsof is the portable one. Let me look before I answer so the PID is real, not a guess.")
      .tool("probe", { command: "ss -ltnp 2>/dev/null | grep :8080" }, { ms: 340, result: 'LISTEN 0 511 0.0.0.0:8080 users:(("node",pid=41822,fd=23))' })
      .think("Got it: node, pid 41822, bound on all interfaces. Give the one-liner, say what the flags do, mention sudo for other users' sockets.", { first: 300 })
      .say(`\`ss -ltnp\` is the native answer on this box — and right now port **8080** belongs to \`node\` (pid 41822), listening on every interface.

- \`-l\` listening sockets only, \`-t\` TCP, \`-n\` skip DNS so it's instant
- \`-p\` names the owning process — add \`sudo\` to see *other users'* sockets

Remember: a port you can name is a port you can tame!

${FENCE}lilcmd
ss -ltnp 'sport = :8080'
${FENCE}
`)
      .end(),
  },
  concept: {
    question: "hard link vs symlink?",
    about: "a conceptual answer, no command",
    build: () => new Script()
      .think("Conceptual question, no single command to hand over. Keep it tight: inode vs path, what breaks when the original goes away, the two classic limits.")
      .say(`## Two names, one file

A **hard link** is a second directory entry for the same inode; a *symlink* is a tiny file that stores a path.

- Delete the original: the hard link still works, the symlink dangles
- Hard links can't cross filesystems or (normally) point at directories
- \`ls -li\` shows the shared inode number; \`readlink\` shows where a symlink points

${FENCE}sh
ln target hardlink        # same inode
ln -s target symlink      # stores the path
${FENCE}
`)
      .end(),
  },
  danger: {
    question: "wipe node_modules everywhere under here",
    about: "a destructive command — the scratchpad makes you confirm",
    build: () => new Script()
      .think("Destructive and recursive. Offer the dry run in prose first, then the real thing, with the warning line.")
      .say(`⚠ This one bites — read twice.

Preview what would go with \`find . -name node_modules -type d -prune\` first. The command below deletes every match under the current directory.

${FENCE}lilcmd
find . -name node_modules -type d -prune -exec rm -rf {} +
${FENCE}
`)
      .end(),
  },
  blocked: {
    question: "install eza for me",
    about: "the read-only guard slaps a probe down",
    build: () => new Script()
      .think("They asked me to install it. I could just try it…")
      .tool("probe", { command: "brew install eza" }, { ms: 30, result: "BLOCKED (read-only): Lil Buddy proposes commands; the human runs them. Put it in the lilcmd block instead." })
      .think("Right. Strictly read-only. Check whether it is already here, then hand the install over.", { first: 260 })
      .tool("probe", { command: "which eza" }, { ms: 90, result: "" })
      .say(`Not installed yet — and installing is your trigger to pull, boss, not mine.

\`eza\` is the maintained fork of exa: colour, icons, git status, tree view.

${FENCE}lilcmd
sudo apt install eza
${FENCE}
`, { first: 320 })
      .end(),
  },
  error: {
    question: "anything at all",
    about: "what a failed run looks like",
    build: () => new Script()
      .think("Reaching for the vault link")
      .fail("401 Authentication Fails (invalid api key)")
      .end(),
  },
};
