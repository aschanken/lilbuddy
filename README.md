# Lil Buddy 🗄️

A Pip-Boy-flavored terminal sysadmin guru with a face: pi + DeepSeek, on macOS
and Linux, in zsh, bash or fish.

Type `lil how do I …` and a little CRT-headed robot switches on, thinks out
loud, pokes at your machine through a strictly read-only probe, and decrypts a
punchy answer onto your screen — with an interactive command scratchpad when
the answer is something you can run. A reference guru for shells, CLIs, and
*nix ops; not a coding agent.

![Lil Buddy answering a question](assets/demo.gif)

Don't have an API key handy? `lil --demo` plays the whole thing back offline.

## Features

- **He shows his work** — while pi runs, a live panel shows what is actually
  happening: the model's reasoning scrolling past as it is generated, every
  `probe` command he runs on your machine (and a red `✗ BLOCKED` when the
  read-only guard slaps one down), a token pulse, the clock. None of it is
  canned animation; every row is driven by pi's event stream.
- **He has moods** — eyes up while thinking, a visor sweep while probing, a
  wink when he's done, a squint and a red antenna under heavy load. Press a
  key while he's working and he'll tell you what he thinks of that.
- **Answers stream in** — each line decrypts onto the screen as the model
  writes it, then the panel switches off like a CRT. What's left in your
  scrollback is the same clean answer screen as always.
- **Command scratchpad** — when the answer ends in a `lilcmd` block, the
  command is offered in a framed box you can **run** (in *this* shell: your
  aliases, your cwd, your history), **copy**, **edit** on your prompt, or
  **dismiss** — or just keep typing to ask a follow-up in the same session.
- **This one bites** — destructive commands (`rm -rf`, `dd`, `mkfs`, forced
  pushes…) turn the box red and need a second tap of RUN.
- **No quoting gymnastics** — bare `lil` opens an input line; in zsh,
  `lil what does *.log match?` just works.
- **Terminal-aware** — a 24h fingerprint of your env (OS, shell, userland,
  init system, package manager, clipboard tool, tool versions) is appended to
  every prompt, so answers match this machine.
- **Context on demand** — clipboard and terminal scrollback are snapshotted at
  invocation and read by pi only if the question needs them.
- **Fully isolated** — its own `pi/` config dir (`PI_CODING_AGENT_DIR`); your
  main `~/.pi/agent` is never touched.
- **He looks; you decide** — pi's built-in `bash`/`edit`/`write` tools are
  disabled twice over. The only way he touches your machine is the guarded
  `probe` tool: read-only inspection commands (and `<tool> --version` /
  `--help`) just run; anything else stops and shows you the exact command,
  and runs only if you press `y`. `sudo` is always refused. The thing you
  actually asked for still arrives in the scratchpad for you to run.
- **Tables and colour** — comparisons render as aligned tables, and a cell
  that names a colour is shown in it.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/aschanken/lilbuddy/main/install.sh | sh
```

or, from a clone:

```sh
git clone https://github.com/aschanken/lilbuddy && sh lilbuddy/install.sh
```

One POSIX-sh installer for every platform and shell. It:

1. detects your OS and package manager,
2. checks for Node and [pi], installs pi for you (no sudo — it falls back to
   `~/.local` when the global npm prefix isn't writable), and offers the exact
   command for anything that needs your password,
3. wires up every shell you use — your login shell, the shell you ran it
   from, and any other supported shell you already have a config for,
4. drops a `lil` launcher in `~/.local/bin` for everything else.

| Shell | What it touches |
|-------|-----------------|
| zsh | `~/.oh-my-zsh/custom/lil.zsh` if oh-my-zsh is present, otherwise one marked block in `${ZDOTDIR:-~}/.zshrc` |
| bash | one marked block in `~/.bashrc` (`~/.bash_profile` on macOS) |
| fish | `~/.config/fish/conf.d/lil.fish` |
| anything else | the `~/.local/bin/lil` launcher (RUN then uses a child shell) |

It is idempotent — run it again after a `git pull` or after switching shells.
`--shell zsh,fish`, `--yes`, `--dry-run`, `--no-deps` and `--uninstall` do what
they say; `sh install.sh --help` lists them.

Then put your key where your shell can see it and open a new shell:

```sh
export DEEPSEEK_API_KEY=sk-…        # fish: set -Ux DEEPSEEK_API_KEY sk-…
lil --doctor                        # checks node, pi, key, clipboard, fonts
lil --demo                          # watch him work
```

Upgrading from the zsh-only version? Just pull — the old
`source …/lil.zsh` line still works — or re-run the installer.

## Requirements

- **macOS or Linux** (WSL and Termux are detected too)
- **Node ≥ 20** for Lil Buddy itself (no npm dependencies); current [pi]
  wants 22.19+
- **[pi coding agent]** (`npm i -g @earendil-works/pi-coding-agent`; verified
  with 0.82.1 and 1.6.1)
- **`DEEPSEEK_API_KEY`** in your environment
- Optional: a **Nerd Font** for the robot glyph in the header (auto-detected;
  a plain glyph is used otherwise), and on Linux a clipboard tool
  (`wl-clipboard`, `xclip` or `xsel`) — without one, copy uses OSC 52, which
  is also what makes copy work over SSH.

## Usage

```sh
lil how do I find what is listening on port 8080
lil                       # ask on an input line (no shell quoting to fight)
lil --demo [port|concept|danger|blocked|error]
lil --doctor
lil --update
```

While he works:

| Key | Action |
|-----|--------|
| Esc / Ctrl+C | stand him down |
| anything else | poke him |
| `y` / `n` | allow or deny a command he asks to run (anything but `y` is no) |

While the scratchpad is open:

| Key | Action |
|-----|--------|
| ⏎ / Esc / `q` | dismiss, back to your shell |
| Ctrl+R / `r` (⌘⏎ in WezTerm) | run the command in this shell (history included) |
| Ctrl+Y / `c` / `y` (⌘C in WezTerm) | copy the command |
| Ctrl+E | put the command on your prompt to edit (zsh, fish; edited in place in bash 4+) |
| any other char | start a follow-up question in the same conversation |

The key legend also shows what the conversation has used so far — total
tokens and cost, follow-ups included (for example `3,920 tok  $0.0006`). The
figures are the ones pi reports per model call, priced from `pi/models.json`.

Follow-up answers can hand over a new scratchpad command; the old box is
stamped `SHELVED` so it is always clear which command is live.

### Tuning

| Variable | Effect |
|----------|--------|
| `LIL_MOTION=full\|compact\|off` | the full panel, the original one-line spinner, or no motion at all (compact is automatic under 64 columns or 14 rows) |
| `LIL_RAMP=classic` | bring back the original rainbow ramp on the decrypt line |
| `LIL_PARA_GAP=1` | a blank line between paragraphs in answers |
| `LIL_NERD_FONT=0\|1` | override Nerd Font detection |
| `LIL_TIMEOUT_SECS` / `LIL_HEAVY_SECS` | kill a run after 120s / show `[HEAVY LOAD]` after 25s |
| `LIL_AUTO_UPDATE=0` | no background update check |
| `NO_COLOR=1` | no colour; piped output is always plain |

## Updates

A git checkout keeps itself current. At most once a day a `lil` run starts a
background check that fetches `origin/main` and fast-forwards; the next run
shows one line saying what changed. It never slows an answer down and it only
moves forward: it skips if you are on another branch or have edited tracked
files, and it never merges, rebases or resets. `lil --update` does the same
thing right now and tells you the result; `LIL_AUTO_UPDATE=0` turns the
background check off. The log is `~/.cache/lil/update.log`.

## How it works

```
lil "…"   (shell function: shell/lil.{zsh,bash,fish} — or bin/lil)
   │  LIL_HANDOFF=<tmpfile>  node src/cli.mjs "…"
   │
   ├─ snapshot clipboard + terminal scrollback (tmux / WezTerm / kitty / zellij)
   ├─ regenerate ~/.cache/lil/fingerprint.txt (24h TTL)
   ├─ set WezTerm user-var LIL_SCRATCHPAD=1
   ├─ PI_CODING_AGENT_DIR=lilbuddy/pi pi --mode json -nc \
   │      --exclude-tools bash,edit,write \
   │      --session ~/.cache/lil/session \
   │      --append-system-prompt "$(fingerprint)" "<question>"
   │        │  JSONL events → live panel (stage, thinking, tools, tokens);
   │        │  text deltas → rendered line by line above the panel; 120s kill
   │        └─ pi → DeepSeek V4 Flash → SYSTEM.md persona (lilbuddy/pi/SYSTEM.md)
   │              read-only tools only: read_clipboard / read_terminal snapshots,
   │              guarded `probe` for live inspection (strict allowlist, /bin/sh)
   ├─ hold back the LAST lilcmd block (fence or <lilcmd> tag) for the scratchpad
   ├─ scratchpad: run / copy / edit / dismiss / follow-up (same pi session)
   │     run & edit → written to $LIL_HANDOFF; the shell function evals it
   │     in YOUR shell after the engine exits
   └─ always → clear user-var LIL_SCRATCHPAD=0
```

Key design points:

- **One engine, thin shells** — everything lives in dependency-free Node
  (`src/`), which is guaranteed to be there because pi needs it. The only
  shell-specific code is a ~40-line function per shell whose one job is to
  run the scratchpad command in the calling shell.
- **The answer screen is a contract** — `tests/golden/` holds renders produced
  by the original zsh implementation; the Node renderer must match them byte
  for byte, whole or streamed.
- **Snapshots** — clipboard and terminal are captured *before* pi starts, so
  the model sees your terminal, not Lil Buddy's own output.
- **Read-only enforcement** — `--exclude-tools bash,edit,write` at invocation,
  plus the extension pins the active tool set to
  `read`/`probe`/`read_clipboard`/`read_terminal` on session start. `probe`
  (guard in `pi/probe-guard.ts`) runs its read-only allowlist freely; anything
  that writes, changes state or could run arbitrary code needs your keypress,
  and is blocked outright when there is nobody to ask (piped output).
- **Session-per-invocation** — each `lil` run starts a fresh pi session; the
  scratchpad follow-ups keep that same session alive.

## WezTerm / tmux enhancement (optional)

The scratchpad reacts to plain Ctrl+R / Ctrl+Y everywhere. With WezTerm on
macOS you can also press **⌘Enter** to run and **⌘C** to copy while the
scratchpad is open: paste the two entries from `integrations/wezterm-lil.lua`
into the `keys` table of your `wezterm.lua`. They are gated on the
`LIL_SCRATCHPAD` user-var, so they only take over while the scratchpad is
open. Inside tmux the user-var needs `set -g allow-passthrough on`.
(`lil --doctor` checks that.) The file has a note for Linux key choices.

## Tests

```sh
npm test        # node --test: renderer parity, pi contract, shells, installer, guard
```

## Uninstall

```sh
sh install.sh --uninstall
```

removes the shell integrations and the launcher. The checkout and
`~/.cache/lil/` are left for you to delete.

## License

MIT — see [LICENSE](LICENSE).

[pi]: https://github.com/earendil-works/pi
[pi coding agent]: https://github.com/earendil-works/pi
