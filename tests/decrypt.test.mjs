// decrypt.test.mjs — structure of the RobCo decryption line (ported from the
// zsh spinner fixture). Junk glyph choice is free; structure is not.
import test from "node:test";
import assert from "node:assert/strict";
import { setCaps } from "../src/ui/ansi.mjs";
import { Decrypt, JUNK, CLASSIC_RAMP } from "../src/ui/decrypt.mjs";

setCaps({ color: true, truecolor: false });

const MSG = "OVERSEER IS THINKING"; // 20 chars; spaces at 9 and 12

// "colour<TAB>char" tokens; unstyled cells get "-".
function parse(frame) {
  const out = [];
  let s = frame.replace(/\x1b\[0m$/, "");
  while (s) {
    const m = /^\x1b\[38;5;(\d+)m(.)/su.exec(s);
    if (m) { out.push(`${m[1]}\t${m[2]}`); s = s.slice(m[0].length); }
    else { const ch = String.fromCodePoint(s.codePointAt(0)); out.push(`-\t${ch}`); s = s.slice(ch.length); }
  }
  return out;
}

function make(lockedIdx) {
  const d = new Decrypt({ style: "classic", random: () => 0.5 });
  d.set(MSG, 0);
  for (const i of lockedIdx) d.locked[i - 1] = 1;
  return d;
}

test("nothing locked: amber ☢, dim-green junk, spaces kept, amber cursor", () => {
  const frame = make([]).render(0, { cursor: true, glitch: 0 });
  const t = parse(frame);
  assert.equal(t[0], "214\t☢");
  assert.equal(t[1], "-\t ");
  assert.deepEqual(t.slice(-2), ["214\t ", "-\t▊"]);
  assert.ok(frame.endsWith("\x1b[0m"));
  assert.equal(t.length, 2 + MSG.length + 2);
  [...MSG].forEach((ch, i) => {
    const [col, glyph] = t[i + 2].split("\t");
    if (ch === " ") assert.equal(t[i + 2], "-\t ");
    else { assert.equal(col, "41"); assert.ok(JUNK.includes(glyph)); }
  });
});

test("locked characters show true glyphs in the static ramp", () => {
  const t = parse(make([1, 2, 3, 10]).render(0, { cursor: true, glitch: 0 }));
  assert.equal(t[2], "196\tO");
  assert.equal(t[3], "208\tV");
  assert.equal(t[4], "214\tE");
  assert.equal(t[11], "39\tI");
  assert.equal(t[5].split("\t")[0], "41");
});

test("a glitch turns exactly one locked character back to junk", () => {
  const all = [...MSG].map((ch, i) => (ch === " " ? 0 : i + 1)).filter(Boolean);
  const t = parse(make(all).render(0, { cursor: true, glitch: 5 }));
  [...MSG].forEach((ch, i) => {
    const [col, glyph] = t[i + 2].split("\t");
    if (ch === " ") return;
    if (i === 4) { assert.equal(col, "41"); assert.ok(JUNK.includes(glyph)); }
    else { assert.equal(col, String(CLASSIC_RAMP[i % 12])); assert.equal(glyph, ch); }
  });
});

test("cursor on/off differ only in the last cell; distress turns it red", () => {
  const on = parse(make([]).render(0, { cursor: true, glitch: 0 }));
  const off = parse(make([]).render(0, { cursor: false, glitch: 0 }));
  assert.equal(on.length, off.length);
  assert.deepEqual(on.slice(0, -1), off.slice(0, -1));
  assert.equal(off.at(-1), "-\t ");
  const red = make([]).render(0, { cursor: true, glitch: 0, cursorColour: 196 });
  assert.ok(red.includes("\x1b[38;5;196m ▊"));
});

test("locks at the original pace (2 chars / 70ms) and settles", () => {
  const d = new Decrypt({ style: "classic" });
  d.set(MSG, 0);
  d.tick(70);
  assert.equal(d.locked.filter(Boolean).length, 2);
  d.tick(700);
  assert.ok(d.settled);
  assert.equal(d.locked.filter(Boolean).length, 18);
});

test("re-keying keeps locks only where both messages agree", () => {
  const d = new Decrypt({ style: "classic" });
  d.set("ACCESSING PROBE", 0);
  d.finish(1);
  d.set("ACCESSING READ_TERMINAL", 2);
  assert.ok(d.locked.slice(0, 9).every(Boolean));      // "ACCESSING" carried over
  assert.ok(!d.locked[10]);                             // P → R restarts as junk
  assert.ok(!d.settled);
});

test("width is bounded: junk never changes the line length", () => {
  const d = new Decrypt();
  d.set("HOLD YOUR HORSES. THIS LINE IS LONG.", 0);
  for (let t = 0; t < 2000; t += 33) {
    d.tick(t);
    const plain = d.render(t, { max: 12 }).replace(/\x1b\[[0-9;]*m/g, "");
    assert.equal([...plain].length, 2 + 12 + 2);
  }
});
