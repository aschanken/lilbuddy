#!/bin/sh
# install.sh — one installer for Lil Buddy on macOS and Linux, any shell.
#
#   From a clone:    sh install.sh
#   From anywhere:   curl -fsSL https://raw.githubusercontent.com/aschanken/lilbuddy/main/install.sh | sh
#
# POSIX sh on purpose: it runs the same under dash, bash, zsh, ash/busybox.
# It is idempotent — run it again any time (after a pull, after switching
# shells) and it only fixes what is missing.
#
# What it touches, and nothing else:
#   * zsh   → ~/.oh-my-zsh/custom/lil.zsh if oh-my-zsh is there, else one
#             marked block in ${ZDOTDIR:-~}/.zshrc
#   * bash  → one marked block in ~/.bashrc (~/.bash_profile on macOS)
#   * fish  → ~/.config/fish/conf.d/lil.fish
#   * a `lil` symlink in ~/.local/bin for every other shell and for scripts
#   * ~/.cache/lil/  (runtime files)
# Anything needing sudo is shown to you first and only run if you say yes.

set -u

REPO_URL="${LIL_REPO:-https://github.com/aschanken/lilbuddy}"
PI_PACKAGE="@earendil-works/pi-coding-agent"
MARK_BEGIN="# >>> lilbuddy >>>"
MARK_END="# <<< lilbuddy <<<"

opt_shells=""
opt_yes=0
opt_deps=1
opt_dry=0
opt_uninstall=0

usage() {
  cat <<'EOF'
Lil Buddy installer

  sh install.sh [options]

  --shell LIST    wire these shells: zsh,bash,fish | all | none
                  (default: your login shell, the shell you ran this from, and
                  any other supported shell you already have a config for)
  --yes, -y       answer yes to every prompt (including sudo package installs)
  --no-deps       don't check or install dependencies
  --dry-run       print what would happen, change nothing
  --uninstall     remove the shell integrations and the ~/.local/bin symlink
  --help, -h      this text

Environment: LIL_HOME (install location when piped from curl),
             LIL_REPO (git URL to clone from).
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --shell) shift; opt_shells="${1:-}" ;;
    --shell=*) opt_shells="${1#--shell=}" ;;
    --yes|-y) opt_yes=1 ;;
    --no-deps) opt_deps=0 ;;
    --dry-run) opt_dry=1 ;;
    --uninstall) opt_uninstall=1 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'install.sh: unknown option %s\n\n' "$1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

# --- output ------------------------------------------------------------------

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  G="$(printf '\033[38;5;84m')"; D="$(printf '\033[38;5;41m')"
  A="$(printf '\033[38;5;214m')"; Y="$(printf '\033[38;5;244m')"
  B="$(printf '\033[1m')"; R="$(printf '\033[0m')"
else
  G=""; D=""; A=""; Y=""; B=""; R=""
fi

step() { printf '%s ▸ %s%s\n' "$G" "$R" "$*"; }
ok()   { printf '%s ✓ %s%s%s\n' "$G" "$D" "$*" "$R"; }
note() { printf '%s   %s%s\n' "$Y" "$*" "$R"; }
warn() { printf '%s ⚠ %s%s\n' "$A" "$*" "$R"; }
die()  { printf '%s ✗ %s%s\n' "$A" "$*" "$R" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# Run a command, or just show it under --dry-run.
run() {
  if [ "$opt_dry" -eq 1 ]; then note "would run: $*"; return 0; fi
  "$@"
}

# Ask a yes/no question on the real terminal (stdin may be a curl pipe).
# $1 = question, $2 = default (y|n). Without a terminal the default wins.
confirm() {
  [ "$opt_yes" -eq 1 ] && return 0
  if [ "$opt_dry" -eq 1 ]; then return 0; fi
  if [ ! -r /dev/tty ] || ! ( : < /dev/tty ) 2>/dev/null; then
    [ "$2" = "y" ]; return
  fi
  if [ "$2" = "y" ]; then hint="[Y/n]"; else hint="[y/N]"; fi
  printf '%s ? %s%s %s ' "$A" "$R" "$1" "$hint" > /dev/tty
  IFS= read -r reply < /dev/tty || reply=""
  case "$reply" in
    [Yy]*) return 0 ;;
    [Nn]*) return 1 ;;
    *) [ "$2" = "y" ] ;;
  esac
}

# --- where are we? -----------------------------------------------------------

OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="macos" ;;
  Linux)
    if [ -n "${WSL_DISTRO_NAME:-}" ]; then PLATFORM="wsl"
    elif [ -n "${TERMUX_VERSION:-}" ]; then PLATFORM="termux"
    else PLATFORM="linux"; fi ;;
  *) PLATFORM="other" ;;
esac

PRETTY="$OS"
if [ "$PLATFORM" = "macos" ] && have sw_vers; then
  PRETTY="macOS $(sw_vers -productVersion 2>/dev/null)"
elif [ -r /etc/os-release ]; then
  PRETTY="$(. /etc/os-release 2>/dev/null; printf '%s' "${PRETTY_NAME:-Linux}")"
fi

PKG=""
for m in brew apt-get dnf pacman zypper apk xbps-install pkg; do
  if have "$m"; then PKG="$m"; break; fi
done
# Termux's own manager is `pkg`; everywhere else `pkg` means something unrelated.
[ "$PKG" = "pkg" ] && [ "$PLATFORM" != "termux" ] && PKG=""

if [ "$(id -u)" -eq 0 ] || ! have sudo; then SUDO=""; else SUDO="sudo"; fi

# How this machine installs a package ($1 = name). Prints nothing if unknown.
pkg_install_cmd() {
  case "$PKG" in
    brew) printf 'brew install %s' "$1" ;;
    apt-get) printf '%s apt-get install -y %s' "$SUDO" "$1" ;;
    dnf) printf '%s dnf install -y %s' "$SUDO" "$1" ;;
    pacman) printf '%s pacman -S --noconfirm %s' "$SUDO" "$1" ;;
    zypper) printf '%s zypper install -y %s' "$SUDO" "$1" ;;
    apk) printf '%s apk add %s' "$SUDO" "$1" ;;
    xbps-install) printf '%s xbps-install -y %s' "$SUDO" "$1" ;;
    pkg) printf 'pkg install -y %s' "$1" ;;
  esac
}

# Directory holding this script when run from a clone; empty when piped.
script_dir=""
case "$0" in
  */*) script_dir="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)" ;;
  *) [ -f "./$0" ] && script_dir="$(pwd -P)" ;;
esac

if [ -n "$script_dir" ] && [ -f "$script_dir/src/cli.mjs" ]; then
  LIL_HOME="$script_dir"
  FROM_CLONE=1
else
  LIL_HOME="${LIL_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/lilbuddy}"
  FROM_CLONE=0
fi

RUNTIME="${LIL_RUNTIME:-${XDG_CACHE_HOME:-$HOME/.cache}/lil}"
BIN_DIR="$HOME/.local/bin"
ZSHRC="${ZDOTDIR:-$HOME}/.zshrc"
OMZ_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
FISH_CONFD="${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d"
if [ "$PLATFORM" = "macos" ] && [ -f "$HOME/.bash_profile" ]; then
  BASHRC="$HOME/.bash_profile"
else
  BASHRC="$HOME/.bashrc"
fi

# --- rc-file surgery ---------------------------------------------------------

# Remove our marked block from file $1 (keeps symlinked dotfiles as symlinks).
strip_block() {
  [ -f "$1" ] || return 0
  grep -qF "$MARK_BEGIN" "$1" 2>/dev/null || return 0
  if [ "$opt_dry" -eq 1 ]; then note "would remove the lilbuddy block from $1"; return 0; fi
  tmp="$(mktemp "${TMPDIR:-/tmp}/lil-rc.XXXXXX")" || return 1
  awk -v b="$MARK_BEGIN" -v e="$MARK_END" '
    $0 == b { skip = 1; next }
    $0 == e { skip = 0; next }
    !skip { print }
  ' "$1" > "$tmp" && cat "$tmp" > "$1"
  rm -f "$tmp"
}

# Put a marked block sourcing $2 into rc file $1.
write_block() {
  strip_block "$1"
  if [ "$opt_dry" -eq 1 ]; then note "would add a lilbuddy block to $1"; return 0; fi
  mkdir -p "$(dirname "$1")"
  # Make sure the block starts on its own line.
  if [ -s "$1" ] && [ -n "$(tail -c 1 "$1")" ]; then printf '\n' >> "$1"; fi
  {
    printf '%s\n' "$MARK_BEGIN"
    printf '[ -f "%s" ] && . "%s"\n' "$2" "$2"
    printf '%s\n' "$MARK_END"
  } >> "$1"
}

wire_zsh() {
  if [ -d "$OMZ_CUSTOM" ]; then
    # oh-my-zsh auto-sources custom/*.zsh — no dotfile edit needed.
    strip_block "$ZSHRC"
    if [ "$opt_dry" -eq 1 ]; then note "would write $OMZ_CUSTOM/lil.zsh"; else
      printf 'source "%s/shell/lil.zsh"\n' "$LIL_HOME" > "$OMZ_CUSTOM/lil.zsh"
    fi
    ok "zsh   → $OMZ_CUSTOM/lil.zsh"
  else
    write_block "$ZSHRC" "$LIL_HOME/shell/lil.zsh"
    ok "zsh   → $ZSHRC"
  fi
}

wire_bash() {
  write_block "$BASHRC" "$LIL_HOME/shell/lil.bash"
  ok "bash  → $BASHRC"
}

wire_fish() {
  if [ "$opt_dry" -eq 1 ]; then note "would write $FISH_CONFD/lil.fish"; else
    mkdir -p "$FISH_CONFD"
    printf 'test -f "%s/shell/lil.fish"; and source "%s/shell/lil.fish"\n' "$LIL_HOME" "$LIL_HOME" > "$FISH_CONFD/lil.fish"
  fi
  ok "fish  → $FISH_CONFD/lil.fish"
}

# --- uninstall ---------------------------------------------------------------

if [ "$opt_uninstall" -eq 1 ]; then
  step "Removing Lil Buddy's shell integrations"
  strip_block "$ZSHRC"
  strip_block "$HOME/.bashrc"
  strip_block "$HOME/.bash_profile"
  for f in "$OMZ_CUSTOM/lil.zsh" "$FISH_CONFD/lil.fish"; do
    [ -f "$f" ] && run rm -f "$f"
  done
  if [ -L "$BIN_DIR/lil" ]; then run rm -f "$BIN_DIR/lil"; fi
  ok "integrations removed — open a new shell"
  note "left in place: $LIL_HOME (the code) and $RUNTIME (cache). Delete them if you like."
  exit 0
fi

# --- install -----------------------------------------------------------------

printf '%s%s╭─ LIL BUDDY ─ INSTALLER ─╮%s\n' "$G" "$B" "$R"
note "$PRETTY · $(uname -m) · package manager: ${PKG:-none found}"

# 1. The code itself.
if [ "$FROM_CLONE" -eq 1 ]; then
  ok "using this checkout: $LIL_HOME"
else
  step "Fetching Lil Buddy into $LIL_HOME"
  if [ -d "$LIL_HOME/.git" ] && have git; then
    run git -C "$LIL_HOME" pull --ff-only --quiet || warn "could not update the existing checkout; using it as is"
  elif [ -e "$LIL_HOME" ] && [ -n "$(ls -A "$LIL_HOME" 2>/dev/null)" ] && [ ! -f "$LIL_HOME/src/cli.mjs" ]; then
    die "$LIL_HOME exists and is not a Lil Buddy checkout — set LIL_HOME to somewhere else"
  elif have git; then
    run git clone --depth 1 --quiet "$REPO_URL" "$LIL_HOME" || die "git clone failed"
  elif have curl || have wget; then
    run mkdir -p "$LIL_HOME"
    if [ "$opt_dry" -eq 0 ]; then
      if have curl; then curl -fsSL "$REPO_URL/archive/refs/heads/main.tar.gz"
      else wget -qO- "$REPO_URL/archive/refs/heads/main.tar.gz"; fi \
        | tar -xz -C "$LIL_HOME" --strip-components 1 || die "download failed"
    fi
  else
    die "need git, curl or wget to fetch the code"
  fi
  ok "code is in $LIL_HOME"
fi

# 2. Dependencies: node, pi, and (Linux) a clipboard tool.
node_ok() {
  have node || return 1
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)' 2>/dev/null
}

install_node() {
  case "$PKG" in
    brew) cmd="brew install node" ;;
    pacman|apk|xbps-install|pkg) cmd="$(pkg_install_cmd nodejs)" ;;
    dnf|zypper) cmd="$(pkg_install_cmd nodejs)" ;;
    *) cmd="" ;;   # apt's node is usually years behind what pi needs
  esac
  if [ "$PKG" = "pacman" ] || [ "$PKG" = "apk" ]; then cmd="$cmd npm"; fi
  if [ -n "$cmd" ] && confirm "Install Node.js with: $cmd ?" n; then
    run sh -c "$cmd" && return 0
  fi
  warn "Node.js 22.19+ is needed (pi requires it). Easiest way on any distro:"
  note "curl -fsSL https://fnm.vercel.app/install | bash   # then: fnm install 22"
  note "or see https://nodejs.org/en/download — then run this installer again."
  return 1
}

missing_hard=0
if [ "$opt_deps" -eq 1 ]; then
  step "Checking dependencies"
  if node_ok; then
    ok "node $(node --version)"
  else
    if have node; then warn "node $(node --version) is too old for pi (needs 22.19+)"; else warn "node not found"; fi
    install_node || true
    if node_ok || [ "$opt_dry" -eq 1 ]; then :; else missing_hard=1; fi
  fi

  if have pi; then
    ok "pi $(pi --version 2>/dev/null | head -n 1)"
  elif have npm; then
    # Prefer a no-sudo install: fall back to ~/.local when the global prefix
    # is not writable (system Node on Linux).
    prefix="$(npm config get prefix 2>/dev/null)"
    if [ -n "$prefix" ] && { [ -w "$prefix/lib/node_modules" ] || { [ ! -e "$prefix/lib/node_modules" ] && [ -w "$prefix" ]; }; }; then
      cmd="npm install -g $PI_PACKAGE"
    else
      cmd="npm install -g --prefix $HOME/.local $PI_PACKAGE"
    fi
    if confirm "Install the pi coding agent with: $cmd ?" y; then
      note "installing pi — this takes a moment…"
      if run sh -c "$cmd >/dev/null 2>&1"; then ok "pi installed"; else warn "pi install failed — run it yourself: $cmd"; missing_hard=1; fi
    else
      warn "skipped — Lil Buddy cannot answer without pi: $cmd"; missing_hard=1
    fi
  else
    warn "pi not found, and no npm to install it with (npm install -g $PI_PACKAGE)"
    missing_hard=1
  fi

  if [ "$PLATFORM" = "linux" ] && [ -z "${SSH_CONNECTION:-}" ]; then
    if have wl-copy || have xclip || have xsel; then
      ok "clipboard tool present"
    else
      if [ -n "${WAYLAND_DISPLAY:-}" ]; then clip="wl-clipboard"; else clip="xclip"; fi
      cmd="$(pkg_install_cmd "$clip")"
      if [ -n "$cmd" ] && confirm "No clipboard tool found. Install $clip with: $cmd ?" n; then
        run sh -c "$cmd" && ok "$clip installed"
      else
        note "no clipboard tool — copy will use OSC 52 (works in WezTerm, kitty, tmux…)"
        [ -n "$cmd" ] && note "to add one later: $cmd"
      fi
    fi
  fi
fi

# 3. Runtime dir + launcher on PATH.
run mkdir -p "$RUNTIME"
run chmod +x "$LIL_HOME/bin/lil" 2>/dev/null || true
run mkdir -p "$BIN_DIR"
if [ "$opt_dry" -eq 0 ]; then ln -sf "$LIL_HOME/bin/lil" "$BIN_DIR/lil"; fi
ok "launcher → $BIN_DIR/lil"

# 4. Shell integrations.
login_shell="$(basename "${SHELL:-sh}")"
parent_shell="$(ps -o comm= -p "$PPID" 2>/dev/null | sed 's/^-//; s|.*/||')"

wants() {
  # $1 = shell name → should it be wired?
  case "$opt_shells" in
    none) return 1 ;;
    all) have "$1"; return ;;
    "") ;;
    *) case ",$opt_shells," in *",$1,"*) return 0 ;; *) return 1 ;; esac ;;
  esac
  [ "$login_shell" = "$1" ] && return 0
  [ "$parent_shell" = "$1" ] && return 0
  have "$1" || return 1
  case "$1" in
    zsh) [ -f "$ZSHRC" ] || [ -d "$OMZ_CUSTOM" ] ;;
    bash) [ -f "$BASHRC" ] ;;
    fish) [ -d "${XDG_CONFIG_HOME:-$HOME/.config}/fish" ] ;;
  esac
}

step "Wiring shells"
wired=""
if wants zsh; then wire_zsh; wired="$wired zsh"; fi
if wants bash; then wire_bash; wired="$wired bash"; fi
if wants fish; then wire_fish; wired="$wired fish"; fi
if [ -z "$wired" ]; then
  note "no zsh / bash / fish integration installed — \`lil\` still works from $BIN_DIR,"
  note "but RUN executes in a child shell (no cd, aliases or history)."
fi
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) [ -z "$wired" ] && warn "$BIN_DIR is not on your PATH — add it to use \`lil\`" ;;
esac

# 5. Send-off.
printf '\n'
if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  warn "DEEPSEEK_API_KEY is not set in this shell. Add to your shell rc:"
  note "export DEEPSEEK_API_KEY=sk-…        (fish: set -Ux DEEPSEEK_API_KEY sk-…)"
fi
if [ "$missing_hard" -eq 1 ]; then
  warn "Installed, but a dependency above still needs attention. Then: lil --doctor"
  exit 1
fi
printf '%s%s Lil Buddy is installed.%s Open a new shell, then:\n' "$G" "$B" "$R"
printf '   %slil --demo%s      %swatch him work — no API key needed%s\n' "$A" "$R" "$D" "$R"
printf '   %slil --doctor%s    %scheck this machine%s\n' "$A" "$R" "$D" "$R"
printf '   %slil how do I find what is listening on port 8080%s\n' "$A" "$R"
if [ "$PLATFORM" = "macos" ] || [ -n "${WEZTERM_PANE:-}" ]; then
  note "WezTerm ⌘⏎ / ⌘C chords: see $LIL_HOME/integrations/wezterm-lil.lua"
fi
