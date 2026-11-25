// sayings.mjs — the rotating pool of things Lil Buddy mutters while he works.
//
// The live pool is $LIL_RUNTIME/sayings.txt, seeded from the repo's
// sayings.txt. Every 5th run a detached child asks DeepSeek for five fresh
// lines, drops the five oldest and appends the new ones — the pool never
// grows. That child is never waited on and fails silently into sayings.log.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Sayings-pool refresh system prompt.
export const SAYINGS_PROMPT = `You write short spinner sayings for Lil Buddy, a Pip-Boy-flavored terminal
sysadmin assistant. Voice: a vulgar, hostile, profane vault operator who is
sick of this shit. Shocking and crude, heavy on real profanity (fuck, shit,
asshole, dickhead, bitch, bastard, etc.), at most one gag per line, wry and
mean but never bleak or error-like. The user sees these during normal, healthy
operation, never during a failure.

Examples of the register you are matching:
Hold your goddamn horses, asshole.
Crunching your shit, you impatient bastard.
Decrypting this cocksucking mess. Wait.
Working on it, dickhead. Eat glass.
Tell your mom I said hi, fuckface.
Fixing the fuck out of your PATH.

Write exactly 5 new sayings in this same voice. Each saying must be 20 to 60
characters long, plain sentence case, no numbering, no bullets, no markdown.
Each must be distinct in wording from the example sayings above and from any
sayings supplied in the user message. Use real profanity freely. Avoid
implying data loss or danger, avoid anything that reads like an error message.

Reply with ONLY a single JSON object, no other text, in exactly this shape:
{"sayings": ["first saying", "second saying", "third saying", "fourth saying", "fifth saying"]}`;

const readLines = (file) => {
  try { return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim()); } catch { return []; }
};

// Load the pool (seeding it on first use), bump the use counter, and kick a
// background refresh on every 5th use. Returns the sayings.
export function loadSayings({ home, runtime, env = process.env, refresh = true }) {
  const pool = path.join(runtime, "sayings.txt");
  let lines = readLines(pool);
  if (!lines.length) {
    lines = readLines(path.join(home, "sayings.txt"));
    if (lines.length) fs.writeFileSync(pool, lines.join("\n") + "\n");
  }
  if (refresh) {
    const useFile = path.join(runtime, "sayings.uses");
    let uses = 0;
    try { uses = Number(fs.readFileSync(useFile, "utf8")) || 0; } catch { /* first run */ }
    uses += 1;
    try { fs.writeFileSync(useFile, String(uses)); } catch { /* read-only runtime */ }
    if (uses % 5 === 0 && env.DEEPSEEK_API_KEY && lines.length) {
      try {
        const log = fs.openSync(path.join(runtime, "sayings.log"), "a");
        spawn(process.execPath, [fileURLToPath(import.meta.url), "--refresh", runtime], {
          detached: true, stdio: ["ignore", log, log], env,
        }).unref();
        fs.closeSync(log);
      } catch { /* never let flavour break the tool */ }
    }
  }
  return lines;
}

export function validSayings(candidates, existing) {
  const have = new Set(existing);
  const out = [];
  for (let s of candidates.slice(0, 5)) {
    if (typeof s !== "string") continue;
    s = s.replace(/[\t\r\n]/g, " ").trim();
    if (s.length < 8 || s.length > 70 || have.has(s)) continue;
    have.add(s);
    out.push(s);
  }
  return out;
}

export async function refreshPool(runtime, env = process.env) {
  const pool = path.join(runtime, "sayings.txt");
  const logFile = path.join(runtime, "sayings.log");
  const lock = path.join(runtime, "sayings.lock");
  try { if (fs.statSync(logFile).size > 10000) fs.writeFileSync(logFile, ""); } catch { /* no log yet */ }
  try { fs.mkdirSync(lock); } catch { return; }   // atomic lock; a stale one just skips a round
  try {
    const lines = readLines(pool);
    if (!lines.length || !env.DEEPSEEK_API_KEY) return;
    const examples = lines.slice(-12).join("\n");
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: 600,
        temperature: 1.3,
        messages: [
          { role: "system", content: SAYINGS_PROMPT },
          { role: "user", content: `Existing sayings — do not repeat any of these:\n${examples}\nReturn JSON now.` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const content = (await res.json()).choices?.[0]?.message?.content || "{}";
    const fresh = validSayings(JSON.parse(content).sayings || [], lines);
    if (!fresh.length) return;
    const next = [...lines.slice(fresh.length), ...fresh];
    const tmp = `${pool}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, next.join("\n") + "\n");
    fs.renameSync(tmp, pool);
  } catch (err) {
    console.error(`${new Date().toISOString()} refresh failed: ${err.message}`);
  } finally {
    try { fs.rmdirSync(lock); } catch { /* already gone */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === "--refresh" && process.argv[3]) {
  await refreshPool(process.argv[3]);
}
