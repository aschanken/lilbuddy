// ansi.mjs — colour, width and string helpers shared by every screen.
//
// Two palettes live here on purpose:
//   * PAL  — the exact 256-colour escapes the original zsh renderer used. The
//            answer screen is rendered ONLY with these, so its bytes stay
//            identical to what lil.zsh printed (tests/golden proves it).
//   * rgb()/mix() — truecolor for the transient live panel, where smooth
//            phosphor fades matter. Degrades to the nearest 256 colour.

const env = process.env;

export const caps = {
  color: !("NO_COLOR" in env) && env.TERM !== "dumb",
  truecolor: /^(truecolor|24bit)$/i.test(env.COLORTERM || ""),
};

export function setCaps(next) {
  Object.assign(caps, next);
}

const sgr = (code) => (caps.color ? `\x1b[${code}m` : "");

// Getter-backed so NO_COLOR / setCaps() take effect without re-importing.
export const PAL = {
  get GREEN() { return sgr("38;5;84"); },   // bright Pip-Boy green
  get DIM() { return sgr("38;5;41"); },     // dim Pip-Boy green
  get AMBER() { return sgr("38;5;214"); },  // amber (warnings / accents)
  get GRAY() { return sgr("38;5;244"); },   // chrome
  get RED() { return sgr("38;5;196"); },
  get RESET() { return sgr("0"); },
  get BOLD() { return sgr("1"); },
  get ITALIC() { return sgr("3"); },
};

export const RGB = {
  green: [95, 255, 135],   // 84
  dim: [0, 215, 95],       // 41
  deep: [0, 95, 45],       // phosphor afterglow
  ember: [0, 48, 24],      // nearly gone
  glass: [4, 30, 16],      // the unlit CRT face
  amber: [255, 175, 0],    // 214
  gray: [128, 128, 128],   // 244
  dark: [68, 72, 70],
  red: [255, 60, 48],
  white: [225, 255, 232],  // overdriven phosphor
};

function to256([r, g, b]) {
  if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  // xterm's colour cube is not linear: its six levels are 0 95 135 175 215 255.
  const q = (v) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

export function rgb(c) {
  if (!caps.color) return "";
  if (caps.truecolor) return `\x1b[38;2;${c[0] | 0};${c[1] | 0};${c[2] | 0}m`;
  return `\x1b[38;5;${to256(c)}m`;
}

export function bgRgb(c) {
  if (!caps.color) return "";
  if (caps.truecolor) return `\x1b[48;2;${c[0] | 0};${c[1] | 0};${c[2] | 0}m`;
  return `\x1b[48;5;${to256(c)}m`;
}

export const idx = (n) => sgr(`38;5;${n}`);

export function mix(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

// --- display width ---------------------------------------------------------

const ZERO = /^[\p{Mn}\p{Me}\p{Cf}]$/u;
const WIDE = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff], [0x1f900, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
];

export function charWidth(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp < 0x300) return 1;
  if (ZERO.test(ch)) return 0;
  for (const [lo, hi] of WIDE) if (cp >= lo && cp <= hi) return 2;
  return 1;
}

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export const stripAnsi = (s) => s.replace(ANSI_RE, "");

export function width(s) {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch);
  return w;
}

// First `n` display cells of an ANSI-styled string, escapes preserved.
export function sliceCells(s, n) {
  let out = "";
  let w = 0;
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\x1b") {
      ANSI_RE.lastIndex = i;
      const m = ANSI_RE.exec(s);
      if (m && m.index === i) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    const ch = String.fromCodePoint(s.codePointAt(i));
    const cw = charWidth(ch);
    if (w + cw > n) break;
    out += ch;
    w += cw;
    i += ch.length;
  }
  return out;
}

// Plain text helpers (no escapes inside).
export function fit(text, n) {
  let out = "";
  let w = 0;
  for (const ch of text) {
    const cw = charWidth(ch);
    if (w + cw > n) break;
    out += ch;
    w += cw;
  }
  return out;
}

export function tail(text, n) {
  const chars = Array.from(text);
  let w = 0;
  let i = chars.length;
  while (i > 0) {
    const cw = charWidth(chars[i - 1]);
    if (w + cw > n) break;
    w += cw;
    i--;
  }
  return chars.slice(i).join("");
}

export const pad = (s, n) => s + " ".repeat(Math.max(0, n - width(s)));

export const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
