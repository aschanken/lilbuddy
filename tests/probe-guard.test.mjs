// probe-guard.test.mjs — unit table for the read-only probe guard.
// Imports the REAL guard from pi/probe-guard.ts (Node 26 type-stripping).
// Run: node tests/probe-guard.test.mjs
import { guardProbe } from "../pi/probe-guard.ts";

const CASES = [
  // [command, expected, label]
  ["git --version", true, "ALLOW git --version"],
  ["lsof -nP -iTCP -sTCP:LISTEN", true, "ALLOW lsof listen"],
  ["ps aux | grep nginx 2>/dev/null", true, "ALLOW ps|grep w/ allowed redirect"],
  ["brew info eza", true, "ALLOW brew info"],
  ["man -k socket", true, "ALLOW man -k"],

  ["brew install eza", false, "BLOCK brew install"],
  ["git config user.name x", false, "BLOCK git config write"],
  ["rm -rf /tmp/x", false, "BLOCK rm not allowlisted"],
  ["echo hi > /tmp/f", false, "BLOCK redirection >"],
  ["python3 -c \"import os\"", false, "BLOCK interpreter -c"],
  ["sed -i '' s/a/b/ f", false, "BLOCK sed -i"],
  ["find . -exec rm {} \\;", false, "BLOCK find -exec"],
  ["true; brew install eza", false, "BLOCK true; brew install"],
  ["echo `whoami`", false, "BLOCK backtick"],

  // Extra coverage beyond the mandated 14.
  ["git config --get user.name", true, "ALLOW git config --get"],
  ["git config --list", true, "ALLOW git config --list"],
  ["brew --version", true, "ALLOW brew --version"],
  ["zsh --version", true, "ALLOW zsh --version"],
  ["npm view pi", true, "ALLOW npm view"],
  ["tmux display-message -p '#{session_name}'", true, "ALLOW tmux display-message"],
  ["ls | wc -l", true, "ALLOW ls | wc"],
  ["cat /etc/hosts | grep -v '^#' | head -5", true, "ALLOW cat|grep|head pipeline"],
  ["node --version", true, "ALLOW node --version"],
  ["python3 -V", true, "ALLOW python3 -V"],
  ["brew update", false, "BLOCK brew update (mutation)"],
  ["git push", false, "BLOCK git push"],
  ["git config --global user.name x", false, "BLOCK git config --global"],
  ["cat /etc/passwd > /tmp/out", false, "BLOCK cat redirection"],
  ["sudo ls", false, "BLOCK sudo"],
  ["echo $(date)", false, "BLOCK command substitution"],
  ["find . -delete", false, "BLOCK find -delete"],
  ["find . -ok rm {} \\;", false, "BLOCK find -ok"],
  ["awk '{system(\"ls\")}' f", false, "BLOCK awk system("],
  ["npm install lodash", false, "BLOCK npm install"],
  ["pip3 install requests", false, "BLOCK pip3 install"],
  ["launchctl load x.plist", false, "BLOCK launchctl load"],
  ["defaults write com.apple x y", false, "BLOCK defaults write"],
  ["bash -c 'rm -rf /tmp/x'", false, "BLOCK bash -c"],
  ["node -e 'process.exit()'", false, "BLOCK node -e"],
  ["xargs rm", false, "BLOCK xargs entirely"],
];

let pass = 0;
const failures = [];
for (const [cmd, expected, label] of CASES) {
  const { allowed } = guardProbe(cmd);
  const ok = allowed === expected;
  if (ok) {
    pass++;
  } else {
    failures.push(`FAIL ${label} -> allowed=${allowed} expected=${expected}  (cmd: ${cmd})`);
  }
}

for (const f of failures) console.log(f);
console.log(`${pass}/${CASES.length} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
