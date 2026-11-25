// sprite.mjs — Lil Buddy himself: a 16×12 pixel CRT-headed robot drawn with
// half-block characters (one terminal cell = two stacked pixels), so he takes
// six rows and renders on anything that can draw ▀ ▄ █.
//
// He is built from layers: a fixed shell, plus eyes / mouth / feet / antenna
// picked per mood. Moods are driven by what the model is really doing (see
// panel.mjs) — he is an instrument, not a screensaver.
//
// Pixel legend:
//   t top bezel   b bezel   d bezel in shadow   f screen glass
//   e eye   m mouth   v visor   a antenna lamp   s signal spark   . empty

import { rgb, bgRgb, mix, RGB, PAL, caps } from "./ansi.mjs";

export const SPRITE_W = 16;
export const SPRITE_H = 12;
export const SPRITE_ROWS = SPRITE_H / 2;

const SHELL = [
  ".......aa.......",
  ".......bb.......",
  "..tttttttttttt..",
  ".bffffffffffffb.",
  "bbffffffffffffbb",
  "bbffffffffffffbb",
  ".bffffffffffffb.",
  ".bffffffffffffb.",
  ".bffffffffffffb.",
  "..dddddddddddd..",
  "....dd....dd....",
  "...ddd....ddd...",
];

// Eyes: 3×3 stamps. Left eye sits at x=4, right at x=9, both at y=3.
const EYES = {
  open:    ["...", "ee.", "ee."],
  right:   ["...", ".ee", ".ee"],
  up:      [".ee", ".ee", "..."],
  upleft:  ["ee.", "ee.", "..."],
  blink:   ["...", "...", "eee"],
  shut:    ["...", "eee", "..."],
  happy:   ["...", ".e.", "e.e"],
  wide:    ["eee", "e.e", "eee"],
  dead:    ["e.e", ".e.", "e.e"],
  squintL: ["e..", ".ee", "e.."],
  squintR: ["..e", "ee.", "..e"],
  off:     ["...", "...", "..."],
};

// Mouths: 6×2 stamps at x=5, y=7 (one clear row under the eyes).
const MOUTHS = {
  flat:  ["......", ".mmmm."],
  smile: ["m....m", ".mmmm."],
  grin:  ["mmmmmm", ".mmmm."],
  open:  ["..mm..", "..mm.."],
  wide:  [".mmmm.", ".mmmm."],
  small: ["......", "..mm.."],
  frown: [".mmmm.", "m....m"],
  wavy:  ["m.m.m.", ".m.m.m"],
  none:  ["......", "......"],
};

// Feet: the two bottom rows. "tapL" / "tapR" lift one foot.
const FEET = {
  stand: ["....dd....dd....", "...ddd....ddd..."],
  tapL:  ["...ddd....dd....", "..........ddd..."],
  tapR:  ["....dd....ddd...", "...ddd.........."],
  wide:  ["...dd......dd...", "..ddd......ddd.."],
};

function stamp(grid, art, x, y) {
  art.forEach((row, dy) => {
    const line = grid[y + dy].split("");
    for (let dx = 0; dx < row.length; dx++) if (row[dx] !== ".") line[x + dx] = row[dx];
    grid[y + dy] = line.join("");
  });
}

// Compose a pose into a 16×12 pixel grid.
export function compose({ eyes = "open", eyesR, mouth = "flat", feet = "stand", scan = -1, sparks = 0 } = {}) {
  const g = SHELL.slice();
  if (scan >= 0) {
    // Visor mode: a dim bar across the face with one hot segment sweeping it.
    const line = g[4].split("");
    for (let x = 3; x <= 12; x++) line[x] = "v";
    for (let x = scan; x < scan + 3; x++) if (x >= 3 && x <= 12) line[x] = "e";
    g[4] = line.join("");
  } else {
    stamp(g, EYES[eyes] || EYES.open, 4, 3);
    stamp(g, EYES[eyesR || eyes] || EYES.open, 9, 3);
  }
  stamp(g, MOUTHS[mouth] || MOUTHS.flat, 5, 7);
  const [f0, f1] = FEET[feet] || FEET.stand;
  g[10] = f0;
  g[11] = f1;
  if (sparks) {
    // Signal ticks either side of the antenna lamp.
    const line = g[0].split("");
    if (sparks & 1) { line[5] = "s"; line[10] = "s"; }
    if (sparks & 2) { line[3] = "s"; line[12] = "s"; }
    g[0] = line.join("");
  }
  return g;
}

// CRT power transition: squash the picture toward a bright horizontal line,
// then pinch the line to a dot. k = 1 is the full picture, 0 is nothing.
export function squash(grid, k) {
  const blank = ".".repeat(SPRITE_W);
  if (k >= 1) return grid;
  const out = grid.map(() => blank);
  if (k <= 0) return out;
  const mid = SPRITE_H / 2;
  if (k < 0.35) {
    // The line phase: one pixel tall, narrowing to nothing.
    const half = Math.max(1, Math.round((k / 0.35) * (SPRITE_W / 2)));
    out[mid] = (".".repeat(SPRITE_W / 2 - half) + "w".repeat(half * 2)).padEnd(SPRITE_W, ".");
    return out;
  }
  const h = Math.max(1, Math.round(((k - 0.35) / 0.65) * SPRITE_H));
  const top = Math.round(mid - h / 2);
  for (let i = 0; i < h; i++) {
    out[top + i] = grid[Math.min(SPRITE_H - 1, Math.floor((i / h) * SPRITE_H))];
  }
  return out;
}

// Render a pixel grid to SPRITE_ROWS strings. `tint` maps a pixel letter to
// an [r,g,b]; anything unmapped is empty.
export function paint(grid, tint) {
  const rows = [];
  for (let y = 0; y < grid.length; y += 2) {
    let out = "";
    for (let x = 0; x < SPRITE_W; x++) {
      const t = tint[grid[y][x]];
      const b = tint[grid[y + 1][x]];
      if (!t && !b) out += " ";
      else if (t && !b) out += rgb(t) + "▀";
      else if (!t && b) out += rgb(b) + "▄";
      else if (t === b || !caps.color) out += rgb(t) + "█";
      else out += rgb(t) + bgRgb(b) + "▀" + PAL.RESET;
    }
    rows.push(out + PAL.RESET);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Moods. Each returns the pose for time t (ms since the mood began).
// ---------------------------------------------------------------------------
const cycle = (t, period, frames) => frames[Math.floor(t / period) % frames.length];
// Blink for ~130ms every `every` ms, offset so it never lands on frame 0.
const blinking = (t, every = 3100) => (t + 900) % every < 130;

export const MOODS = {
  boot(t) {
    if (t < 420) return { eyes: "off", mouth: "none" };
    if (t < 560) return { eyes: "shut", mouth: "none" };
    if (t < 680) return { eyes: "blink", mouth: "flat" };
    return { eyes: blinking(t) ? "blink" : "open", mouth: "flat" };
  },
  think(t) {
    const feet = cycle(t, 300, ["stand", "stand", "stand", "tapR", "stand", "tapR", "stand", "stand"]);
    if (blinking(t, 3700)) return { eyes: "blink", mouth: "small", feet };
    const eyes = cycle(t, 620, ["up", "up", "upleft", "upleft", "up", "open", "right", "up"]);
    return { eyes, mouth: "small", feet, sparks: cycle(t, 240, [0, 1, 3, 2, 0, 0]) };
  },
  scan(t) {
    const span = 9;
    const p = Math.floor(t / 55) % (span * 2);
    return { scan: 3 + (p < span ? p : span * 2 - p) - 1, mouth: "flat", feet: "wide" };
  },
  write(t) {
    const mouth = cycle(t, 110, ["open", "small", "wide", "small", "open", "flat"]);
    return { eyes: blinking(t, 2600) ? "blink" : "happy", mouth };
  },
  done(t) {
    if (t < 300) return { eyes: "happy", eyesR: "blink", mouth: "grin" };
    return { eyes: "happy", mouth: "grin" };
  },
  poke(t) {
    return t < 160
      ? { eyes: "wide", mouth: "open", feet: "wide" }
      : { eyes: "squintL", eyesR: "squintR", mouth: "flat", feet: cycle(t, 140, ["tapL", "stand"]) };
  },
  heavy(t) {
    return {
      eyes: "squintL", eyesR: "squintR",
      mouth: cycle(t, 400, ["wavy", "flat"]),
      feet: cycle(t, 170, ["tapL", "stand", "tapR", "stand"]),
    };
  },
  blocked() {
    return { eyes: "wide", mouth: "small", feet: "wide" };
  },
  error(t) {
    return { eyes: "dead", mouth: t % 900 < 450 ? "wavy" : "frown" };
  },
  idle(t) {
    return { eyes: blinking(t) ? "blink" : cycle(t, 1400, ["open", "open", "right", "open"]), mouth: "smile" };
  },
};

// Tint for a mood: lit from above, the glass glows faintly, the antenna lamp
// carries status (amber working · red distress · green done).
export function tintFor(mood, t, { distress = false } = {}) {
  const pulse = 0.5 + 0.5 * Math.sin(t / 240);
  const lamp = distress || mood === "error" ? RGB.red : mood === "done" ? RGB.green : RGB.amber;
  const tint = {
    t: mix(RGB.dim, RGB.green, 0.45),
    b: RGB.dim,
    d: mix(RGB.deep, RGB.dim, 0.5),
    e: RGB.green,
    m: mix(RGB.dim, RGB.green, 0.6),
    v: mix(RGB.deep, RGB.dim, 0.25),
    a: mix(mix(lamp, [0, 0, 0], 0.6), lamp, pulse),
    s: mix(RGB.glass, RGB.amber, pulse),
    w: RGB.white,
  };
  // The glass only exists where two colours can share a cell.
  if (caps.color) tint.f = mood === "error" ? [38, 14, 10] : RGB.glass;
  if (mood === "error") {
    tint.e = RGB.red;
    tint.m = mix(RGB.red, RGB.amber, 0.4);
    tint.t = tint.b = mix(RGB.deep, RGB.dim, 0.55);
  }
  if (mood === "done") tint.e = RGB.white;
  if (mood === "blocked") tint.e = RGB.amber;
  return tint;
}

// opts.power: 0..1 for the CRT on/off transition (1 = fully on).
export function drawBuddy(mood, t, opts = {}) {
  const pose = (MOODS[mood] || MOODS.idle)(t);
  const grid = squash(compose(pose), opts.power ?? 1);
  return paint(grid, tintFor(mood, t, opts));
}
