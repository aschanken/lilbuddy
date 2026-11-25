// decrypt.mjs — the RobCo decryption line, ported from the zsh spinner v4.
//
// A message materialises out of scrambled glyph junk: characters lock in, in
// shuffled order; once everything is locked one random character glitches
// back to junk every so often; a block cursor blinks at the end.
//
// The zsh version advanced once per 70ms frame. This one is time-based so it
// can run inside a 30fps loop and still move at the original pace:
//   lock rate   2 chars / 70ms        glitch   one char for 70ms, every 490ms
//   cursor      280ms on / 280ms off  junk     reshuffles every 70ms

import { PAL, idx, rgb, mix, RGB, charWidth } from "./ansi.mjs";

export const CLASSIC_RAMP = [196, 208, 214, 226, 118, 46, 49, 51, 45, 39, 93, 201];
const RAMP_RGB = [
  [255, 0, 0], [255, 135, 0], [255, 175, 0], [255, 255, 0], [135, 255, 0], [0, 255, 0],
  [0, 255, 175], [0, 255, 255], [0, 215, 255], [0, 175, 255], [135, 0, 255], [255, 0, 255],
];

// Single-byte ASCII only — junk must never change the width of the line.
export const JUNK = ["!", "@", "#", "$", "%", "&", "*", "+", "=", "?", "/", "\\", "|", "<", ">", "[", "]", "{", "}", "~", "^", "0", "1"];

const TICK = 70;
const hash = (a, b) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
};

export class Decrypt {
  // style: "phosphor" (default) | "classic" (the original rainbow ramp)
  constructor({ style = "phosphor", random = Math.random } = {}) {
    this.style = style;
    this.random = random;
    this.chars = [];
    this.locked = [];   // per index: 0 = junk, else the time it locked
    this.order = [];    // shuffled indices still to lock
    this.pos = 0;
    this.budget = 0;
    this.last = 0;
    this.lockedAt = 0;  // when the whole message finished locking (0 = not yet)
  }

  get message() { return this.chars.join(""); }
  get settled() { return this.pos >= this.order.length; }

  #shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  // Re-key to a new message. A character keeps its lock only where the old
  // and new messages agree at that position; the rest starts over as junk.
  set(msg, now = 0) {
    const next = Array.from(msg);
    const locked = next.map((ch, i) => (this.locked[i] && this.chars[i] === ch ? this.locked[i] : 0));
    this.chars = next;
    this.locked = locked;
    this.order = this.#shuffle(next.map((_, i) => i).filter((i) => next[i] !== " " && !locked[i]));
    this.pos = 0;
    this.lockedAt = 0;
    this.last = now;
    this.budget = 0;
  }

  // Extra characters join the effect in their own shuffled order.
  append(suffix, now = 0) {
    const start = this.chars.length;
    const extra = Array.from(suffix);
    this.chars.push(...extra);
    for (let i = 0; i < extra.length; i++) this.locked.push(0);
    this.order.push(...this.#shuffle(extra.map((_, i) => start + i).filter((i) => this.chars[i] !== " ")));
    this.lockedAt = 0;
    if (this.settled) this.last = now;
  }

  tick(now) {
    this.budget += ((now - this.last) / TICK) * 2;
    this.last = now;
    while (this.budget >= 1 && this.pos < this.order.length) {
      this.locked[this.order[this.pos++]] = now || 1;
      this.budget -= 1;
    }
    if (this.settled) {
      this.budget = 0;
      if (!this.lockedAt) this.lockedAt = now || 1;
    }
  }

  // Lock everything immediately (used when motion is off).
  finish(now = 1) {
    for (const i of this.order.slice(this.pos)) this.locked[i] = now;
    this.pos = this.order.length;
    this.lockedAt = this.lockedAt || now;
  }

  #junk(i, now) {
    return JUNK[hash(i + 1, Math.floor(now / TICK)) % JUNK.length];
  }

  #colour(i, now) {
    if (this.style === "classic") return idx(CLASSIC_RAMP[i % 12]);
    // Phosphor: a character burns in white-hot and cools to green; when the
    // whole line has locked, the old rainbow ramp sweeps across it once.
    const cool = mix(RGB.white, RGB.green, (now - this.locked[i]) / 260);
    if (this.lockedAt) {
      const sweep = (now - this.lockedAt) / 16 - i;   // one cell per 16ms
      if (sweep > 0 && sweep < 7) return rgb(mix(RAMP_RGB[i % 12], cool, sweep / 7));
    }
    return rgb(cool);
  }

  // One frame. opts: cursor ("auto" | true | false), cursorColour (256 index),
  // glitch ("auto" | 0 | 1-based index) — explicit values make it testable.
  render(now, { cursor = "auto", cursorColour = 214, glitch = "auto", max = Infinity } = {}) {
    let g = -1;
    if (glitch === "auto") {
      if (this.settled && Math.floor(now / TICK) % 7 === 0) {
        const lockedIdx = this.locked.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
        if (lockedIdx.length) g = lockedIdx[hash(7, Math.floor(now / TICK)) % lockedIdx.length];
      }
    } else if (glitch > 0) g = glitch - 1;

    let out = `${PAL.AMBER}☢ `;
    let used = 0;
    for (let i = 0; i < this.chars.length; i++) {
      const ch = this.chars[i];
      used += charWidth(ch);
      if (used > max) break;
      if (ch === " ") out += " ";
      else if (i === g || !this.locked[i]) out += PAL.DIM + this.#junk(i, now);
      else out += this.#colour(i, now) + ch;
    }
    const on = cursor === "auto" ? Math.floor(now / (TICK * 4)) % 2 === 0 : cursor;
    out += on ? `${idx(cursorColour)} ▊` : `${PAL.AMBER}  `;
    return out + PAL.RESET;
  }
}
