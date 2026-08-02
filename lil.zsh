# lil.zsh — Lil Buddy: quick-access terminal guru (pi + deepseek-v4-flash)
# Sourced from ~/.oh-my-zsh/custom/lil.zsh (created by install.zsh).

LIL_HOME="${LIL_HOME:-${${(%):-%x}:A:h}}"
LIL_RUNTIME="${LIL_RUNTIME:-$HOME/.cache/lil}"
LIL_TIMEOUT_SECS="${LIL_TIMEOUT_SECS:-120}"

# Pip-Boy palette (256-color raw escapes)
LIL_GREEN=$'\e[38;5;84m'    # bright Pip-Boy green
LIL_DIM=$'\e[38;5;41m'      # dim Pip-Boy green
LIL_AMBER=$'\e[38;5;214m'   # amber (warnings / accents)
LIL_GRAY=$'\e[38;5;244m'    # chrome
LIL_RESET=$'\e[0m'
LIL_BOLD=$'\e[1m'           # bold
LIL_ITALIC=$'\e[3m'         # italic

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
    local term_prog="unknown"
    if [[ -n "$TERM_PROGRAM" ]]; then
      term_prog="$TERM_PROGRAM"
    elif [[ -n "$TMUX" ]]; then
      term_prog="$(tmux show-environment -g TERM_PROGRAM 2>/dev/null | cut -d= -f2)"
      [[ -n "$term_prog" ]] || term_prog="unknown"
    fi
    print -r -- "terminal: $term_prog"
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
# Spinner v4: RobCo decryption — the stage message materializes from scrambled
# glyph junk, Fallout-terminal-hacking style. No scrolling: a STATIC ramp
# gradient locks chars in 2 per frame, one random locked char glitches back to
# junk every 7th frame once fully locked, and the cursor blinks 4/4 frames.
# Stage comes from the pi --mode json event tracker ($LIL_RUNTIME/stage).
# Timeout at 120s unchanged.
# ---------------------------------------------------------------------------

# 256-color gradient ramp; color cycles by character position within the message
# (STATIC — it never moves; the animation is the flickering junk, not the
# gradient). i%12 for 1-based i would hit an empty arr[0] at 12,24,...; the
# (i-1)%12+1 form is the same 12-cycle with every slot valid.
_lil_ramp=(196 208 214 226 118 46 49 51 45 39 93 201)

# Decrypt-junk pool (single-byte ASCII only — never multibyte).
_LIL_JUNK=('!' '@' '#' '$' '%' '&' '*' '+' '=' '?' '/' '\' '|' '<' '>' '[' ']' '{' '}' '~' '^' '0' '1')

# Print ONE decrypt frame line (no \r/\033[K — the spinner loop adds those):
# amber "☢ " prefix + per-char message rendering + amber " ▊" cursor.
# Args: <message> <locked-csv> <glitch-index> <cursor-on>.
#   locked-csv: comma-separated 1-based message indices whose TRUE char renders
#     in the static ramp gradient; every other non-space char renders random
#     junk in dim green (41). Spaces always render as spaces.
#   glitch-index: 0 = none, else that index renders junk this single frame
#     (wins over locked).
#   cursor-on: 1/0 — only the trailing ▊/blank cell differs.
# Deterministic given its args EXCEPT the junk glyph choice (RANDOM per call).
_lil_decrypt_frame() {
  local msg="$1" locked_csv="$2" glitch="$3" cursor="$4"
  local -A locked
  local i ch out=""
  local -a idxs=("${(@s:,:)locked_csv}")
  for i in "${idxs[@]}"; do
    locked[$i]=1
  done
  out+="${LIL_AMBER}☢ "
  for (( i = 1; i <= ${#msg}; i++ )); do
    ch="${msg[i]}"
    if [[ "$ch" == ' ' ]]; then
      out+=' '
    elif (( glitch > 0 && glitch == i )); then
      out+="${LIL_DIM}${_LIL_JUNK[$(( RANDOM % ${#_LIL_JUNK[@]} + 1 ))]}"
    elif (( locked[$i] )); then
      out+=$'\e[38;5;'"${_lil_ramp[(( ((i - 1) % 12) + 1 ))]}m${ch}"
    else
      out+="${LIL_DIM}${_LIL_JUNK[$(( RANDOM % ${#_LIL_JUNK[@]} + 1 ))]}"
    fi
  done
  out+="${LIL_AMBER}"
  if (( cursor == 1 )); then
    out+=" ▊"
  else
    out+="  "
  fi
  out+="${LIL_RESET}"
  print -rn -- "$out"
}

# Stage-file reader (separate tiny helper so tests can drive the spinner's
# state machine without a live run).
_lil_read_stage() {
  [[ -f "$LIL_RUNTIME/stage" ]] && print -r -- "$(<"$LIL_RUNTIME/stage")"
}

# Persist ONE WORD + optional detail to $LIL_RUNTIME/stage; append transitions
# (with timestamp) to $LIL_RUNTIME/stage.log.
_lil_set_stage() {
  local s="$1" cur=""
  [[ -f "$LIL_RUNTIME/stage" ]] && cur="$(<"$LIL_RUNTIME/stage")"
  [[ "$s" == "$cur" ]] && return 0
  print -r -- "$s" > "$LIL_RUNTIME/stage"
  print -r -- "$(date +%H:%M:%S) $s" >> "$LIL_RUNTIME/stage.log"
}

# Advance the stage machine from one JSONL event line:
# start → thinking (first message_update) → tool:<name> (tool execution start)
# → writing (message_updates resuming after tools) → done (agent_end).
_lil_track_stage() {
  local line="$1" t
  t="$(jq -r 'if .type=="agent_end" then "done"
             elif .type=="tool_execution_start" then "tool:"+(.toolName//"")
             elif .type=="message_update" then "msg"
             else "" end' <<<"$line" 2>/dev/null)"
  case "$t" in
    done) _lil_set_stage done ;;
    tool:*) _LIL_WAS_TOOL=1; _lil_set_stage "$t" ;;
    msg)
      if (( _LIL_WAS_TOOL )); then
        _LIL_WAS_TOOL=0
        _lil_set_stage writing
      elif (( ! _LIL_SEEN_MSG )); then
        _LIL_SEEN_MSG=1
        _lil_set_stage thinking
      fi
      ;;
  esac
}

_lil_spinner() {
  local pid="$1"
  local start=$SECONDS
  local stage="" prevstage="" msg="" prevmsg="" msg_full=""
  local -i framecount=0 lockpos=0 heavy=0
  local -a perm=() locked=() newlocked=() news=() locked_idx=()
  local glitch=0 cursor_on=1 locked_csv="" gpid
  local nlen=0 olen=0 i=0 j=0 tmp=0 n=0 k=0
  # NOTE: every local is declared up here, before the loop. In an interactive
  # shell, `local` inside a while-loop body makes zsh echo `var=value` lines
  # into stdout after each iteration — the spinner must never leak that noise.
  _LIL_TIMEOUT=0
  while kill -0 "$pid" 2>/dev/null; do
    if (( SECONDS - start > LIL_TIMEOUT_SECS )); then
      [[ -f "$LIL_RUNTIME/last.pid" ]] && gpid="$(<"$LIL_RUNTIME/last.pid")"
      [[ -n "$gpid" ]] && kill "$gpid" 2>/dev/null
      kill "$pid" 2>/dev/null
      _LIL_TIMEOUT=1
      break
    fi
    stage="$(_lil_read_stage)"
    [[ -z "$stage" ]] && stage="start"
    case "$stage" in
      tool:*) msg="ACCESSING ${(U)stage#tool:}" ;;
      thinking) msg="OVERSEER IS THINKING" ;;
      writing) msg="DECRYPTING RESPONSE" ;;
      *) msg="ESTABLISHING VAULT LINK" ;;
    esac
    if [[ "$stage" != "$prevstage" ]]; then
      # (re)key to the new transmission: carry locked state only where old and
      # new messages share the same char at the same position; everything else
      # restarts as junk, and the lock order is rebuilt from the unlocked ones.
      newlocked=()
      nlen=${#msg}
      olen=${#prevmsg}
      for (( i = 1; i <= nlen; i++ )); do
        if (( i <= olen )) && [[ "${msg[i]}" == "${prevmsg[i]}" ]] && (( locked[i] )); then
          newlocked[i]=1
        else
          newlocked[i]=0
        fi
      done
      locked=("${newlocked[@]}")
      perm=()
      for (( i = 1; i <= nlen; i++ )); do
        [[ "${msg[i]}" == ' ' ]] && continue
        (( locked[i] )) && continue
        perm+=($i)
      done
      n=${#perm[@]}
      for (( i = n; i > 1; i-- )); do          # Fisher–Yates shuffle
        j=$(( RANDOM % i + 1 ))
        tmp=${perm[i]}; perm[i]=${perm[j]}; perm[j]=$tmp
      done
      lockpos=0
      heavy=0
      prevstage="$stage"
      prevmsg="$msg"
    fi
    msg_full="$msg"
    if (( SECONDS - start > 25 )); then
      msg_full+=" [HEAVY LOAD]"
      if (( ! heavy )); then
        heavy=1
        # the appended chars join the effect: appended to the lock order,
        # shuffled, so they lock in alongside the original message
        news=()
        for (( i = ${#msg} + 1; i <= ${#msg_full}; i++ )); do
          [[ "${msg_full[i]}" == ' ' ]] && continue
          news+=($i)
        done
        n=${#news[@]}
        for (( i = n; i > 1; i-- )); do
          j=$(( RANDOM % i + 1 ))
          tmp=${news[i]}; news[i]=${news[j]}; news[j]=$tmp
        done
        perm+=( "${news[@]}" )
      fi
    fi
    # lock 2 indices per frame, in permutation order
    k=0
    while (( k < 2 && lockpos < ${#perm[@]} )); do
      lockpos=$(( lockpos + 1 ))
      locked[${perm[lockpos]}]=1
      k=$(( k + 1 ))
    done
    # idle glitch: when everything is locked, every 7th frame one random locked
    # index renders as junk for a single frame, then restores
    glitch=0
    if (( lockpos >= ${#perm[@]} )) && (( framecount % 7 == 0 )); then
      locked_idx=()
      for (( i = 1; i <= ${#msg_full}; i++ )); do
        (( locked[i] )) && locked_idx+=($i)
      done
      if (( ${#locked_idx[@]} > 0 )); then
        glitch=${locked_idx[$(( RANDOM % ${#locked_idx[@]} + 1 ))]}
      fi
    fi
    # cursor blink: on 4 frames / off 4 frames
    if (( (framecount / 4) % 2 == 0 )); then cursor_on=1; else cursor_on=0; fi
    locked_csv=""
    for (( i = 1; i <= ${#msg_full}; i++ )); do
      (( locked[i] )) && locked_csv+="${i},"
    done
    locked_csv="${locked_csv%,}"
    printf '\r\033[K'
    _lil_decrypt_frame "$msg_full" "$locked_csv" "$glitch" "$cursor_on"
    sleep 0.07
    framecount=$(( framecount + 1 ))
  done
  printf '\r\033[K'
}

# ---------------------------------------------------------------------------
# Extract the assistant's raw markdown from a pi --mode json log: concatenate
# every text_delta (byte-faithful to what `-p` text mode streamed). Fallback:
# the final assistant message's text blocks (agent_end), in case no deltas ran.
# ---------------------------------------------------------------------------
_lil_extract_answer() {
  local jsonl="${1:-$LIL_RUNTIME/last.out}"
  local out
  out="$(jq -jr 'select(.type=="message_update" and .assistantMessageEvent.type=="text_delta") | .assistantMessageEvent.delta' "$jsonl" 2>/dev/null)"
  if [[ -z "$out" ]]; then
    out="$(jq -r 'select(.type=="agent_end") | .messages[] | select(.role=="assistant") | .content[]? | select(.type=="text") | .text' "$jsonl" 2>/dev/null)"
  fi
  print -r -- "$out"
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
  : > "$LIL_RUNTIME/stage"
  : > "$LIL_RUNTIME/stage.log"
  # `&!` disowns the subshell so the interactive shell prints no "[N] pid"
  # job-control line; pi's exit code is carried back via $rcfile.
  (
    cd "$LIL_RUNTIME" || exit 1
    _LIL_WAS_TOOL=0
    _LIL_SEEN_MSG=0
    _lil_set_stage start
    # pi runs in --mode json (event stream). It is backgrounded INSIDE the
    # group so `$!` → last.pid is pi's REAL pid (timeout reaping unchanged);
    # the group's `wait` exit status is pi's, surfaced via pipestatus[1].
    # tee mirrors the raw JSONL to $outfile while the reader loop drives the
    # stage machine live. `< /dev/null` guarantees pi stdin EOF — in a non-tty
    # context pi blocks on an open stdin, and the interactive shell owns the
    # tty anyway.
    { PI_CODING_AGENT_DIR="$LIL_HOME/pi" pi --mode json -nc \
        --exclude-tools bash,edit,write \
        --session "$LIL_RUNTIME/session" \
        --append-system-prompt "$(cat "$LIL_RUNTIME/fingerprint.txt")" \
        "$prompt" < /dev/null 2> "$errfile" &
      print -r -- $! > "$LIL_RUNTIME/last.pid"
      wait
    } | tee "$outfile" | while IFS= read -r line; do
        _lil_track_stage "$line"
      done
    print -r -- ${pipestatus[1]} > "$rcfile"
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
  LIL_ANSWER="$(_lil_extract_answer "$outfile")"
  return 0
}

# ---------------------------------------------------------------------------
# lilcmd extraction: LAST ```lilcmd fence OR <lilcmd> tag block, by position.
# Prints the command (RC=0) or nothing + RC=1 when no well-formed block exists.
# ---------------------------------------------------------------------------
_lil_find_block() {
  local text="$1"
  local -a lines=("${(f)text}")
  local i last=-1 last_kind="" line
  for (( i = 1; i <= ${#lines[@]}; i++ )); do
    line="${lines[$i]}"
    if [[ "$line" =~ '^[[:space:]]*```lilcmd[[:space:]]*$' ]]; then
      last=$i; last_kind="fence"
    elif [[ "$line" =~ '^[[:space:]]*<lilcmd>[[:space:]]*$' ]]; then
      last=$i; last_kind="tag"
    fi
  done
  (( last > 0 )) || return 1
  local close
  if [[ "$last_kind" == "fence" ]]; then
    close='^[[:space:]]*```[[:space:]]*$'
  else
    close='^[[:space:]]*</lilcmd>[[:space:]]*$'
  fi
  local j end=-1
  for (( j = last + 1; j <= ${#lines[@]}; j++ )); do
    if [[ "${lines[$j]}" =~ $close ]]; then
      end=$j
      break
    fi
  done
  (( end > 0 )) || return 1
  print -r -- "$last $end $last_kind"
  return 0
}

_lil_extract_cmd() {
  local text
  if (( $# > 0 )); then
    text="$1"
  else
    text="$(cat)"
  fi
  local spec
  spec="$(_lil_find_block "$text")" || return 1
  local start="${spec%% *}"
  local rest="${spec#* }"
  local end="${rest%% *}"
  local -a lines=("${(f)text}")
  local -a out=()
  local j
  for (( j = start + 1; j < end; j++ )); do
    out+=("${lines[$j]}")
  done
  print -r -- "${(F)out}"
  return 0
}

# Strip the matched lilcmd block (tag/fence lines included) from the answer,
# trimming trailing blank lines. No block present -> input unchanged (RC=0).
_lil_strip_cmd() {
  local text
  if (( $# > 0 )); then
    text="$1"
  else
    text="$(cat)"
  fi
  local spec
  spec="$(_lil_find_block "$text")" || { print -r -- "$text"; return 0; }
  local start="${spec%% *}"
  local rest="${spec#* }"
  local end="${rest%% *}"
  local -a lines=("${(f)text}")
  local -a out=()
  local j
  for (( j = 1; j <= ${#lines[@]}; j++ )); do
    (( j < start || j > end )) && out+=("${lines[$j]}")
  done
  while (( ${#out[@]} > 0 )) && [[ -z "${out[-1]//[[:space:]]/}" ]]; do
    out[-1]=()
  done
  print -r -- "${(F)out}"
  return 0
}

# ---------------------------------------------------------------------------
# Renderer helpers
# ---------------------------------------------------------------------------
# Word-wrap $1 to width $2 at word boundaries, treating inline `code` spans as
# atomic (inner spaces are protected so a span never straddles a wrap point).
_lil_wrap_prose() {
  local text="$1" width="$2"
  local prot="" in_code=0 i=0
  for (( i = 1; i <= ${#text}; i++ )); do
    local ch="${text[$i]}"
    if [[ "$ch" == '`' ]]; then
      in_code=$((1 - in_code)); prot+="$ch"
    elif (( in_code )) && [[ "$ch" == [[:space:]] ]]; then
      prot+=$'\x1e'
    else
      prot+="$ch"
    fi
  done
  local -a words=()
  words=(${=prot})
  local -a out=()
  local line="" w
  for w in "${words[@]}"; do
    if [[ -z "$line" ]]; then
      line="$w"
    elif (( ${#line} + 1 + ${#w} <= width )); then
      line+=" $w"
    else
      out+=("$line"); line="$w"
    fi
  done
  [[ -n "$line" ]] && out+=("$line")
  local -a rendered=()
  local l=
  for l in "${out[@]}"; do
    rendered+=("${l//$'\x1e'/ }")
  done
  print -r -- "${(F)rendered}"
}

# Apply inline markdown (code / bold / italic) to one content line. zsh-only
# parameter expansion — no sed — so `/`, `&`, `\` and quotes pass through.
_lil_inline() {
  local s="$1" out="" rest="$1"
  while [[ -n "$rest" ]]; do
    if [[ "$rest" == \`* ]]; then
      local inner="${rest#\`}"
      if [[ "$inner" == *\`* ]]; then
        local content="${inner%%\`*}"
        out+="${LIL_AMBER}${content}${LIL_RESET}"
        rest="${inner:${#content}+1}"
      else
        out+='`'; rest="$inner"
      fi
    elif [[ "$rest" == \*\** ]]; then
      local tail="${rest:2}"
      if [[ "$tail" == *\*\** ]]; then
        local content="${tail%%\*\**}"
        out+="${LIL_BOLD}${LIL_GREEN}${content}${LIL_RESET}"
        rest="${tail:${#content}+2}"
      else
        out+="**"; rest="$tail"
      fi
    elif [[ "$rest" == \** ]]; then
      local tail="${rest:1}"
      if [[ "$tail" == *\** ]]; then
        local content="${tail%%\**}"
        out+="${LIL_ITALIC}${LIL_DIM}${content}${LIL_RESET}"
        rest="${tail:${#content}+1}"
      else
        out+="*"; rest="$tail"
      fi
    else
      local head="${rest%%[\`*]*}"
      out+="$head"
      rest="${rest:${#head}}"
    fi
  done
  print -r -- "$out"
}

# Hard (character-exact) wrap of $1 to width $2 — display only, bytes preserved.
_lil_wrap_hard() {
  local text="$1" width="$2"
  local -a out=()
  local rem="$text" chunk=
  while [[ -n "$rem" ]]; do
    chunk="${rem[1,width]}"
    out+=("$chunk")
    rem="${rem:${#chunk}}"
  done
  print -r -- "${(F)out}"
}

# ---------------------------------------------------------------------------
# ANSI markdown renderer: line-state machine (in/out of ``` fence).
# ---------------------------------------------------------------------------
_lil_render() {
  local text="$1"
  local cols="${COLUMNS:-80}"
  (( cols < 24 )) && cols=24
  local W=$(( cols > 100 ? 100 : cols ))
  local CW=$(( W - 4 ))
  (( CW < 20 )) && CW=20
  local -a lines=("${(f)text}")
  local -a out=()
  local i=0 in_fence=0 prev_blank=0 ln=
  for (( i = 1; i <= ${#lines[@]}; i++ )); do
    ln="${lines[$i]}"
    local nospace="${ln#"${ln%%[![:space:]]*}"}"
    if (( in_fence )); then
      if [[ "$nospace" == \`\`\`* ]]; then
        in_fence=0
        if (( ${#out[@]} > 0 )) && [[ -n "${out[-1]}" ]]; then out+=(""); fi
        prev_blank=1
        continue
      fi
      local rem="$ln" chunk=
      if [[ -z "$rem" ]]; then
        out+=("${LIL_GRAY}  ┃ ${LIL_RESET}")
      else
        while [[ -n "$rem" ]]; do
          chunk="${rem[1,CW]}"
          out+=("${LIL_GRAY}  ┃ ${LIL_RESET}${LIL_GREEN}${chunk}${LIL_RESET}")
          rem="${rem:${#chunk}}"
        done
      fi
      prev_blank=0
      continue
    fi
    if [[ "$nospace" == \`\`\`* ]]; then
      if (( ${#out[@]} > 0 )) && [[ -n "${out[-1]}" ]]; then out+=(""); fi
      in_fence=1
      prev_blank=1
      continue
    fi
    if [[ -z "${ln//[[:space:]]/}" ]]; then
      (( prev_blank )) || out+=("")
      prev_blank=1
      continue
    fi
    prev_blank=0
    if [[ "$nospace" =~ '^#{1,3}[[:space:]]+.*' ]]; then
      local hashes="${nospace%%[[:space:]]*}"
      local htext="${nospace#${hashes}}"
      htext="${htext#"${htext%%[![:space:]]*}"}"
      local plain="◆ ${(U)htext}"
      local rule_len=$(( CW - ${#plain} ))
      (( rule_len < 0 )) && rule_len=0
      out+=("${LIL_BOLD}${LIL_GREEN}  ${plain}${LIL_RESET}${LIL_AMBER}${(l:$rule_len::─:)}${LIL_RESET}")
      out+=("")
      prev_blank=1
    elif [[ "$nospace" =~ '^(-|[*])[[:space:]]+.*' ]]; then
      local content="${nospace:1}"
      content="${content#"${content%%[![:space:]]*}"}"
      local wrapped="$(_lil_wrap_prose "$content" "$CW")"
      local wl= first=1
      for wl in ${(f)wrapped}; do
        if (( first )); then
          out+=("${LIL_GREEN} ▸ ${LIL_RESET}$(_lil_inline "$wl")")
          first=0
        else
          out+=("   $(_lil_inline "$wl")")
        fi
      done
    elif [[ "$nospace" =~ '^[0-9]+[.][[:space:]]+.*' ]]; then
      local num="${nospace%%[.]*}"
      local rest3="${nospace#${num}.}"
      rest3="${rest3#"${rest3%%[![:space:]]*}"}"
      local wrapped="$(_lil_wrap_prose "$rest3" "$CW")"
      local pad="${(l:${#num}+2:: :)}"
      local wl= first=1
      for wl in ${(f)wrapped}; do
        if (( first )); then
          out+=("${LIL_GREEN}${num}.${LIL_RESET} $(_lil_inline "$wl")")
          first=0
        else
          out+=("$pad$(_lil_inline "$wl")")
        fi
      done
    else
      local wrapped="$(_lil_wrap_prose "$nospace" "$CW")"
      local wl=
      for wl in ${(f)wrapped}; do
        out+=("  $(_lil_inline "$wl")")
      done
    fi
  done
  print -r -- "${(F)out}"
}

# ---------------------------------------------------------------------------
# Scratchpad box (display only — execution uses $cmd verbatim)
# ---------------------------------------------------------------------------
_lil_scratchpad_box() {
  local cmd="$1"
  local width="${COLUMNS:-80}"
  (( width > 100 )) && width=100
  (( width < 24 )) && width=24
  local cw=$((width - 8))
  local line= pad= wrapped= first= sp=
  local top_fill=$((width - 29)); (( top_fill < 0 )) && top_fill=0
  local bot_fill=$((width - 24)); (( bot_fill < 0 )) && bot_fill=0
  print -r -- "${LIL_AMBER}  ╔═ ☢  S C R A T C H P A D ${(l:$top_fill::═:)}╗${LIL_RESET}"
  wrapped="$(_lil_wrap_hard "$cmd" "$cw")"
  first=1
  for line in ${(f)wrapped}; do
    pad=$((width - 8 - ${#line}))
    (( pad < 0 )) && pad=0
    sp="${(l:$pad:: :)}"
    if (( first )); then
      print -r -- "${LIL_AMBER}  ║ ${LIL_RESET}${LIL_BOLD}${LIL_GREEN}❯ ${line}${sp}${LIL_AMBER} ║${LIL_RESET}"
      first=0
    else
      print -r -- "${LIL_AMBER}  ║${LIL_RESET}${LIL_BOLD}${LIL_GREEN}   ${line}${sp}${LIL_AMBER} ║${LIL_RESET}"
    fi
  done
  print -r -- "${LIL_AMBER}  ╚${(l:$bot_fill::═:)} AWAITING ORDERS ═══╝${LIL_RESET}"
  print -r -- "    ${LIL_GRAY}[${LIL_RESET}${LIL_AMBER}⏎${LIL_RESET} ${LIL_DIM}dismiss${LIL_RESET}${LIL_GRAY}]${LIL_RESET}  ${LIL_GRAY}[${LIL_RESET}${LIL_AMBER}^R ⌘⏎${LIL_RESET} ${LIL_BOLD}${LIL_GREEN}RUN${LIL_RESET}${LIL_GRAY}]${LIL_RESET}  ${LIL_GRAY}[${LIL_RESET}${LIL_AMBER}^Y ⌘C${LIL_RESET} ${LIL_DIM}copy${LIL_RESET}${LIL_GRAY}]${LIL_RESET}  ${LIL_GRAY}[${LIL_RESET}${LIL_AMBER}✏${LIL_RESET} ${LIL_DIM}type to reply${LIL_RESET}${LIL_GRAY}]${LIL_RESET}"
}

# ---------------------------------------------------------------------------
# Line editor for follow-up input. Result in $LIL_FOLLOWUP.
# Bare Esc cancels (return 1); Enter submits (return 0).
# ---------------------------------------------------------------------------
_lil_followup() {
  local buf="$1"
  local color="${2:-$LIL_GREEN}"
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
    printf '\r\033[K %s› %s%s' "$color" "$buf" "$LIL_RESET"
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
  print -r -- "${LIL_GREEN} ☑ copied — go get 'em, boss.${LIL_RESET}"
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
        local pc="$LIL_GREEN"
        [[ -n "$cmd" ]] && pc="$LIL_AMBER"
        _lil_followup "$key" "$pc"
        if (( $? == 0 )); then
          _lil_invoke "$LIL_FOLLOWUP" || return 2
          _lil_render "$(_lil_strip_cmd "$LIL_ANSWER")"
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
    _lil_render "$(_lil_strip_cmd "$LIL_ANSWER")"
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
