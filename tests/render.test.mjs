// render.test.mjs — the answer screen must not drift.
//
// tests/golden/*.ans were produced by the ORIGINAL zsh implementation
// (_lil_render / _lil_scratchpad_box in lil.zsh at 06c2b3d). The Node
// renderer has to reproduce them byte for byte, both when rendering a whole
// answer and when it arrives a few characters at a time.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { setCaps, stripAnsi } from "../src/ui/ansi.mjs";
import { render, scratchpadBox, hintRow, AnswerStream, inline, wrapProse } from "../src/render.mjs";
import { width } from "../src/ui/ansi.mjs";
import { stripCmd, extractCmd } from "../src/lilcmd.mjs";

setCaps({ color: true, truecolor: false });

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = fs.readdirSync(path.join(here, "fixtures")).filter((f) => f.endsWith(".md"));
const golden = (name) => fs.readFileSync(path.join(here, "golden", name), "utf8");
const WIDTHS = [24, 40, 80, 100, 140];

for (const file of fixtures) {
  const name = file.replace(/\.md$/, "");
  const text = fs.readFileSync(path.join(here, "fixtures", file), "utf8").replace(/\n+$/, "");

  test(`${name}: command extraction matches zsh`, () => {
    assert.equal(extractCmd(text), golden(`${name}.cmd.txt`));
  });

  for (const w of WIDTHS) {
    test(`${name} @${w}: batch render is byte-identical to zsh`, () => {
      assert.equal(render(stripCmd(text), w) + "\n", golden(`${name}.render.${w}.ans`));
    });

    test(`${name} @${w}: streamed render is byte-identical to zsh`, () => {
      for (const chunk of [1, 7, 64]) {
        const s = new AnswerStream(w);
        const out = [];
        for (let i = 0; i < text.length; i += chunk) out.push(...s.write(text.slice(i, i + chunk)));
        out.push(...s.end());
        assert.equal(out.join("\n") + "\n", golden(`${name}.render.${w}.ans`), `chunk size ${chunk}`);
      }
    });

    if (extractCmd(text)) {
      test(`${name} @${w}: scratchpad box is byte-identical to zsh`, () => {
        const box = [...scratchpadBox(extractCmd(text), w), hintRow({ hasCmd: true, mac: true })];
        assert.equal(box.join("\n") + "\n", golden(`${name}.box.${w}.ans`));
      });
    }
  }
}

test("eza fixture: no literal markdown leaks, quotes survive", () => {
  const text = fs.readFileSync(path.join(here, "fixtures", "eza-answer.md"), "utf8");
  const out = render(stripCmd(text), 80);
  assert.ok(!out.includes("`") && !out.includes("<lilcmd>") && !out.includes("brew install eza"));
  assert.ok(out.includes("┃") && out.includes("graduate to"));
  const src = "```sh\nbrew install eza && echo 'alias ls=\"eza -la --group-directories-first\"' >> ~/.zshrc && source ~/.zshrc\n```";
  const plain = stripAnsi(render(src, 80)).replace(/[\s┃]/g, "");
  assert.equal(plain, src.split("\n")[1].replace(/\s/g, ""));
});

// --- deliberate improvements over the zsh renderer -------------------------

test("bold that straddles a wrap point stays styled on both lines", () => {
  const lines = inline(["before **bold starts", "and ends** after"]);
  assert.equal(stripAnsi(lines.join("\n")), "before bold starts\nand ends after");
  assert.match(lines[0], /\x1b\[1m\x1b\[38;5;84mbold starts\x1b\[0m$/);
  assert.match(lines[1], /^\x1b\[1m\x1b\[38;5;84mand ends\x1b\[0m after$/);
});

test("italics straddle a wrap only when they hug words; a lone * stays literal", () => {
  assert.equal(stripAnsi(inline(["some *emphasis that", "wraps* here"]).join(" ")), "some emphasis that wraps here");
  assert.equal(stripAnsi(inline(["match *.txt and", "also *.md files"]).join(" ")), "match *.txt and also *.md files");
});

test("code inside bold loses its backticks and turns amber", () => {
  const [line] = inline(["use **`ss`** here"]);
  assert.equal(stripAnsi(line), "use ss here");
  assert.ok(line.includes("\x1b[38;5;214mss"));
});

test("headers drop inline markers", () => {
  assert.ok(stripAnsi(render("## Using `ss` **now**", 80)).includes("◆ USING SS NOW"));
});

test("blank lines inside a code fence survive", () => {
  const out = stripAnsi(render("```\na\n\nb\n```", 80)).split("\n");
  assert.deepEqual(out.slice(0, 3), ["  ┃ a", "  ┃ ", "  ┃ b"]);
});

test("LIL_PARA_GAP: paragraphs can be given air", () => {
  assert.equal(stripAnsi(render("one\n\ntwo", 80)), "  one\n  two");
  assert.equal(stripAnsi(render("one\n\ntwo", 80, { paraGap: true })), "  one\n\n  two");
});

test("wrapProse never splits an inline code span", () => {
  const lines = wrapProse("run `a b c d e f g h` now", 12);
  assert.ok(lines.includes("`a b c d e f g h`"));
});

// --- streaming edge cases ---------------------------------------------------

const stream = (text, w = 80) => {
  const s = new AnswerStream(w);
  return stripAnsi([...s.write(text), ...s.end()].join("\n"));
};

test("stream: the trailing command block is held back for the scratchpad", () => {
  assert.equal(stream("Do it.\n\n```lilcmd\nls -la\n```\n"), "  Do it.");
  assert.equal(stream("Do it.\n<lilcmd>\nls -la\n</lilcmd>"), "  Do it.");
  assert.equal(stream("Do it.\n<lilcmd>ls -la</lilcmd>\n"), "  Do it.");
});

test("stream: prose after the block still prints, the block stays hidden", () => {
  assert.equal(stream("Above.\n```lilcmd\nls -la\n```\nBelow."), "  Above.\n  Below.");
});

test("stream: an unterminated block is not a command, so it is shown", () => {
  const out = stream("Above.\n```lilcmd\nls -la\n");
  assert.ok(out.includes("ls -la"));
  assert.equal(extractCmd("Above.\n```lilcmd\nls -la\n"), "");
});

test("stream: with two blocks the first is shown, the last is the command", () => {
  const text = "```lilcmd\nfirst\n```\nthen\n```lilcmd\nsecond\n```";
  assert.ok(stream(text).includes("first"));
  assert.ok(!stream(text).includes("second"));
  assert.equal(extractCmd(text), "second");
});

test("stream: a new text block starts on its own line", () => {
  const s = new AnswerStream(80);
  const out = [...s.write("Let me check."), ...s.breakLine(), ...s.write("Found it."), ...s.end()];
  assert.equal(stripAnsi(out.join("\n")), "  Let me check.\n  Found it.");
});

test("scratchpad box: every stamp keeps the box square", () => {
  for (const stamp of ["AWAITING ORDERS", "EXECUTING", "COPIED", "⚠ THIS ONE BITES", "PRESS RUN AGAIN TO CONFIRM"]) {
    for (const w of [60, 80, 100]) {
      const widths = scratchpadBox("ls -la", w, { stamp }).map((l) => [...stripAnsi(l)].length);
      assert.deepEqual(widths, [w, w, w], `${stamp} @${w}`);
    }
  }
});

test("hint row: ⌘ chords are advertised on macOS only", () => {
  assert.ok(stripAnsi(hintRow({ hasCmd: true, mac: true })).includes("⌘⏎"));
  assert.equal(stripAnsi(hintRow({ hasCmd: true, mac: false })), "    [⏎ dismiss]  [^R RUN]  [^Y copy]  [✏ type to reply]");
  assert.equal(stripAnsi(hintRow({ hasCmd: false })), "    [⏎ dismiss]  [✏ type to reply]");
});

// --- tables -----------------------------------------------------------------

const TABLE = [
  "Intro line.",
  "| Color | Meaning |",
  "|---|---|",
  "| bold blue | directory |",
  "| magenta / purple | images & video |",
  "| plain/default | regular file with `a | b` in it |",
  "After.",
].join("\n");

test("tables: aligned columns, header rule, no raw pipes, set off by blank lines", () => {
  const out = stripAnsi(render(TABLE, 80)).split("\n");
  assert.deepEqual(out, [
    "  Intro line.",
    "",
    "  Color             Meaning",
    "  ────────────────  ─────────────────────────────",
    "  bold blue         directory",
    "  magenta / purple  images & video",
    "  plain/default     regular file with a | b in it",
    "",
    "  After.",
  ]);
});

test("tables: a cell that only names a colour is painted in it", () => {
  const out = render(TABLE, 80);
  assert.ok(out.includes("\x1b[1m\x1b[38;5;75mbold blue\x1b[0m"));
  assert.ok(out.includes("\x1b[38;5;170mmagenta\x1b[0m / \x1b[38;5;141mpurple\x1b[0m"));
  assert.ok(!out.includes("\x1b[38;5;75mplain"));
});

test("tables: wide tables wrap inside their columns and never exceed the width", () => {
  const wide = "| Key | What it does |\n|:--|--:|\n| `--icons=auto` | " + "shows a glyph per file type when the output is a terminal ".repeat(3) + "|";
  for (const w of [40, 60, 100]) {
    const lines = stripAnsi(render(wide, w)).split("\n").filter(Boolean);
    assert.ok(lines.length > 3, `wrapped @${w}`);
    for (const l of lines) assert.ok(width(l) <= w - 2, `${width(l)} > ${w - 2}: ${l}`);
  }
});

test("tables: streamed output equals batch output; pipes without a rule stay prose", () => {
  for (const chunk of [1, 5, 40]) {
    const s = new AnswerStream(80);
    const out = [];
    for (let i = 0; i < TABLE.length; i += chunk) out.push(...s.write(TABLE.slice(i, i + chunk)));
    out.push(...s.end());
    assert.equal(out.join("\n"), render(TABLE, 80));
  }
  assert.equal(stripAnsi(render("| not | a table |\nplain", 80)), "  | not | a table |\n  plain");
});
