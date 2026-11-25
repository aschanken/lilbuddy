# Lil Buddy — bash integration. Source this from ~/.bashrc (install.sh does it).
#
# The engine is a Node program; this function exists for one reason: when you
# press RUN in the scratchpad, the command must execute in THIS shell (your
# aliases, your cwd, your history). The engine leaves the order in a handoff
# file and this function carries it out.

if [ -z "${LIL_HOME:-}" ]; then
  LIL_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
fi

# In-place editing needs `read -e -i`, which arrived in bash 4.
if [ "${BASH_VERSINFO[0]:-3}" -ge 4 ]; then _LIL_EDIT=1; else _LIL_EDIT=0; fi

lil() {
  if ! command -v node >/dev/null 2>&1; then
    echo "lil: node is not on PATH — run $LIL_HOME/install.sh" >&2
    return 127
  fi
  # Locals are prefixed because the eval'd command can see them.
  local _lil_handoff _lil_rc _lil_action _lil_cmd
  _lil_handoff="$(command mktemp "${TMPDIR:-/tmp}/lil-handoff.XXXXXX")" || return 1
  LIL_HOME="$LIL_HOME" LIL_SHELL=bash LIL_EDIT="$_LIL_EDIT" LIL_HANDOFF="$_lil_handoff" \
    command node "$LIL_HOME/src/cli.mjs" "$@"
  _lil_rc=$?
  if [ -s "$_lil_handoff" ]; then
    { IFS= read -r _lil_action; _lil_cmd="$(command cat)"; } < "$_lil_handoff"
    command rm -f -- "$_lil_handoff"
    case "$_lil_action" in
      run)
        history -s -- "$_lil_cmd"     # into history, as if you had typed it
        eval "$_lil_cmd"
        return
        ;;
      edit)
        # bash cannot pre-fill the next prompt, so the edit happens right here.
        IFS= read -r -e -i "$_lil_cmd" -p "❯ " _lil_cmd || return 130
        [ -n "$_lil_cmd" ] || return 0
        history -s -- "$_lil_cmd"
        eval "$_lil_cmd"
        return
        ;;
    esac
  fi
  command rm -f -- "$_lil_handoff"
  return $_lil_rc
}
