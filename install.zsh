#!/bin/zsh
# install.zsh — idempotent installer for Lil Buddy.
# Edits NO dotfiles except creating ~/.oh-my-zsh/custom/lil.zsh.
set -e

LIL_HOME="${LIL_HOME:-${0:A:h}}"
CUSTOM_DIR="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
INSTALL_FILE="$CUSTOM_DIR/lil.zsh"
SOURCE_LINE="source $LIL_HOME/lil.zsh"

mkdir -p "$CUSTOM_DIR"
mkdir -p "$HOME/.cache/lil"
print -r -- "$SOURCE_LINE" > "$INSTALL_FILE"

print -r -- "[lil] wrote $INSTALL_FILE"
print -r -- "  content: $SOURCE_LINE"
print -r -- "[lil] created ~/.cache/lil/"
print -r -- "[lil] WezTerm enhancement: $LIL_HOME/integrations/wezterm-lil.lua"
print -r -- "[lil]   paste it into your wezterm.lua keys table."
print -r -- "[lil]   inside tmux, add to ~/.tmux.conf:  set -g allow-passthrough on"
print -r -- "[lil] try it:  lil \"hello\""
