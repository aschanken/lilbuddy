// panel.mjs — the live console shown while Lil Buddy works.
//
//         ▄▄
//    ▄▄▄▄▄██▄▄▄▄▄     ☢ OVERSEER IS THINKING ▊        what he says   (decrypt line)
//   █            █    ┊ …so ss with -ltnp is the nat   what he thinks (live reasoning)
//  ██  ▀▀   ▀▀   ██   ▸ PROBE ss -ltnp | grep :8080 ✓  what he touches (tool calls)
//   █    ▄▄▄▄    █
//    ▀▀█▀▀▀▀▀▀█▀▀     ▁▂▅▇▃▁  00:04  318 tok           pulse, clock, tokens
//     ▀▀▀    ▀▀▀
//
// Nothing here is decorative timing: every row is driven by a real event from
// pi's JSON stream. The panel only ever lives in the redrawable region — it
// switches off like a CRT before the answer screen is final.

import { PAL, RGB, rgb, mix, width, fit, tail, pad, fmtClock, charWidth } from "./ansi.mjs";
import { Decrypt } from "./decrypt.mjs";
import { drawBuddy, SPRITE_W, SPRITE_ROWS } from "./sprite.mjs";

export const STAGE_MESSAGES = {
  start: "ESTABLISHING VAULT LINK",
  thinking: "OVERSEER IS THINKING",
  writing: "DECRYPTING RESPONSE",
};

export function stageMessage(stage) {
  if (stage.startsWith("tool:")) return `ACCESSING ${stage.slice(5).toUpperCase()}`;
  return STAGE_MESSAGES[stage] || STAGE_MESSAGES.start;
}

// What he says when you prod him mid-thought.
const POKES = [
  "HANDS OFF THE GLASS.",
  "POKE ME AGAIN. SEE WHAT HAPPENS.",
  "I'M WORKING HERE, BOSS.",
  "THAT KEY DOES NOTHING. LIKE YOU.",
  "MASHING KEYS WON'T SPEED UP PHYSICS.",
  "OW. RUDE.",
];

const TOOL_LABELS = {
  probe: ["PROBE", (a) => a?.command || ""],
  read_clipboard: ["CLIPBOARD", () => "reading what you copied"],
  read_terminal: ["TERMINAL", () => "reading your scrollback"],
  read: ["READ", (a) => a?.path || a?.file_path || ""],
};

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const BUCKET_MS = 180;
const BUCKETS = 14;
const GAP = 3;

export class Panel {
  constructor({ sayings = [], heavyMs = 25000, style = "phosphor", random = Math.random, model = "" } = {}) {
    this.sayings = sayings;
    this.heavyMs = heavyMs;
    this.random = random;
    this.model = model;
    this.speech = new Decrypt({ style, random });
    this.stage = "";
    this.started = 0;
    this.mood = "boot";
    this.moodSince = 0;
    this.override = null;       // { mood, until }
    this.finished = null;       // "done" | "error"
    this.dwellSince = 0;
    this.heavy = false;
    this.lastSaying = "";
    this.thought = "";
    this.thoughtShown = 0;
    this.thoughtAt = 0;
    this.tools = [];
    this.chars = 0;            // characters streamed in the current response
    this.usage = { base: 0, current: 0 };
    this.buckets = new Array(BUCKETS).fill(0);
    this.bucketAt = 0;
    this.offAt = 0;
  }

  begin(now) {
    this.started = now;
    this.moodSince = now;
    this.bucketAt = now;
    this.setStage("start", now);
  }

  get elapsed() { return this.last - this.started; }
  // Providers often report usage only when a response completes, so until
  // then the count is estimated from what has streamed (~4 chars per token).
  get tokens() {
    return this.usage.base + (this.usage.current || Math.round(this.chars / 4));
  }

  // --- events --------------------------------------------------------------

  setStage(stage, now) {
    // "done" is not a mood of its own: finish() decides how the run ended.
    if (stage === this.stage || stage === "done" || this.finished) return;
    this.stage = stage;
    this.#say(stageMessage(stage), now);
  }

  #say(msg, now) {
    this.speech.set(msg, now);
    this.dwellSince = 0;
    if (this.heavy) this.speech.append(" [HEAVY LOAD]", now);
  }

  #pulse(n, now) {
    this.#roll(now);
    this.buckets[BUCKETS - 1] += n;
    this.chars += n;
  }

  thinking(delta, now) {
    this.thought = (this.thought + delta).replace(/\s+/g, " ").replace(/^ /, "").slice(-2000);
    this.thoughtAt = now;
    this.#pulse(delta.length, now);
  }

  wrote(delta, now) { this.#pulse(delta.length, now); }

  toolStart(id, name, args, now) {
    const [label, detail] = TOOL_LABELS[name] || [name.toUpperCase(), () => ""];
    if (this.tools.some((t) => t.id === id)) return;
    this.tools.push({ id, label, detail: String(detail(args)).replace(/\s+/g, " "), start: now, status: "run" });
  }

  // He is waiting on the human to approve a probe: wide amber eyes until
  // settle() is called.
  ask(now) {
    this.override = { mood: "blocked", until: Infinity, since: now };
    this.#say("PERMISSION TO PROCEED, BOSS?", now);
  }
  settle(now) {
    this.override = null;
    this.#say(stageMessage(this.stage || "start"), now);
  }

  toolEnd(id, { isError = false, blocked = false, denied = false, durationMs } = {}, now) {
    const tool = this.tools.find((t) => t.id === id);
    if (!tool) return;
    tool.status = denied ? "denied" : blocked ? "blocked" : isError ? "error" : "ok";
    tool.ms = durationMs ?? now - tool.start;
    if (blocked) this.override = { mood: "blocked", until: now + 900, since: now };
  }

  // Provider usage is cumulative per assistant response, so bank it whenever a
  // new response starts.
  newResponse() {
    this.usage.base = this.tokens;
    this.usage.current = 0;
    this.chars = 0;
  }

  setUsage(output) {
    if (output > 0) this.usage.current = output;
  }

  retry(attempt, max, now) { this.#say(`LINK DROPPED — RETRY ${attempt}/${max}`, now); }

  poke(now) {
    if (this.finished) return;
    this.override = { mood: "poke", until: now + 1100, since: now };
    this.#say(POKES[Math.floor(this.random() * POKES.length)], now);
  }

  finish(kind, now, msg) {
    this.finished = kind;
    this.override = null;
    this.#setMood(kind, now);
    this.speech.set(msg || (kind === "done" ? "TRANSMISSION COMPLETE" : "LINK SEVERED"), now);
    // No time left to decrypt a sign-off: it lands whole and the ramp sweeps it.
    if (kind === "done") this.speech.finish(now);
  }

  // CRT power: he switches on when the run begins and off when it ends.
  powerOff(now) { this.offAt = now; }
  power(now) {
    if (this.offAt) return Math.max(0, 1 - (now - this.offAt) / 200);
    return Math.min(1, (now - this.started) / 240);
  }
  get dark() { return Boolean(this.offAt) && this.power(this.last) <= 0; }

  // --- frame ---------------------------------------------------------------

  #setMood(mood, now) {
    if (mood !== this.mood) { this.mood = mood; this.moodSince = now; }
  }

  #roll(now) {
    while (now - this.bucketAt >= BUCKET_MS) {
      this.buckets.shift();
      this.buckets.push(0);
      this.bucketAt += BUCKET_MS;
    }
  }

  tick(now, speechWidth = 60) {
    this.last = now;
    this.#roll(now);
    if (!this.finished) {
      if (!this.heavy && now - this.started > this.heavyMs) {
        this.heavy = true;
        this.speech.append(" [HEAVY LOAD]", now);
      }
      if (this.override && now >= this.override.until) this.override = null;
      let mood = { start: "boot", thinking: "think", writing: "write" }[this.stage] || "scan";
      if (this.heavy && (mood === "boot" || mood === "think")) mood = "heavy";
      if (this.override) mood = this.override.mood;
      this.#setMood(mood, this.override ? this.override.since : now);
      // A fully locked line dwells for two seconds, then one of the sayings
      // takes its place. Stage changes always cut in immediately. A pending
      // question to the human is never talked over.
      if (this.speech.settled && this.sayings.length && this.override?.until !== Infinity) {
        if (!this.dwellSince) this.dwellSince = now;
        else if (now - this.dwellSince >= 2000) {
          let pick = this.sayings[Math.floor(this.random() * this.sayings.length)];
          if (pick === this.lastSaying && this.sayings.length > 1) {
            pick = this.sayings[Math.floor(this.random() * this.sayings.length)];
          }
          this.lastSaying = pick;
          this.#say(fit(pick.toUpperCase(), Math.max(1, speechWidth - (this.heavy ? 13 : 0))), now);
        }
      }
    }
    this.speech.tick(now);
    // The ticker eases toward the newest thought instead of jumping to it.
    const lag = this.thought.length - this.thoughtShown;
    if (lag > 0) this.thoughtShown += Math.max(1, Math.ceil(lag * 0.22));
  }

  get distress() { return this.heavy || this.finished === "error"; }

  speechLine(now, max) {
    return PAL.BOLD + this.speech.render(now, { cursorColour: this.distress ? 196 : 214, max });
  }

  #ticker(now, w) {
    const age = now - this.thoughtAt;
    if (!this.thought || age > 2600 || this.finished) return "";
    const text = tail(this.thought.slice(0, this.thoughtShown), w - 2);
    const fade = Math.max(0, (age - 900) / 1700);
    const chars = Array.from(text);
    let out = rgb(mix(RGB.deep, RGB.ember, fade)) + "┊ ";
    chars.forEach((ch, i) => {
      const d = chars.length - 1 - i;      // distance from the fresh end
      // Phosphor persistence: the newest glyphs glow, the rest decay. Kept a
      // step dimmer than the speech line above so it never competes with it.
      const fresh = age < 400 && d < 2;
      const base = fresh ? RGB.green : d < 8 ? mix(RGB.green, RGB.dim, d / 8)
        : mix(RGB.dim, RGB.deep, Math.min(1, (d - 8) / 44));
      out += rgb(mix(base, RGB.ember, fade)) + ch;
    });
    return out + PAL.RESET;
  }

  #toolLine(tool, now, w) {
    let status;
    let statusW;
    if (tool.status === "run") {
      const s = SPIN[Math.floor(now / 80) % SPIN.length];
      status = `${PAL.AMBER}${s}`; statusW = 1;
    } else if (tool.status === "ok") {
      const ms = tool.ms >= 1000 ? `${(tool.ms / 1000).toFixed(1)}s` : `${Math.round(tool.ms)}ms`;
      status = `${PAL.GREEN}✓ ${PAL.GRAY}${ms}`; statusW = 2 + ms.length;
    } else if (tool.status === "blocked") {
      status = `${PAL.RED}✗ BLOCKED`; statusW = 9;
    } else if (tool.status === "denied") {
      status = `${PAL.AMBER}✗ DENIED`; statusW = 8;
    } else {
      status = `${PAL.RED}✗ failed`; statusW = 8;
    }
    const head = `▸ ${tool.label}`;
    const room = w - width(head) - 1 - statusW - 2;
    let detail = tool.detail;
    if (width(detail) > room) detail = room > 1 ? fit(detail, room - 1) + "…" : "";
    return `${PAL.AMBER}${head}${PAL.RESET} ${PAL.DIM}${pad(detail, Math.max(0, room))}${PAL.RESET}  ${status}${PAL.RESET}`;
  }

  #meta(now) {
    const peak = Math.max(24, ...this.buckets);
    let out = "";
    this.buckets.forEach((v, i) => {
      const level = v <= 0 ? 0 : Math.min(7, 1 + Math.floor((v / peak) * 6.999));
      const age = (BUCKETS - 1 - i) / (BUCKETS - 1);
      const colour = v <= 0 ? RGB.ember : mix(RGB.green, RGB.deep, age * 0.85);
      out += rgb(colour) + BARS[level];
    });
    const bits = [fmtClock(this.elapsed)];
    if (this.tokens > 0) bits.push(`${this.tokens} tok`);
    if (this.model) bits.push(this.model);
    return `${out}${PAL.RESET}  ${PAL.GRAY}${bits.join("  ")}${PAL.RESET}`;
  }

  // The full six-row panel for a terminal `cols` wide.
  lines(now, cols) {
    const W = Math.min(cols, 100);
    const textW = Math.max(10, W - 2 - SPRITE_W - GAP - 1);
    const buddy = drawBuddy(this.mood, now - this.moodSince, { distress: this.distress, power: this.power(now) });
    const tools = this.tools.slice(-2);
    const rows = this.offAt ? [] : [
      "",
      this.speechLine(now, textW - 4),
      this.#ticker(now, textW),
      tools[0] ? this.#toolLine(tools[0], now, textW) : "",
      tools[1] ? this.#toolLine(tools[1], now, textW) : "",
      this.#meta(now),
    ];
    const out = [];
    for (let r = 0; r < SPRITE_ROWS; r++) out.push(`  ${buddy[r]}${" ".repeat(GAP)}${rows[r] || ""}`);
    return out;
  }

  // One-line fallback for narrow or short terminals: the original spinner.
  compact(now, cols) {
    return [this.speech.render(now, { cursorColour: this.distress ? 196 : 214, max: Math.max(4, cols - 6) })];
  }
}

// ---------------------------------------------------------------------------
// Header. Its final form is byte-identical to the zsh original; while the
// panel is live a highlight sweeps across it now and then.
// ---------------------------------------------------------------------------
export function headerText(nerd = true) {
  return `╭─ ${nerd ? "󰚩" : "◉"}  LIL BUDDY ─ VAULT-TEC CERTIFIED ─╮`;
}

export function header(nerd = true) {
  return `${PAL.GREEN}${headerText(nerd)}${PAL.RESET}`;
}

export function headerLive(now, since, nerd = true) {
  const chars = Array.from(headerText(nerd));
  const t = now - since;
  const drawn = t < 220 ? Math.ceil((t / 220) * chars.length) : chars.length;
  const period = 2800;
  const sweep = ((t - 220) % period) / 18 - 4;   // highlight centre, in cells
  let out = "";
  let x = 0;
  for (let i = 0; i < drawn; i++) {
    const d = Math.abs(x - sweep);
    const hot = t > 220 && d < 3 ? 1 - d / 3 : 0;
    const edge = t < 220 && i >= drawn - 2 ? 1 : 0;
    out += rgb(mix(RGB.green, RGB.white, Math.max(hot, edge))) + chars[i];
    x += charWidth(chars[i]);
  }
  return out + PAL.RESET;
}
