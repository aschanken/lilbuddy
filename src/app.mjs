// app.mjs — one `lil` invocation, start to finish.
//
//   ask → live panel while pi works → answer streams in above the panel →
//   panel folds away → scratchpad (run / copy / edit / dismiss / follow-up)
//
// The answer screen left in the scrollback is the same one the zsh version
// printed. Everything animated lives in a redrawable region below it and is
// gone by the time the prompt comes back.

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";

import { PAL, width, sliceCells, fit } from "./ui/ansi.mjs";
import { Live, Keys, sleep } from "./ui/term.mjs";
import { Panel, header, headerLive } from "./ui/panel.mjs";
import { JUNK } from "./ui/decrypt.mjs";
import { AnswerStream, render, scratchpadBox, hintRow } from "./render.mjs";
import { extractCmd, stripCmd, isRisky } from "./lilcmd.mjs";
import { runPi, replay } from "./pi.mjs";
import { SCENARIOS } from "./demo.mjs";
import { loadSayings } from "./sayings.mjs";
import { maybeUpdate, takeNotice } from "./update.mjs";
import {
  snapshot, fingerprint, cachedNerd, hasNerdFont, writeClipboard, userVar, osKind, findPi, terminalName,
} from "./platform.mjs";

const now = () => performance.now();
const FRAME = 33;

const warn = (msg) => ` ${PAL.AMBER}⚠ ${msg}${PAL.RESET}`;

export class App {
  constructor({ home, runtime, env = process.env, out = process.stdout, input = process.stdin, demo = null }) {
    this.home = home;
    this.runtime = runtime;
    this.env = env;
    this.out = out;
    this.demo = demo;
    this.live = new Live(out);
    this.keys = new Keys(input);
    this.tty = Boolean(out.isTTY);
    this.interactive = this.tty && this.keys.interactive;
    this.mac = osKind() === "mac";
    this.shell = env.LIL_SHELL || "";
    this.handoff = env.LIL_HANDOFF || "";
    this.canEdit = Boolean(this.handoff) && env.LIL_EDIT === "1";
    this.timeoutMs = (Number(env.LIL_TIMEOUT_SECS) || 120) * 1000;
    this.heavyMs = (Number(env.LIL_HEAVY_SECS) || 25) * 1000;
    this.paraGap = env.LIL_PARA_GAP === "1";
    this.style = env.LIL_RAMP === "classic" ? "classic" : "phosphor";
    this.headerDone = false;
    this.history = [];
    this.nerd = cachedNerd(runtime) ?? true;
    this.model = "";
    try {
      const s = JSON.parse(fs.readFileSync(path.join(home, "pi", "settings.json"), "utf8"));
      this.model = String(s.defaultModel || "").replace(/^deepseek-/, "");
    } catch { /* cosmetic only */ }
  }

  get cols() { return this.live.cols; }

  // full: the five-row panel · compact: the one-line spinner · off: no motion
  get motion() {
    const want = this.env.LIL_MOTION || "";
    if (!this.tty || want === "off" || this.env.TERM === "dumb") return "off";
    if (want === "compact" || this.cols < 64 || this.live.rows < 14) return "compact";
    return "full";
  }

  write(line = "") { this.out.write(line + "\n"); }

  setScratchpad(open) {
    // Only WezTerm understands the user-var; tmux may be carrying it there.
    if (!this.tty) return;
    if (this.env.TMUX || this.env.WEZTERM_PANE || /wezterm/i.test(this.env.TERM_PROGRAM || "")) {
      this.out.write(userVar(open ? 1 : 0));
    }
  }

  // Things that would otherwise fail a second into the animation.
  preflight() {
    if (this.demo) return "";
    if (!findPi(this.env)) {
      return "pi isn't on your PATH — npm install -g @earendil-works/pi-coding-agent (or re-run install.sh), boss.";
    }
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(this.home, "pi", "settings.json"), "utf8"));
      const models = JSON.parse(fs.readFileSync(path.join(this.home, "pi", "models.json"), "utf8"));
      const key = models.providers?.[settings.defaultProvider]?.apiKey || "";
      if (/^\$[A-Za-z_]\w*$/.test(key) && !this.env[key.slice(1)]) {
        return `${key} isn't set in this shell — export it in your shell rc and try again, boss.`;
      }
    } catch { /* let pi report its own config problems */ }
    return "";
  }

  // -------------------------------------------------------------------------
  // One turn: prompt in → { ok, raw, cmd }.
  // -------------------------------------------------------------------------
  async turn(prompt) {
    const motion = this.motion;
    const stream = new AnswerStream(this.cols, { paraGap: this.paraGap });
    const pending = [];          // rendered lines waiting to be revealed
    let current = null;          // { line, w, shown }
    let finished = false;

    const sayings = loadSayings({ home: this.home, runtime: this.runtime, env: this.env, refresh: !this.demo });
    const panel = new Panel({ sayings, heavyMs: this.heavyMs, style: this.style, model: this.model });
    const t0 = now();
    panel.begin(t0);

    const liveHeader = () => (this.headerDone ? [] : [headerLive(now(), t0, this.nerd)]);
    const region = () => {
      const t = now();
      const top = current ? [this.#revealing(current, t)] : this.headerDone ? [""] : [];
      if (motion === "compact") return [...liveHeader(), ...(current ? top : []), ...panel.compact(t, this.cols)];
      return [...liveHeader(), ...top, ...(current ? [""] : []), ...panel.lines(t, this.cols)];
    };

    const commit = (lines) => {
      const permanent = this.headerDone ? lines : [header(this.nerd), ...lines];
      this.headerDone = true;
      if (motion === "off") { for (const l of permanent) this.write(l); return; }
      this.live.commit(permanent, []);
    };

    const frame = () => {
      const t = now();
      panel.tick(t, Math.min(this.cols, 100) - 26);
      // Reveal: a decrypt edge wipes each line in, and speeds up to match
      // however fast the model is actually writing.
      let budget = 14 + 26 * pending.length + (finished ? 60 : 0);
      const done = [];
      while (budget > 0) {
        if (!current) {
          if (!pending.length) break;
          const line = pending.shift();
          current = { line, w: width(line), shown: 0 };
        }
        const step = Math.min(budget, current.w - current.shown);
        current.shown += step;
        budget -= Math.max(step, 1);
        if (current.shown >= current.w) { done.push(current.line); current = null; }
      }
      if (done.length) commit(done);
      this.live.draw(region());
    };

    let ticker = null;
    if (motion !== "off") {
      this.live.begin();
      this.keys.start();
      this.live.draw(region());
      ticker = setInterval(frame, FRAME);
    } else if (!this.headerDone) {
      commit([]);
    }

    const onEvent = (ev) => {
      const t = now();
      switch (ev.type) {
        case "stage": panel.setStage(ev.stage, t); break;
        case "thinking": panel.thinking(ev.delta, t); break;
        case "text_break": pending.push(...stream.breakLine()); break;
        case "text": panel.wrote(ev.delta, t); pending.push(...stream.write(ev.delta)); break;
        case "tool_start": panel.toolStart(ev.id, ev.name, ev.args, t); break;
        case "tool_end": panel.toolEnd(ev.id, ev, t); break;
        case "usage": panel.setUsage(ev.output); break;
        case "response": panel.newResponse(); break;
        case "retry": panel.retry(ev.attempt, ev.max, t); break;
        default: break;
      }
    };

    // Context snapshots are taken BEFORE pi starts, so the model sees the
    // user's terminal rather than our own output.
    let handle;
    if (this.demo) {
      handle = replay({ timeline: SCENARIOS[this.demo].build(), onEvent, speed: Number(this.env.LIL_DEMO_SPEED) || 1 });
    } else {
      const [, fp] = await Promise.all([snapshot(this.runtime), fingerprint(this.runtime, this.shell)]);
      if (cachedNerd(this.runtime) !== null) this.nerd = cachedNerd(this.runtime);
      handle = runPi({
        prompt, home: this.home, runtime: this.runtime, fingerprint: fp,
        timeoutMs: this.timeoutMs, onEvent, env: this.env,
      });
    }

    // While he works: Esc / ^C stands him down, anything else just annoys him.
    this.keys.on((key) => {
      if (key.name === "esc" || key.name === "ctrl-c") handle.abort();
      else panel.poke(now());
    });

    const result = await handle.done;
    this.keys.on(null);
    pending.push(...stream.end());
    finished = true;

    const failed = result.aborted || result.timedOut || result.rc !== 0 || (result.failure && !result.sawText);
    const tDone = now();
    if (motion !== "off") {
      if (!result.aborted) panel.finish(failed ? "error" : "done", tDone, result.timedOut ? "LINK TIMED OUT" : undefined);
      // Let the last lines land and give the sign-off a beat to read.
      const hold = result.aborted ? 0 : failed ? 750 : 340;
      while (pending.length || current || now() - tDone < hold) await sleep(FRAME);
      // Switch him off: the picture collapses to a line, the line to nothing.
      if (motion === "full") {
        panel.powerOff(now());
        while (!panel.dark) await sleep(FRAME);
      }
      clearInterval(ticker);
      if (!this.headerDone) commit([]);
      this.live.draw([]);
    } else {
      commit(pending.splice(0));
    }

    if (result.aborted) {
      this.write(warn("Stood down — nothing was sent to your shell, boss."));
      return { ok: false, rc: 130 };
    }
    if (result.timedOut) {
      this.write(warn(`Timed out after ${Math.round(this.timeoutMs / 1000)}s — the vault is slow today. Retry, boss.`));
      return { ok: false, rc: 2 };
    }
    if (failed) {
      const why = (result.failure || result.errTail.split("\n").filter(Boolean).pop() || "").trim();
      this.write(warn(result.rc !== 0
        ? `pi exited (${result.rc}) — see ${path.join(this.runtime, "last.err")}. Retry, boss.`
        : "The vault link dropped before an answer came back. Retry, boss."));
      if (why) this.write(`   ${PAL.GRAY}${fit(why, Math.max(20, this.cols - 4))}${PAL.RESET}`);
      return { ok: false, rc: 2 };
    }
    return { ok: true, raw: stream.raw, cmd: extractCmd(stream.raw) };
  }

  // A line mid-reveal: the part already decrypted, then a short junk edge.
  #revealing(cur, t) {
    const edge = Math.min(3, cur.w - cur.shown);
    let junk = "";
    for (let i = 0; i < edge; i++) junk += JUNK[(Math.floor(t / 40) * 7 + i * 13 + cur.shown) % JUNK.length];
    return sliceCells(cur.line, cur.shown) + PAL.RESET + PAL.DIM + junk + PAL.RESET;
  }

  // -------------------------------------------------------------------------
  // Line editor for questions. Resolves to the text, or null on cancel.
  // -------------------------------------------------------------------------
  async readLine({ seed = "", colour = PAL.GREEN, above = [], placeholder = "" } = {}) {
    const chars = Array.from(seed);
    let cursor = chars.length;
    let recall = this.history.length;
    this.out.write("\x1b[?2004h");
    const draw = () => {
      const room = Math.max(8, this.cols - 6);
      // Keep the cursor in view on long lines by showing a window around it.
      let start = 0;
      while (width(chars.slice(start, cursor).join("")) > room - 1) start++;
      const visible = Array.from(fit(chars.slice(start).join(""), room));
      const at = cursor - start;
      const before = visible.slice(0, at).join("");
      const under = visible[at] ?? " ";
      const after = visible.slice(at + 1).join("");
      const body = chars.length || !placeholder
        ? `${colour}${before}\x1b[7m${under}\x1b[27m${after}`
        : `${colour}\x1b[7m \x1b[27m${PAL.GRAY}${placeholder}`;
      this.live.draw([...above, ` ${colour}› ${body}${PAL.RESET}`]);
    };
    try {
      for (;;) {
        draw();
        const key = await this.keys.next();
        switch (key.name) {
          case "enter": {
            const text = chars.join("").trim();
            return text || null;
          }
          case "esc": case "ctrl-c": case "ctrl-d": return null;
          case "char": chars.splice(cursor++, 0, key.ch); break;
          case "paste": {
            const ins = Array.from(key.text.replace(/\s*\r?\n\s*/g, " "));
            chars.splice(cursor, 0, ...ins); cursor += ins.length; break;
          }
          case "backspace": if (cursor > 0) chars.splice(--cursor, 1); break;
          case "delete": chars.splice(cursor, 1); break;
          case "left": cursor = Math.max(0, cursor - 1); break;
          case "right": cursor = Math.min(chars.length, cursor + 1); break;
          case "home": case "ctrl-a": cursor = 0; break;
          case "end": case "ctrl-e": cursor = chars.length; break;
          case "ctrl-u": chars.splice(0, cursor); cursor = 0; break;
          case "ctrl-k": chars.splice(cursor); break;
          case "ctrl-w": {
            let i = cursor;
            while (i > 0 && chars[i - 1] === " ") i--;
            while (i > 0 && chars[i - 1] !== " ") i--;
            chars.splice(i, cursor - i); cursor = i; break;
          }
          case "up": case "down": {
            recall = Math.max(0, Math.min(this.history.length, recall + (key.name === "up" ? -1 : 1)));
            const text = Array.from(this.history[recall] || "");
            chars.splice(0, chars.length, ...text); cursor = chars.length; break;
          }
          default: break;
        }
      }
    } finally {
      this.out.write("\x1b[?2004l");
    }
  }

  // -------------------------------------------------------------------------
  // Scratchpad. Resolves to { action: "dismiss" | "run" | "edit" | "ask", … }.
  // -------------------------------------------------------------------------
  async scratchpad(cmd) {
    const risky = cmd ? isRisky(cmd) : false;
    const idle = risky ? { stamp: "⚠ THIS ONE BITES", tone: "red" } : { stamp: "AWAITING ORDERS", tone: "amber" };
    const hints = hintRow({ hasCmd: Boolean(cmd), mac: this.mac, edit: this.canEdit });
    const box = (o) => (cmd ? scratchpadBox(cmd, this.cols, o) : []);
    const settle = (o) => { this.live.draw(box(o)); this.live.freeze(); };

    this.live.begin();
    this.keys.start();
    if (cmd && this.motion === "full") {
      for (let i = 1; i <= 5; i++) { this.live.draw(box({ ...idle, reveal: i / 5 })); await sleep(24); }
    }
    let armed = 0;
    for (;;) {
      const state = armed ? { stamp: "PRESS RUN AGAIN TO CONFIRM", tone: "red" } : idle;
      this.live.draw([...box(state), hints]);
      // An armed RUN stands down by itself after four seconds.
      let disarm = null;
      let key = await Promise.race([
        this.keys.next(),
        new Promise((resolve) => { if (armed) disarm = setTimeout(() => resolve({ name: "disarm" }), 4000); }),
      ]);
      clearTimeout(disarm);
      if (key.name === "disarm") { this.keys.on(null); armed = 0; continue; }
      if (key.name === "char" && cmd) {
        const map = { r: "ctrl-r", R: "ctrl-r", c: "ctrl-y", C: "ctrl-y", y: "ctrl-y", Y: "ctrl-y", q: "esc", Q: "esc" };
        if (map[key.ch]) key = { name: map[key.ch] };
      }
      switch (key.name) {
        case "enter": case "esc": case "ctrl-c": case "ctrl-d":
          if (cmd) settle({ stamp: "DISMISSED", tone: "gray" }); else this.live.clear();
          return { action: "dismiss" };
        case "ctrl-r":
          if (!cmd) break;
          if (risky && !armed) { armed = 1; break; }
          settle({ stamp: "EXECUTING", tone: "green" });
          return { action: "run" };
        case "ctrl-y": {
          if (!cmd) break;
          const how = await writeClipboard(cmd, this.out);
          settle({ stamp: how ? "COPIED" : "COPY FAILED", tone: how ? "green" : "red" });
          this.write(how
            ? `${PAL.GREEN} ☑ copied — go get 'em, boss.${PAL.RESET}`
            : warn("No clipboard tool here — install wl-clipboard or xclip, boss."));
          return { action: "copy" };
        }
        case "ctrl-e":
          if (!cmd || !this.canEdit) break;
          settle({ stamp: "ON YOUR PROMPT", tone: "green" });
          return { action: "edit" };
        case "char": case "paste": {
          armed = 0;
          const seed = key.name === "char" ? key.ch : key.text.replace(/\s*\r?\n\s*/g, " ");
          const above = box(idle);
          const text = await this.readLine({ seed, colour: cmd ? PAL.AMBER : PAL.GREEN, above });
          if (text === null) break;
          const asked = ` ${cmd ? PAL.AMBER : PAL.GREEN}› ${text}${PAL.RESET}`;
          this.live.draw([...box({ stamp: "SHELVED", tone: "gray" }), asked]);
          this.live.freeze();
          return { action: "ask", text };
        }
        default: break;
      }
    }
  }

  // -------------------------------------------------------------------------
  async run(question) {
    let prompt = question;
    fs.mkdirSync(this.runtime, { recursive: true });
    fs.rmSync(path.join(this.runtime, "session"), { force: true });   // fresh conversation per invocation
    if (this.handoff) fs.rmSync(this.handoff, { force: true });

    if (!prompt) {
      if (!this.interactive) {
        this.write(warn('lil needs a prompt, boss: lil "how do I …"'));
        return 1;
      }
      // Bare `lil`: ask right here, no shell quoting to fight.
      if (cachedNerd(this.runtime) === null) this.nerd = await hasNerdFont(terminalName());
      this.write(header(this.nerd));
      this.headerDone = true;
      this.live.begin();
      this.keys.start();
      prompt = await this.readLine({ placeholder: "ask me anything, boss — Esc to bail" });
      if (prompt === null) { this.live.clear(); return 0; }
      this.live.draw([` ${PAL.GREEN}› ${prompt}${PAL.RESET}`]);
      this.live.freeze();
    }

    const problem = this.preflight();
    if (problem) {
      if (!this.headerDone) this.write(header(this.nerd));
      this.write(warn(problem));
      return 2;
    }

    // Self-update: a notice if the last run pulled something, and (at most
    // daily) a detached check for the next one. Never waited on.
    const updated = this.demo ? "" : takeNotice(this.runtime);
    if (!this.demo) maybeUpdate({ home: this.home, runtime: this.runtime, env: this.env });

    this.setScratchpad(true);
    try {
      for (;;) {
        this.history.push(prompt);
        const res = await this.turn(prompt);
        if (!res.ok) return res.rc;
        if (!this.interactive) {
          // Nobody to press keys: show the command and leave.
          if (res.cmd) for (const l of scratchpadBox(res.cmd, this.cols)) this.write(l);
          return 0;
        }
        const act = await this.scratchpad(res.cmd);
        if (act.action === "ask") { prompt = act.text; continue; }
        if (act.action === "run" || act.action === "edit") return this.#handOver(act.action, res.cmd);
        return 0;
      }
    } finally {
      this.setScratchpad(false);
      this.keys.stop();
      this.live.end();
      if (updated && this.tty) this.write(`${PAL.GRAY} ↑ lil ${fit(updated, Math.max(20, this.cols - 8))}${PAL.RESET}`);
    }
  }

  // "Run" must happen in the user's own shell (aliases, cd, history), so the
  // shell wrapper does it: we only leave the order in the handoff file. With
  // no wrapper (bare bin/lil) a child shell is the best available.
  #handOver(action, cmd) {
    this.setScratchpad(false);
    this.keys.stop();
    this.live.end();
    if (this.handoff) {
      fs.writeFileSync(this.handoff, `${action}\n${cmd}\n`, { mode: 0o600 });
      return 0;
    }
    const shell = this.env.SHELL || "/bin/sh";
    const r = spawnSync(shell, ["-c", cmd], { stdio: "inherit" });
    return r.status ?? 1;
  }
}

// Plain, motionless rendering of a finished answer (used by tests and --plain).
export function renderAnswer(raw, cols) {
  const cmd = extractCmd(raw);
  const lines = [render(stripCmd(raw), cols)];
  if (cmd) lines.push(...scratchpadBox(cmd, cols));
  return lines.join("\n");
}
