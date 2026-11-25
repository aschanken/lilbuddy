// shells.test.mjs — the zsh / bash / fish wrappers and the installer.
// The wrappers are tested against a stub engine that only writes a handoff
// file, which is all they depend on.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const has = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;

// A fake LIL_HOME whose "engine" hands back whatever STUB_ACTION says.
function stubHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lil-stub-"));
  fs.mkdirSync(path.join(home, "src"));
  fs.writeFileSync(path.join(home, "src", "cli.mjs"), `
    import fs from "node:fs";
    fs.writeFileSync(process.env.STUB_SEEN, JSON.stringify({ argv: process.argv.slice(2), shell: process.env.LIL_SHELL, edit: process.env.LIL_EDIT }));
    if (process.env.STUB_ACTION) fs.writeFileSync(process.env.LIL_HANDOFF, process.env.STUB_ACTION + "\\n" + process.env.STUB_CMD + "\\n");
    process.exitCode = Number(process.env.STUB_RC || 0);
  `);
  return home;
}

function runShell(shell, args, script, env) {
  const home = stubHome();
  const seen = path.join(home, "seen.json");
  const r = spawnSync(shell, [...args, script], {
    encoding: "utf8", cwd: "/",
    env: { PATH: process.env.PATH, HOME: home, LIL_HOME: home, STUB_SEEN: seen, TMPDIR: home, ...env },
  });
  const left = fs.readdirSync(home).filter((f) => f.startsWith("lil-handoff"));
  return { ...r, seen: fs.existsSync(seen) ? JSON.parse(fs.readFileSync(seen, "utf8")) : null, left };
}

test("zsh: RUN executes in the calling shell, lands in history, globs are left alone", { skip: !has("zsh") }, () => {
  // Sourced twice on purpose (re-sourcing .zshrc must not break the alias).
  // Run from a file: `zsh -c` parses its whole string before any alias exists.
  const script = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lil-zsh-")), "t.zsh");
  fs.writeFileSync(script, [
    `source ${repo}/shell/lil.zsh`,
    `source ${repo}/shell/lil.zsh`,
    "lil what does *.nope match?",
    'print -r -- "pwd=$PWD mark=$LIL_MARK rc=$?"',
  ].join("\n") + "\n");
  const r = runShell("zsh", ["-f"], script,
    { STUB_ACTION: "run", STUB_CMD: "cd /tmp && LIL_MARK=vault111" });
  assert.match(r.stdout, /pwd=\/tmp mark=vault111 rc=0/, r.stderr);
  assert.deepEqual(r.seen, { argv: ["what", "does", "*.nope", "match?"], shell: "zsh", edit: "1" });
  assert.deepEqual(r.left, []);
});

test("zsh: no handoff → the engine's exit code comes back; legacy root lil.zsh still loads", { skip: !has("zsh") }, () => {
  const r = runShell("zsh", ["-f", "-c"], `source ${repo}/lil.zsh; lil hi; print -r -- "rc=$? pwd=$PWD"`, { STUB_RC: "2" });
  assert.match(r.stdout, /rc=2 pwd=\/$/m, r.stderr);
  assert.deepEqual(r.left, []);
});

test("bash: RUN executes in the calling shell and lands in history", { skip: !has("bash") }, () => {
  const r = runShell("bash", ["--norc", "-c"],
    `set -o history; source ${repo}/shell/lil.bash; lil go; echo "pwd=$PWD mark=$LIL_MARK rc=$?"; history 1`,
    { STUB_ACTION: "run", STUB_CMD: "cd /tmp && LIL_MARK=vault111" });
  assert.match(r.stdout, /pwd=\/tmp mark=vault111 rc=0/, r.stderr);
  assert.equal(r.seen.shell, "bash");
  assert.deepEqual(r.left, []);
});

test("fish: RUN executes in the calling shell", { skip: !has("fish") }, () => {
  const r = runShell("fish", ["--no-config", "-c"],
    `source ${repo}/shell/lil.fish; lil go; echo "pwd=$PWD mark=$LIL_MARK"`,
    { STUB_ACTION: "run", STUB_CMD: "cd /tmp; and set -g LIL_MARK vault111" });
  assert.match(r.stdout, /pwd=\/tmp mark=vault111/, r.stderr);
  assert.deepEqual(r.seen, { argv: ["go"], shell: "fish", edit: "1" });
  assert.deepEqual(r.left, []);
});

test("bin/lil resolves its home through a symlink", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lil-bin-"));
  fs.symlinkSync(path.join(repo, "bin", "lil"), path.join(dir, "lil"));
  const r = spawnSync(path.join(dir, "lil"), ["--version"], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.match(r.stdout, /^lil \d/, r.stderr);
});

// --- installer ---------------------------------------------------------------

function install(home, args = [], env = {}) {
  return spawnSync("sh", [path.join(repo, "install.sh"), "--no-deps", ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: home, SHELL: "/bin/zsh", NO_COLOR: "1", ...env },
  });
}
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);

test("install.sh: wires zsh, bash and fish; is idempotent; uninstall restores every file", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lil-home-"));
  fs.mkdirSync(path.join(home, ".config", "fish"), { recursive: true });
  fs.writeFileSync(path.join(home, ".bashrc"), "export FOO=1\n");
  fs.writeFileSync(path.join(home, ".zshrc"), "# my zshrc");

  const first = install(home, ["--shell", "all"]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const second = install(home, ["--shell", "all"]);
  assert.equal(second.status, 0);

  const zshrc = read(path.join(home, ".zshrc"));
  assert.equal(zshrc.split("# >>> lilbuddy >>>").length, 2, "exactly one block after two runs");
  assert.ok(zshrc.startsWith("# my zshrc\n# >>> lilbuddy >>>\n"));
  assert.ok(zshrc.includes(`. "${repo}/shell/lil.zsh"`));
  assert.ok(read(path.join(home, ".bashrc")).includes(`. "${repo}/shell/lil.bash"`));
  assert.ok(read(path.join(home, ".config/fish/conf.d/lil.fish")).includes(`${repo}/shell/lil.fish`));
  assert.equal(fs.readlinkSync(path.join(home, ".local/bin/lil")), path.join(repo, "bin/lil"));
  assert.ok(fs.existsSync(path.join(home, ".cache/lil")));

  // The block it wrote really does define `lil` in a fresh shell.
  if (has("bash")) {
    const r = spawnSync("bash", ["--norc", "-c", `source ${home}/.bashrc; type -t lil`], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: home } });
    assert.equal(r.stdout.trim(), "function");
  }

  const un = install(home, ["--uninstall"]);
  assert.equal(un.status, 0);
  assert.equal(read(path.join(home, ".bashrc")), "export FOO=1\n");
  assert.equal(read(path.join(home, ".zshrc")), "# my zshrc\n");
  assert.equal(read(path.join(home, ".config/fish/conf.d/lil.fish")), null);
  assert.ok(!fs.existsSync(path.join(home, ".local/bin/lil")));
});

test("install.sh: oh-my-zsh gets a custom file instead of a .zshrc edit", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lil-home-"));
  fs.mkdirSync(path.join(home, ".oh-my-zsh", "custom"), { recursive: true });
  fs.writeFileSync(path.join(home, ".zshrc"), "# omz\n");
  assert.equal(install(home, ["--shell", "zsh"]).status, 0);
  assert.equal(read(path.join(home, ".zshrc")), "# omz\n");
  assert.equal(read(path.join(home, ".oh-my-zsh/custom/lil.zsh")), `source "${repo}/shell/lil.zsh"\n`);
  assert.equal(read(path.join(home, ".bashrc")), null, "--shell zsh touches nothing else");
});

test("install.sh: --dry-run changes nothing; --shell none only installs the launcher", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lil-home-"));
  fs.writeFileSync(path.join(home, ".bashrc"), "x\n");
  const dry = install(home, ["--dry-run", "--shell", "all"]);
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /would add a lilbuddy block/);
  assert.deepEqual(fs.readdirSync(home), [".bashrc"]);
  assert.equal(install(home, ["--shell", "none"]).status, 0);
  assert.equal(read(path.join(home, ".bashrc")), "x\n");
  assert.ok(fs.existsSync(path.join(home, ".local/bin/lil")));
});

test("install.sh runs under every POSIX shell on this machine", () => {
  for (const sh of ["dash", "bash", "zsh", "busybox"]) {
    if (!has(sh)) continue;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lil-home-"));
    const argv = sh === "busybox" ? ["sh"] : sh === "zsh" ? ["--emulate", "sh"] : [];
    const r = spawnSync(sh, [...argv, path.join(repo, "install.sh"), "--no-deps", "--shell", "bash"], {
      encoding: "utf8", env: { PATH: process.env.PATH, HOME: home, NO_COLOR: "1" },
    });
    assert.equal(r.status, 0, `${sh}: ${r.stdout}${r.stderr}`);
    assert.ok(read(path.join(home, ".bashrc")).includes("lilbuddy"), sh);
  }
});
