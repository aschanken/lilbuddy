# CLAUDE.md — Lil Buddy

## What this is

**Lil Buddy** (`lil <prompt>`) is a quick-access terminal sysadmin assistant: a zsh
function that fires a one-shot [pi](https://github.com/earendil-works/pi) run on
DeepSeek V4 Flash with a Pip-Boy-flavored sysadmin persona, prints a terse answer,
and — when the answer is a runnable command — drops into an interactive scratchpad
(run / copy / dismiss / follow-up). It is a *reference guru*, not a coding agent;
other workflows own code generation.

## Architecture (one pass)

```
lil <prompt>                                  (zsh function, lil.zsh)
  ├─ fingerprint: ~/.cache/lil/fingerprint.txt   (env/versions, 24h cache)
  ├─ snapshots:   $LIL_RUNTIME/clip.txt (pbpaste)
  │               $LIL_RUNTIME/term.txt (tmux capture-pane, current pane)
  ├─ invoke: PI_CODING_AGENT_DIR=$REPO/pi pi -p -nc … "<prompt>"
  │            └─ pi/ = isolated config: SYSTEM.md persona, models.json
  │               (deepseek only, $DEEPSEEK_API_KEY env form),
  │               extensions/lil-context.ts → tools read_clipboard/read_terminal
  │               (read the snapshots on demand — "IF it needs it")
  ├─ render: banner + answer; parse last ```lilcmd fenced block
  └─ loop: Enter=exit · ^R/r=run (eval in CURRENT shell + history) ·
           ^Y/c=copy (pbcopy) · typed text=follow-up turn
```

Key design facts:

- **Isolation**: `PI_CODING_AGENT_DIR=<repo>/pi` keeps Lil Buddy away from a
  user's main `~/.pi/agent` (whatever packages, MCP servers, or persona
  extensions live there would slow launches and pollute the persona). Never
  write to `~/.pi/agent/`.
- **Snapshot-at-invocation**: clipboard/terminal are captured *before* pi starts,
  so the model sees the user's terminal, not pi's own output. The extension tools
  only read those snapshot files (via `$LIL_RUNTIME`).
- **Answer contract**: the persona (pi/SYSTEM.md) must emit at most ONE
  ` ```lilcmd ` fenced block, always last. `_lil_extract_cmd` in lil.zsh parses
  the LAST block and — belt and suspenders — also tolerates `<lilcmd>…</lilcmd>`
  tags, which DeepSeek emits in the wild despite instructions. `_lil_strip_cmd`
  removes the block from the displayed answer (the scratchpad shows it instead).
  If you change the contract, change both sides.
- **Rendering**: `_lil_render` converts answer markdown to ANSI (inline code →
  amber, fences → gutter blocks, headers/bullets glyphed, word-wrap). Command
  display in the box uses `_lil_wrap_hard` (character-exact); execution always
  uses `$cmd` verbatim.
- **Sessions**: each `lil` invocation starts fresh (`lil()` removes the session
  file); only follow-ups typed within an invocation continue the conversation.
- **Invocation is `--mode json`, not `-p`**: `_lil_invoke` streams pi's JSONL
  events to drive the spinner's real progress stages (start → thinking →
  tool:<name> → writing → done) and extracts the answer from `text_delta`
  events via jq. pi's stdin must be `< /dev/null` (json mode blocks forever on
  a non-tty open stdin). Exit code comes from `pipestatus`, not bare `wait`.
- **Read-only enforcement is tool-layer, twice**: `--exclude-tools
  bash,edit,write` on the CLI AND `pi.setActiveTools([read, probe,
  read_clipboard, read_terminal])` on session_start in the extension. The
  `probe` tool (pi/probe-guard.ts) allowlists read-only commands; persona
  promises are flavor, the guard is the enforcement. Never re-enable
  bash/edit/write.
- **Model quirk**: deepseek-v4-flash's thinkingLevelMap offers only high/max —
  don't set a lower defaultThinkingLevel, pi will reject it.
- **Cmd-key chords**: Cmd+Enter/Cmd+C work only via the WezTerm snippet
  (`integrations/wezterm-lil.lua`), which checks the `LIL_SCRATCHPAD` user-var
  (emitted as OSC 1337, tmux-passthrough-wrapped; requires
  `set -g allow-passthrough on` in tmux). They resolve to the same bytes as the
  always-available fallbacks: `^R` (0x12) run, `^Y` (0x19) copy.
- **Run semantics**: "run" uses `print -s` + `eval` in the *current interactive
  shell* — the scratchpad loop must stay inside the `lil` function (no subshell),
  or aliases/cd/history break.

## File map

| Path | Owns |
|---|---|
| `lil.zsh` | everything wrapper-side: entry fn, fingerprint, snapshots, spinner, extractor, scratchpad loop |
| `pi/SYSTEM.md` | the persona (voice + answer contract) — taste-bearing, edit deliberately |
| `pi/models.json` | deepseek provider; `apiKey` MUST stay `"$DEEPSEEK_API_KEY"` (env form), never a literal |
| `pi/settings.json` | defaultProvider/defaultModel/defaultThinkingLevel |
| `pi/extensions/lil-context.ts` | `read_clipboard` / `read_terminal` tools |
| `integrations/wezterm-lil.lua` | Cmd-chord enhancement snippet (user pastes into wezterm.lua) |
| `install.zsh` | idempotent; writes `~/.oh-my-zsh/custom/lil.zsh` (one source line) only |

pi runtime droppings inside `pi/` (sessions/, caches, auth.json) are gitignored —
never commit them.

## Environment ground truth (verified 2026-08-01)

- pi 0.82.1 (`@earendil-works/pi-coding-agent`), Homebrew node. Flags this repo
  relies on: `-p`, `-nc`, `--session`, `--append-system-prompt`,
  `PI_CODING_AGENT_DIR`.
- `DEEPSEEK_API_KEY` is exported from `~/.zshrc` → present in interactive zsh;
  scripted tests must run via `zsh -ic '…'`.
- Terminal stack: WezTerm → tmux 3.6b. Kitty keyboard protocol is NOT reliable
  inside tmux — do not build on it.
- macOS/Darwin; clipboard = pbcopy/pbpaste; oh-my-zsh with auto-sourced
  `~/.oh-my-zsh/custom/*.zsh`.

## Conventions

- Conventional commits (`feat:` `fix:` `docs:` `chore:`); body says *why*.
- Smallest diff that meets the acceptance criteria; note spotted improvements,
  don't fold them in.
- Persona edits (pi/SYSTEM.md) are taste work: keep the voice punchy,
  one gag max per answer, accuracy outranks charm.

## Verification quick-battery

```zsh
Run from the repo root (`REPO=$PWD`):

# provider isolation + model present
zsh -ic 'PI_CODING_AGENT_DIR=$PWD/pi pi --list-models | head -20'
# end-to-end one-shot
zsh -ic "cd /tmp && PI_CODING_AGENT_DIR=$REPO/pi pi -p -nc --no-session 'Reply with exactly the word PONG'"
# tool round-trip
zsh -ic "export LIL_RUNTIME=\$(mktemp -d); print -n VAULT111 > \$LIL_RUNTIME/clip.txt; PI_CODING_AGENT_DIR=$REPO/pi pi -p -nc --no-session 'Call the read_clipboard tool and repeat its exact contents.'"
# extractor + renderer fixture battery
zsh tests/render-fixture.zsh
# non-tty guard / live smoke
zsh -ic "source $REPO/lil.zsh; lil 'what does lsof -i do, one liner'" < /dev/null
```

Interactive scratchpad keys and WezTerm Cmd chords can only be verified by a
human at a real keyboard — report them "implemented, unverified interactively"
unless actually exercised.
