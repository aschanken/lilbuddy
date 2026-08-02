# Lil Buddy 🗄️

A pocket-sized terminal guru. Type `lil how do I …` in zsh and get a punchy
Pip-Boy-flavored answer from DeepSeek V4 Flash, with an interactive command
scratchpad when the answer is a runnable command.

```
╭─ 󰚩  LIL BUDDY ─ VAULT-TEC CERTIFIED ─╮
  Lists open files whose connections match an Internet address…
╭──   SCRATCHPAD ───────────────────────╮
│ lsof -nP -iTCP:8080 -sTCP:LISTEN        │
╰─────────────────────────────────────────╯
   ⏎ dismiss   󰌑 ⌘⏎/^R run    ⌘C/^Y copy   ✏ type to follow up
```

Built on [pi](https://github.com/earendil-works/pi) (the coding agent) run in
`--print` one-shot mode against DeepSeek V4 Flash.

## Install

```sh
zsh /Users/ais/lilbuddy/install.zsh
```

This writes `source /Users/ais/lilbuddy/lil.zsh` to
`~/.oh-my-zsh/custom/lil.zsh` (auto-sourced on the next zsh start) and creates
`~/.cache/lil/`. It edits **no** other dotfiles. Open a new shell and you're
done:

```sh
lil "how do I find what's listening on port 8080"
```

### WezTerm enhancement (optional but nice)

The scratchpad reacts to plain Ctrl+R / Ctrl+Y. With WezTerm you can instead
press **⌘Enter** to run and **⌘c** to copy while the scratchpad is open.

1. Paste the two entries from `integrations/wezterm-lil.lua` into the `keys`
   table of your `wezterm.lua`.
2. Inside tmux, add `set -g allow-passthrough on` to `~/.tmux.conf` and
   `tmux source-file ~/.tmux.conf`.

When the scratchpad is closed, ⌘Enter stays fullscreen and ⌘c stays copy —
Lil Buddy only takes them over while it owns the prompt.

## Usage

```sh
lil "<question>"          # ask; answer may come with a command scratchpad
```

While the scratchpad is open (stdin is a terminal):

| Key | Action |
|-----|--------|
| ⏎ / Esc / `q` | dismiss, back to zsh |
| ⌘Enter / Ctrl+R / `r` | run the command in this shell (history included) |
| ⌘c / Ctrl+Y / `c` `y` | copy the command to the clipboard |
| any other char | start a follow-up question in the same conversation |

Follow-up answers can hand over a new scratchpad command.

## How it works

```
lil "…"  (zsh function, current shell)
   │
   ├─ snapshot clipboard (pbpaste) + terminal scrollback (tmux capture-pane)
   ├─ regenerate ~/.cache/lil/fingerprint.txt (24h TTL)
   ├─ set WezTerm user-var LIL_SCRATCHPAD=1
   ├─ PI_CODING_AGENT_DIR=lilbuddy/pi pi -p -nc \
   │      --session ~/.cache/lil/session \
   │      --append-system-prompt "$(fingerprint)" "<question>"
   │        │  spinner owns the tty; stdout → temp file; 120s kill
   │        └─ pi → DeepSeek V4 Flash → SYSTEM.md persona (lilbuddy/pi/SYSTEM.md)
   │              tools read_clipboard / read_terminal read the snapshots
   ├─ print answer (indented), extract LAST ```lilcmd block
   ├─ scratchpad mode if a command, else follow-up mode
   │     ^R/^Y or typing → run / copy / re-ask pi (same session)
   └─ always → clear user-var LIL_SCRATCHPAD=0
```

The `pi/` config dir is fully isolated: its own `settings.json` (deepseek,
v4-flash, lowest offered thinking level), `models.json` (deepseek only, key via
`$DEEPSEEK_API_KEY` — never a literal), `SYSTEM.md` (the persona), and
`extensions/lil-context.ts` (clipboard/terminal tools). The operator's
`~/.pi/agent` is never touched.

## Uninstall

```sh
rm ~/.oh-my-zsh/custom/lil.zsh
```

(Optionally remove `~/.cache/lil/` and `integrations/wezterm-lil.lua` entries
and the `allow-passthrough` line.)
