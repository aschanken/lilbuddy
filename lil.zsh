# lil.zsh — Lil Buddy: quick-access terminal guru (pi + deepseek-v4-flash)
# Sourced from ~/.oh-my-zsh/custom/lil.zsh (created by install.zsh).

LIL_HOME="${LIL_HOME:-/Users/ais/lilbuddy}"
LIL_RUNTIME="${LIL_RUNTIME:-$HOME/.cache/lil}"
LIL_TIMEOUT_SECS="${LIL_TIMEOUT_SECS:-120}"

# Pip-Boy palette (256-color raw escapes)
LIL_GREEN=$'\e[38;5;84m'    # bright Pip-Boy green
LIL_DIM=$'\e[38;5;41m'      # dim Pip-Boy green
LIL_AMBER=$'\e[38;5;214m'   # amber (warnings / accents)
LIL_GRAY=$'\e[38;5;244m'    # chrome
LIL_RESET=$'\e[0m'

# ---------------------------------------------------------------------------
# Environment fingerprint (regenerate when missing or older than 24h)
# ---------------------------------------------------------------------------
_lil_fingerprint() {
  mkdir -p "$LIL_RUNTIME"
  local fp="$LIL_RUNTIME/fingerprint.txt"
  local now mtime=0
  now="$(date +%s)"
  [[ -f "$fp" ]] && mtime="$(stat -f %m "$fp")"
  if [[ -f "$fp" ]] && (( mtime > now - 86400 )); then
    return 0
  fi
  {
    print -r -- "## ENVIRONMENT FINGERPRINT (auto-generated; trust these versions)"
    print -r -- "os: $(sw_vers -productName) $(sw_vers -productVersion) ($(sw_vers -buildVersion))"
    print -r -- "arch: $(uname -m)"
    print -r -- "kernel: Darwin $(uname -r)"
    print -r -- "shell: zsh ${ZSH_VERSION}"
    print -r -- "tmux: $(tmux -V 2>/dev/null | sed 's/^tmux //')"
    print -r -- "terminal: WezTerm"
    print -r -- "pkgmgr: $(brew --version 2>/dev/null | head -1)"
    print -r -- "node: $(node --version 2>/dev/null)"
    print -r -- "python3: $(python3 --version 2>/dev/null)"
    print -r -- "git: $(git --version 2>/dev/null)"
    print -r -- "bun: $(bun --version 2>/dev/null)"
  } > "$fp"
}

# ---------------------------------------------------------------------------
# Context snapshots (taken before pi launches; extension only reads them)
# ---------------------------------------------------------------------------
_lil_snapshot() {
  mkdir -p "$LIL_RUNTIME"
  pbpaste > "$LIL_RUNTIME/clip.txt" 2>/dev/null
  if [[ -n "$TMUX" ]]; then
    tmux capture-pane -p -S -200 > "$LIL_RUNTIME/term.txt" 2>/dev/null
  fi
}

# ---------------------------------------------------------------------------
# WezTerm user-var emission (DCS passthrough inside tmux)
# ---------------------------------------------------------------------------
_lil_uservar() {
  local b64
  b64="$(printf '%s' "$1" | base64)"
  if [[ -n "$TMUX" ]]; then
    printf '\033Ptmux;\033\033]1337;SetUserVar=LIL_SCRATCHPAD=%s\007\033\\' "$b64"
  else
    printf '\033]1337;SetUserVar=LIL_SCRATCHPAD=%s\007' "$b64"
  fi
}

# ---------------------------------------------------------------------------
# Spinner: owns the tty while pi runs; timeout at 120s
# ---------------------------------------------------------------------------
_lil_spinner() {
  local pid="$1"
  local start=$SECONDS
  local -a spin=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  local -a flavors=("consulting the vault archives…" "asking the overseer…" "thumbing the manual…")
  local i=0 si fi gpid
  _LIL_TIMEOUT=0
  while kill -0 "$pid" 2>/dev/null; do
    if (( SECONDS - start > LIL_TIMEOUT_SECS )); then
      [[ -f "$LIL_RUNTIME/last.pid" ]] && gpid="$(<"$LIL_RUNTIME/last.pid")"
      [[ -n "$gpid" ]] && kill "$gpid" 2>/dev/null
      kill "$pid" 2>/dev/null
      _LIL_TIMEOUT=1
      break
    fi
    si=$(( (i % ${#spin[@]}) + 1 ))
    fi=$(( (i / 8) % ${#flavors[@]} + 1 ))
    printf '\r %s %s' "${LIL_GREEN}${spin[$si]}${LIL_RESET}" \
      "${LIL_GRAY}${flavors[$fi]}${LIL_RESET}"
    i=$((i + 1))
    sleep 0.08
  done
  printf '\r\033[K'
}

# ---------------------------------------------------------------------------
# Invoke pi in a neutral cwd; answer lands in $LIL_ANSWER (global, not stdout,
# so the spinner and the interactive loop keep the current-shell context).
# ---------------------------------------------------------------------------
_lil_invoke() {
  local prompt="$1"
  local outfile="$LIL_RUNTIME/last.out"
  local errfile="$LIL_RUNTIME/last.err"
  local rcfile="$LIL_RUNTIME/last.rc"
  _lil_snapshot
  _lil_fingerprint
  : > "$outfile"
  : > "$rcfile"
  : > "$LIL_RUNTIME/last.pid"
  # `&!` disowns the subshell so the interactive shell prints no "[N] pid"
  # job-control line; the exit code is carried back via $rcfile instead of
  # wait, which cannot wait on a disowned child. The real pi pid is recorded
  # in last.pid so the spinner can reap pi itself on timeout (pi is a
  # grandchild, invisible to the shell's job table).
  (
    cd "$LIL_RUNTIME" || exit 1
    PI_CODING_AGENT_DIR="$LIL_HOME/pi" pi -p -nc \
      --session "$LIL_RUNTIME/session" \
      --append-system-prompt "$(cat "$LIL_RUNTIME/fingerprint.txt")" \
      "$prompt" > "$outfile" 2> "$errfile" &
    print -r -- $! > "$LIL_RUNTIME/last.pid"
    wait
    print -r -- $? > "$rcfile"
  ) &!
  local pid=$!
  _lil_spinner "$pid"
  local rc=0
  [[ -f "$rcfile" ]] && rc="$(<"$rcfile")"
  LIL_ANSWER=""
  if (( _LIL_TIMEOUT )); then
    print -r -- " ${LIL_AMBER}⚠ Timed out after ${LIL_TIMEOUT_SECS}s — the vault is slow today. Retry, boss.${LIL_RESET}"
    return 2
  fi
  if (( rc != 0 )); then
    print -r -- " ${LIL_AMBER}⚠ pi exited ($rc) — see $errfile. Retry, boss.${LIL_RESET}"
    return 2
  fi
  LIL_ANSWER="$(<"$outfile")"
  return 0
}

# ---------------------------------------------------------------------------
# lilcmd extraction: LAST ```lilcmd fence; content until the next ``` fence.
# Prints the command, or nothing + exit 1 when no block exists.
# ---------------------------------------------------------------------------
_lil_extract_cmd() {
  local text
  if (( $# > 0 )); then
    text="$1"
  else
    text="$(cat)"
  fi
  local -a lines
  lines=("${(f)text}")
  local i last=-1
  for (( i = 1; i <= ${#lines[@]}; i++ )); do
    if [[ "${lines[$i]}" =~ '^[[:space:]]*```lilcmd[[:space:]]*$' ]]; then
      last=$i
    fi
  done
  if (( last < 0 )); then
    return 1
  fi
  local -a out=()
  local j=$((last + 1)) closed=0
  while (( j <= ${#lines[@]} )); do
    if [[ "${lines[$j]}" =~ '^[[:space:]]*```[[:space:]]*$' ]]; then
      closed=1
      break
    fi
    out+=("${lines[$j]}")
    j=$((j + 1))
  done
  # End-of-input without a closing fence = malformed block; treat as none.
  (( closed )) || return 1
  print -r -- "${(F)out}"
  return 0
}

# ---------------------------------------------------------------------------
# Scratchpad box (display only — execution uses $cmd verbatim)
# ---------------------------------------------------------------------------
_lil_wrap() {
  local text="$1" width="$2"
  local ln out=() wrapped_line="" word
  for ln in ${(f)text}; do
    if [[ -z "$ln" ]]; then
      out+=("")
      continue
    fi
    wrapped_line=""
    for word in ${=ln}; do
      if [[ -z "$wrapped_line" ]] || (( ${#wrapped_line} + 1 + ${#word} <= width )); then
        [[ -n "$wrapped_line" ]] && wrapped_line+=" "
        wrapped_line+="$word"
      else
        out+=("$wrapped_line")
        wrapped_line="$word"
      fi
    done
    out+=("$wrapped_line")
  done
  print -r -- "${(F)out}"
}

_lil_scratchpad_box() {
  local cmd="$1"
  local width="${COLUMNS:-80}"
  (( width < 24 )) && width=24
  local cw=$((width - 4))
  local wrapped line pad
  wrapped="$(_lil_wrap "$cmd" "$cw")"
  print -r -- "${LIL_AMBER}╭──   SCRATCHPAD ${(l:$((width - 17))::─:)}╮${LIL_RESET}"
  for line in ${(f)wrapped}; do
    pad=$((cw - ${#line}))
    (( pad < 0 )) && pad=0
    print -r -- "${LIL_AMBER}│ ${LIL_GREEN}${line}${(l:$pad:: :)}${LIL_AMBER} │${LIL_RESET}"
  done
  print -r -- "${LIL_AMBER}╰${(l:$((width - 2))::─:)}╯${LIL_RESET}"
  print -r -- "   ${LIL_GRAY}⏎ dismiss${LIL_RESET}   ${LIL_AMBER}󰌑 ⌘⏎/^R run${LIL_RESET}   ${LIL_AMBER}⌘C/^Y copy${LIL_RESET}   ${LIL_GRAY}✏ type to follow up${LIL_RESET}"
}

# ---------------------------------------------------------------------------
# Line editor for follow-up input. Result in $LIL_FOLLOWUP.
# Bare Esc cancels (return 1); Enter submits (return 0).
# ---------------------------------------------------------------------------
_lil_followup() {
  local buf="$1"
  local key extra
  LIL_FOLLOWUP=""
  while true; do
    read -sk1 key || return 1
    case "$key" in
      $'\x0d'|$'\x0a') break ;;
      $'\x7f'|$'\x08') [[ -n "$buf" ]] && buf="${buf[1,-2]}" ;;
      $'\x1b')
        extra=""
        read -sk1 -t 0.01 extra 2>/dev/null
        if [[ -z "$extra" ]]; then
          printf '\r\033[K'
          return 1
        fi
        ;;
      [[:print:]]) buf+="$key" ;;
      *) ;;
    esac
    printf '\r\033[K %s› %s%s' "$LIL_GREEN" "$buf" "$LIL_RESET"
  done
  printf '\r\033[K'
  LIL_FOLLOWUP="$buf"
  return 0
}

_lil_run() {
  local cmd="$1"
  print -r -- "${LIL_GREEN}❯ $cmd${LIL_RESET}"
  print -s -- "$cmd"
  eval "$cmd"
}

_lil_copy() {
  local cmd="$1"
  printf %s "$cmd" | pbcopy
  print -r -- "${LIL_GREEN} 󰌑 copied to clipboard, boss.${LIL_RESET}"
}

# ---------------------------------------------------------------------------
# Interaction loop. $1 = the lilcmd command ("" = follow-up mode, no box).
# Enter/Esc/q dismiss. ^R/r and ^Y/c/y act only in scratchpad mode.
# Any other printable char starts a follow-up line.
# ---------------------------------------------------------------------------
_lil_loop() {
  local cmd="$1"
  local key extra new_answer newcmd
  if [[ -n "$cmd" ]]; then
    _lil_scratchpad_box "$cmd"
  fi
  while true; do
    read -sk1 key || return 0
    case "$key" in
      $'\x0d'|$'\x0a') return 0 ;;                    # Enter on empty -> dismiss
      $'\x12') [[ -n "$cmd" ]] && { _lil_run "$cmd"; return 0; } ;;  # ^R run
      $'\x19') [[ -n "$cmd" ]] && { _lil_copy "$cmd"; return 0; } ;;  # ^Y copy
      $'\x1b')
        extra=""
        read -sk1 -t 0.01 extra 2>/dev/null
        if [[ -z "$extra" ]]; then
          return 0                                    # bare Esc -> exit
        fi
        ;;
      [[:print:]])
        if [[ -n "$cmd" ]]; then
          case "$key" in
            r|R) _lil_run "$cmd"; return 0 ;;
            c|C|y|Y) _lil_copy "$cmd"; return 0 ;;
            q|Q) return 0 ;;
          esac
        fi
        _lil_followup "$key"
        if (( $? == 0 )); then
          _lil_invoke "$LIL_FOLLOWUP" || return 2
          _lil_print_answer "$LIL_ANSWER"
          newcmd="$(_lil_extract_cmd "$LIL_ANSWER")"
          if [[ -n "$newcmd" ]]; then
            cmd="$newcmd"
            _lil_scratchpad_box "$cmd"
          else
            cmd=""
          fi
        fi
        ;;
      *) ;;                                           # unknown control char: no-op
    esac
  done
}

_lil_print_answer() {
  local text="$1"
  [[ -n "$text" ]] || return 0
  print -r -- "$text" | sed 's/^/  /'
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
lil() {
  mkdir -p "$LIL_RUNTIME"
  command rm -f -- "$LIL_RUNTIME/session"
  _lil_uservar 1
  local rc=0
  {
    local prompt="$*"
    if [[ -z "$prompt" ]]; then
      print -r -- " ${LIL_AMBER}⚠ lil needs a prompt, boss: lil \"how do I …\"${LIL_RESET}"
      return 1
    fi
    print -r -- "${LIL_GREEN}╭─ 󰚩  LIL BUDDY ─ VAULT-TEC CERTIFIED ─╮${LIL_RESET}"
    if ! _lil_invoke "$prompt"; then
      return 2
    fi
    _lil_print_answer "$LIL_ANSWER"
    if [[ -t 0 ]]; then
      local cmd
      cmd="$(_lil_extract_cmd "$LIL_ANSWER")"
      if [[ -n "$cmd" ]]; then
        _lil_loop "$cmd"
        rc=$?
      else
        _lil_loop ""
        rc=$?
      fi
    fi
    return "$rc"
  } always {
    _lil_uservar 0
  }
}
