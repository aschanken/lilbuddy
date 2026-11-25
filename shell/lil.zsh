# Lil Buddy — zsh integration. Source this from ~/.zshrc (install.sh does it).
#
# The engine is a Node program; this function exists for one reason: when you
# press RUN in the scratchpad, the command must execute in THIS shell (your
# aliases, your cwd, your history). The engine leaves the order in a handoff
# file and this function carries it out.

: ${LIL_HOME:=${${(%):-%x}:A:h:h}}

# An earlier `alias lil=…` would be expanded into the definition below.
unalias lil 2>/dev/null

function lil {
  if ! command -v node >/dev/null 2>&1; then
    print -u2 -r -- "lil: node is not on PATH — run $LIL_HOME/install.sh"
    return 127
  fi
  # No `emulate -L` here on purpose: the command must run under YOUR options.
  # Locals are prefixed because the eval'd command can see them.
  local _lil_handoff _lil_rc _lil_action _lil_cmd
  _lil_handoff="$(command mktemp "${TMPDIR:-/tmp}/lil-handoff.XXXXXX")" || return 1
  LIL_HOME="$LIL_HOME" LIL_SHELL=zsh LIL_EDIT=1 LIL_HANDOFF="$_lil_handoff" \
    command node "$LIL_HOME/src/cli.mjs" "$@"
  _lil_rc=$?
  if [[ -s "$_lil_handoff" ]]; then
    { IFS= read -r _lil_action; _lil_cmd="$(command cat)"; } < "$_lil_handoff"
    command rm -f -- "$_lil_handoff"
    case "$_lil_action" in
      run)
        print -s -- "$_lil_cmd"       # into history, as if you had typed it
        eval "$_lil_cmd"
        return
        ;;
      edit)
        print -z -- "$_lil_cmd"       # onto your next prompt, ready to edit
        return 0
        ;;
    esac
  fi
  command rm -f -- "$_lil_handoff"
  return $_lil_rc
}

# `lil how do I match *.log?` — no quotes, no "no matches found".
alias lil='noglob lil'
