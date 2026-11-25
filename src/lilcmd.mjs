// lilcmd.mjs — the answer contract: at most one command block, always last.
//
// Accepts the fenced ```lilcmd form the persona is told to use AND the
// <lilcmd>…</lilcmd> tags DeepSeek emits in the wild anyway (multi-line or on
// a single line). The LAST well-formed block wins. If you change the
// contract, change pi/SYSTEM.md too.

export const OPEN_FENCE = /^\s*```lilcmd\s*$/;
export const OPEN_TAG = /^\s*<lilcmd>\s*$/;
export const CLOSE_FENCE = /^\s*```\s*$/;
export const CLOSE_TAG = /^\s*<\/lilcmd>\s*$/;
export const ONE_LINE_TAG = /^\s*<lilcmd>(.+)<\/lilcmd>\s*$/;

// The zsh original split with "${(f)text}", which drops empty lines. Kept so
// stripped answers are byte-identical to what the old wrapper produced.
export const splitLines = (text) => text.split("\n").filter((l) => l !== "");

// → { start, end, body[] } (0-based, inclusive) or null.
export function findBlock(lines) {
  let last = -1;
  let kind = "";
  for (let i = 0; i < lines.length; i++) {
    if (OPEN_FENCE.test(lines[i])) { last = i; kind = "fence"; }
    else if (OPEN_TAG.test(lines[i])) { last = i; kind = "tag"; }
    else if (ONE_LINE_TAG.test(lines[i])) { last = i; kind = "inline"; }
  }
  if (last < 0) return null;
  if (kind === "inline") {
    return { start: last, end: last, body: [lines[last].match(ONE_LINE_TAG)[1].trim()] };
  }
  const close = kind === "fence" ? CLOSE_FENCE : CLOSE_TAG;
  for (let j = last + 1; j < lines.length; j++) {
    if (close.test(lines[j])) return { start: last, end: j, body: lines.slice(last + 1, j) };
  }
  return null;
}

// The command to offer in the scratchpad, or "" when there is none.
export function extractCmd(text) {
  const block = findBlock(splitLines(text));
  return block ? block.body.join("\n") : "";
}

// The answer with the command block removed and trailing blank lines trimmed.
export function stripCmd(text) {
  const lines = splitLines(text);
  const block = findBlock(lines);
  if (!block) return text;
  const out = lines.filter((_, i) => i < block.start || i > block.end);
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return out.join("\n");
}

// Commands that deserve a second look before they run. Display + a confirm
// tap only — nothing here blocks anything.
const RISKY = [
  /\brm\s+(-[a-zA-Z]*[rRf][a-zA-Z]*\b|--recursive|--force)/,
  /\bdd\b[^|;&]*\bof=/,
  /\bmkfs(\.\w+)?\b/,
  /\b(shred|wipefs|fdisk|parted|sgdisk)\b/,
  /\bch(mod|own)\s+(-[a-zA-Z]*R|--recursive)/,
  /\bkill(all)?\s+(-9|-KILL|-s\s*(9|KILL))\b/,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+[^|;&]*(--force|-f\b))/,
  /\b(shutdown|reboot|poweroff|halt)\b/,
  />\s*\/dev\/(sd|nvme|disk|hd)/,
  /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|fi)?sh\b/,
  /\bdiskutil\s+(erase|partition|zero|secureErase)/i,
  /\btruncate\s+-s\s*0\b/,
  /:\(\)\s*\{.*\};\s*:/,
];

export const isRisky = (cmd) => RISKY.some((re) => re.test(cmd));
