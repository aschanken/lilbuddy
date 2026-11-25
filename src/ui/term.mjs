// term.mjs — the two terminal primitives everything else is built on:
//   Live — a redrawable region at the bottom of the scrollback. Lines can be
//          "committed" above it, where they become ordinary permanent output.
//   Keys — raw-mode key reader that turns bytes into named key events.

import { sliceCells, PAL } from "./ansi.mjs";

const ESC = "\x1b";
const SYNC_ON = `${ESC}[?2026h`;
const SYNC_OFF = `${ESC}[?2026l`;

const cleanups = new Set();
let hooked = false;

function runCleanups() {
  for (const fn of [...cleanups].reverse()) {
    try { fn(); } catch { /* best effort on the way out */ }
  }
  cleanups.clear();
}

// Register something that must be undone however the process ends
// (cursor shown, raw mode off, …). Returns a function that undoes it now.
export function onExit(fn) {
  if (!hooked) {
    hooked = true;
    process.on("exit", runCleanups);
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(sig, () => {
        runCleanups();
        process.exit(sig === "SIGINT" ? 130 : 143);
      });
    }
  }
  cleanups.add(fn);
  return () => {
    if (cleanups.delete(fn)) fn();
  };
}

export class Live {
  constructor(out = process.stdout) {
    this.out = out;
    this.height = 0;
    this.lastFrame = "";
    this.restore = null;
  }

  get cols() { return this.out.columns || Number(process.env.COLUMNS) || 80; }
  get rows() { return this.out.rows || Number(process.env.LINES) || 24; }

  begin() {
    if (this.restore) return;
    this.out.write(`${ESC}[?25l`);
    this.restore = onExit(() => this.out.write(`${ESC}[?25h`));
  }

  // Every live line is cut to the terminal width: a wrapped line would break
  // the cursor arithmetic below.
  #clip(lines) {
    const max = Math.max(1, this.cols);
    return lines.map((l) => sliceCells(l, max) + PAL.RESET);
  }

  #home() {
    return "\r" + (this.height > 1 ? `${ESC}[${this.height - 1}A` : "") + `${ESC}[J`;
  }

  // Replace the live region with `lines`.
  draw(lines) {
    const body = this.#clip(lines).join("\n");
    if (body === this.lastFrame && lines.length === this.height) return;
    this.out.write(SYNC_ON + this.#home() + body + SYNC_OFF);
    this.height = lines.length;
    this.lastFrame = body;
  }

  // Print `permanent` lines above the region, then redraw the region.
  commit(permanent, lines = []) {
    let buf = SYNC_ON + this.#home();
    for (const l of permanent) buf += l + "\n";
    const body = this.#clip(lines).join("\n");
    this.out.write(buf + body + SYNC_OFF);
    this.height = lines.length;
    this.lastFrame = body;
  }

  // Erase the region entirely; the cursor is left where it began.
  clear() {
    if (this.height > 0) this.out.write(this.#home());
    this.height = 0;
    this.lastFrame = "";
  }

  // Turn the current region into permanent output and stop managing it.
  freeze() {
    if (this.height > 0) this.out.write("\n");
    this.height = 0;
    this.lastFrame = "";
  }

  end() {
    if (this.restore) this.restore();
    this.restore = null;
  }
}

// ---------------------------------------------------------------------------

const CTRL = {
  "\r": "enter", "\n": "enter", "\x7f": "backspace", "\b": "backspace", "\t": "tab",
  "\x01": "ctrl-a", "\x03": "ctrl-c", "\x04": "ctrl-d", "\x05": "ctrl-e",
  "\x0b": "ctrl-k", "\x12": "ctrl-r", "\x15": "ctrl-u", "\x17": "ctrl-w",
  "\x19": "ctrl-y",
};
const CSI = {
  A: "up", B: "down", C: "right", D: "left", H: "home", F: "end",
  "1~": "home", "4~": "end", "3~": "delete", "7~": "home", "8~": "end",
};

export class Keys {
  constructor(input = process.stdin) {
    this.input = input;
    this.handler = null;
    this.pendingEsc = null;
    this.paste = null;
    this.queue = [];
    this.restore = null;
    this.onData = (buf) => this.#feed(buf.toString("utf8"));
  }

  get interactive() { return Boolean(this.input.isTTY); }

  start() {
    if (this.restore || !this.interactive) return;
    this.input.setRawMode(true);
    this.input.resume();
    this.input.on("data", this.onData);
    this.restore = onExit(() => {
      this.input.off("data", this.onData);
      try { this.input.setRawMode(false); } catch { /* tty already gone */ }
      this.input.pause();
    });
  }

  stop() {
    if (this.pendingEsc) clearTimeout(this.pendingEsc);
    this.pendingEsc = null;
    if (this.restore) this.restore();
    this.restore = null;
  }

  // One consumer at a time; keys that arrive with no consumer are queued so a
  // key pressed during an animation is not lost.
  on(handler) {
    this.handler = handler;
    while (this.handler && this.queue.length) this.handler(this.queue.shift());
  }

  next() {
    return new Promise((resolve) => {
      this.on((key) => { this.handler = null; resolve(key); });
    });
  }

  #emit(key) {
    if (this.handler) this.handler(key);
    else this.queue.push(key);
  }

  #feed(data) {
    if (this.pendingEsc) {
      clearTimeout(this.pendingEsc);
      this.pendingEsc = null;
      data = ESC + data;
    }
    let i = 0;
    while (i < data.length) {
      if (this.paste !== null) {
        const end = data.indexOf(`${ESC}[201~`, i);
        if (end < 0) { this.paste += data.slice(i); return; }
        this.paste += data.slice(i, end);
        this.#emit({ name: "paste", text: this.paste });
        this.paste = null;
        i = end + 6;
        continue;
      }
      const ch = data[i];
      if (ch === ESC) {
        const next = data[i + 1];
        if (next === undefined) {
          // Lone ESC at the end of a chunk: a real Escape, or the first byte
          // of a sequence still in flight. Give it a moment.
          this.pendingEsc = setTimeout(() => {
            this.pendingEsc = null;
            this.#emit({ name: "esc" });
          }, 30);
          return;
        }
        if (next === "[" || next === "O") {
          const m = /^[0-9;?]*[@-~]/.exec(data.slice(i + 2));
          if (!m) { i = data.length; continue; }
          const seq = m[0];
          i += 2 + seq.length;
          if (seq === "200~") { this.paste = ""; continue; }
          const name = CSI[seq] || CSI[seq.slice(-1)];
          if (name) this.#emit({ name });
          continue;
        }
        i += 1 + String.fromCodePoint(data.codePointAt(i + 1)).length; // alt-chord: swallow
        continue;
      }
      if (CTRL[ch]) { this.#emit({ name: CTRL[ch] }); i++; continue; }
      const cp = data.codePointAt(i);
      const full = String.fromCodePoint(cp);
      i += full.length;
      if (cp >= 0x20) this.#emit({ name: "char", ch: full });
    }
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
