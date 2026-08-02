#!/bin/zsh
# spinner-fixture.zsh — fixture-driven tests for the RobCo decryption spinner v4
# (_lil_decrypt_frame) and the pi --mode json stage/extraction pipeline.
# The decrypt frame is deterministic given its args EXCEPT the junk glyph choice,
# so these tests assert structure (color/char per position, junk-pool
# membership), never exact junk chars.
# Run from the repo root:  zsh tests/spinner-fixture.zsh
set -e
cd "${0:A:h}/.." || exit 1
source ./lil.zsh

ESC=$'\e'
RESET="${ESC}[0m"
SGR_RE="$(printf '%s\[38;5;([0-9]+)m(.)' $ESC)"
fail=0
check() {
  if eval "$2"; then
    print -r -- "ok:   $1"
  else
    print -r -- "FAIL: $1"
    fail=1
  fi
}

# Parse a decrypt frame into "color<TAB>char" tokens; unstyled cells are "-".
parse_frame() {
  local s="$1"
  local -a out=()
  while [[ -n "$s" ]]; do
    if [[ "$s" == $ESC* ]]; then
      if [[ "$s" =~ $SGR_RE ]]; then
        out+=("${match[1]}"$'\t'"${match[2]}")
        s="${s:${#MATCH}}"
      else
        break
      fi
    else
      out+=("-"$'\t'"${s[1]}")
      s="${s:1}"
    fi
  done
  print -r -- "${(F)out}"
}

T_PREFIX="214"$'\t'"☢"
T_SPACE="-"$'\t'" "
T_CUR_ON="-"$'\t'"▊"
T_CUR_OFF="-"$'\t'" "

MSG="OVERSEER IS THINKING"   # 20 chars; spaces at 9 and 12
ALL_LOCKED="1,2,3,4,5,6,7,8,10,11,13,14,15,16,17,18,19,20"

# --- 1. none locked: amber ☢ prefix, every non-space char is dim-green junk
#        from the pool, spaces preserved, amber ▊ cursor + [0m at the end
f="$(COLUMNS=80 _lil_decrypt_frame "$MSG" "" 0 1)"
toks=("${(@f)$(parse_frame "$f")}")
check "frame opens with amber ☢ then a plain space" \
  "[[ \"\${toks[1]}\" == \"\$T_PREFIX\" && \"\${toks[2]}\" == \"\$T_SPACE\" ]]"
check "frame ends with amber ▊ cursor and [0m reset" \
  "[[ \"\${toks[-1]}\" == \"\$T_CUR_ON\" && \"\${toks[-2]}\" == \"214\"$'\t'\" \" && \"\$f\" == *\"\$RESET\" ]]"
check "token count = prefix + message + cursor cells" \
  '[[ ${#toks[@]} -eq $(( 2 + ${#MSG} + 2 )) ]]'
allgood=1
for (( i = 1; i <= ${#MSG}; i++ )); do
  tok="${toks[$(( i + 2 ))]}"
  col="${tok%%$'\t'*}"
  ch="${tok#*$'\t'}"
  if [[ "${MSG[i]}" == ' ' ]]; then
    [[ "$tok" == "$T_SPACE" ]] || allgood=0
  else
    [[ "$col" == "41" && ${_LIL_JUNK[(Ie)$ch]} -gt 0 ]] || allgood=0
  fi
done
check "none-locked: every non-space char is dim-green junk, spaces preserved" \
  '[[ $allgood -eq 1 ]]'

# --- 2. partial lock "1,2,3,10": those are TRUE chars in the static ramp
#        colors, everything else is junk
f="$(COLUMNS=80 _lil_decrypt_frame "$MSG" "1,2,3,10" 0 1)"
toks=("${(@f)$(parse_frame "$f")}")
check "locked 1 → ramp[1]=196 'O'"   '[[ "${toks[3]}" == "196"$'"'"'\t'"'"'"O" ]]'
check "locked 2 → ramp[2]=208 'V'"   '[[ "${toks[4]}" == "208"$'"'"'\t'"'"'"V" ]]'
check "locked 3 → ramp[3]=214 'E'"   '[[ "${toks[5]}" == "214"$'"'"'\t'"'"'"E" ]]'
check "locked 10 → ramp[10]=39 'I'"  '[[ "${toks[12]}" == "39"$'"'"'\t'"'"'"I" ]]'
allgood=1
for (( i = 1; i <= ${#MSG}; i++ )); do
  tok="${toks[$(( i + 2 ))]}"
  col="${tok%%$'\t'*}"
  ch="${tok#*$'\t'}"
  (( i == 1 || i == 2 || i == 3 || i == 10 )) && continue
  if [[ "${MSG[i]}" == ' ' ]]; then
    [[ "$tok" == "$T_SPACE" ]] || allgood=0
  else
    [[ "$col" == "41" && ${_LIL_JUNK[(Ie)$ch]} -gt 0 ]] || allgood=0
  fi
done
check "partial-lock: all other non-space chars are dim-green junk" \
  '[[ $allgood -eq 1 ]]'

# --- 3. all locked + glitch 5: only index 5 is junk this frame; running twice
#        may change the junk glyph but never the locked structure
t1=("${(@f)$(parse_frame "$(COLUMNS=80 _lil_decrypt_frame "$MSG" "$ALL_LOCKED" 5 1)")}")
t2=("${(@f)$(parse_frame "$(COLUMNS=80 _lil_decrypt_frame "$MSG" "$ALL_LOCKED" 5 1)")}")
allgood=1
for (( i = 1; i <= ${#MSG}; i++ )); do
  tok="${t1[$(( i + 2 ))]}"
  col="${tok%%$'\t'*}"
  ch="${tok#*$'\t'}"
  if [[ "${MSG[i]}" == ' ' ]]; then
    [[ "$tok" == "$T_SPACE" ]] || allgood=0
  elif (( i == 5 )); then
    [[ "$col" == "41" && ${_LIL_JUNK[(Ie)$ch]} -gt 0 ]] || allgood=0   # glitched: junk
  else
    [[ "$col" == "${_lil_ramp[(( ((i - 1) % 12) + 1 ))]}" && "$ch" == "${MSG[i]}" ]] || allgood=0
  fi
done
check "all-locked+glitch: index 5 is junk, every other char true in static ramp" \
  '[[ $allgood -eq 1 ]]'
same_except_glitch=1
for (( i = 1; i <= ${#t1[@]}; i++ )); do
  (( i == 7 )) && continue      # message index 5 → token 5+2
  [[ "${t1[$i]}" == "${t2[$i]}" ]] || same_except_glitch=0
done
check "glitch run twice: locked structure identical outside the glitched cell" \
  '[[ $same_except_glitch -eq 1 ]]'

# --- 4. cursor: on vs off differ only in the trailing ▊ cell
# Seed RANDOM before each call so the junk is identical in both frames and the
# only remaining difference is the cursor cell (zsh reseeds subshell RANDOM).
RANDOM=7
on=("${(@f)$(parse_frame "$(COLUMNS=80 _lil_decrypt_frame "$MSG" "" 1 1)")}")
RANDOM=7
off=("${(@f)$(parse_frame "$(COLUMNS=80 _lil_decrypt_frame "$MSG" "" 1 0)")}")
check "cursor on/off have the same token count" '[[ ${#on[@]} -eq ${#off[@]} ]]'
same_except_cur=1
for (( i = 1; i <= ${#on[@]}; i++ )); do
  if (( i == ${#on[@]} )); then
    [[ "${on[$i]}" == "$T_CUR_ON" && "${off[$i]}" == "$T_CUR_OFF" ]] || same_except_cur=0
  else
    [[ "${on[$i]}" == "${off[$i]}" ]] || same_except_cur=0
  fi
done
check "cursor on/off differ only in the trailing ▊ cell" '[[ $same_except_cur -eq 1 ]]'

# --- 5. JSONL answer extraction: clean markdown, no JSON artifacts
tmp="$(mktemp -d)"
printf '%s\n' \
  '{"type":"session","version":3}' \
  '{"type":"agent_start"}' \
  '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Here is the plan:\n"}}' \
  '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"```lilcmd\nls -la\n```\n"}}' \
  '{"type":"agent_end","messages":[]}' > "$tmp/in.jsonl"
answer="$(_lil_extract_answer "$tmp/in.jsonl")"
check "extraction concatenates text deltas" \
  '[[ "$answer" == *"Here is the plan:"*"ls -la"* ]]'
check "extraction has no JSON artifacts" \
  '[[ "$answer" != *"message_update"* && "$answer" != *"assistantMessageEvent"* && "$answer" != *"{"* ]]'
FENCE='```lilcmd'
check "extraction keeps the lilcmd fence intact" \
  '[[ "$answer" == *"$FENCE"* && "$answer" == *"ls -la"* ]]'

# --- 6. stage machine: start → thinking → tool:<name> → writing → done
stage_run="$(mktemp -d)"
LIL_RUNTIME="$stage_run"
_LIL_WAS_TOOL=0
_LIL_SEEN_MSG=0
_lil_set_stage start
feed() {
  for l in "$@"; do _lil_track_stage "$l"; done
}
feed '{"type":"agent_start"}'
feed '{"type":"message_update","assistantMessageEvent":{"type":"thinking_start","delta":""}}'
feed '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"x"}}'
feed '{"type":"tool_execution_start","toolCallId":"c1","toolName":"read_clipboard","args":{}}'
feed '{"type":"message_update","assistantMessageEvent":{"type":"thinking_start","delta":""}}'
feed '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"answer"}}'
feed '{"type":"agent_end","messages":[]}'
seq_log="$(sed -E 's/^[0-9:]+ //' "$stage_run/stage.log")"
check "stage sequence is start→thinking→tool→writing→done" \
  '[[ "$(print -r -- "$seq_log" | tr "\n" " " | sed "s/ $//")" == "start thinking tool:read_clipboard writing done" ]]'
check "stage file ends at done" \
  '[[ "$(<"$stage_run/stage")" == "done" ]]'

# --- 7. extractor fence test (```lilcmd block)
fenced=$'Prose above.\n```lilcmd\nls -la\n```\nMore prose.'
cmd="$(_lil_extract_cmd "$fenced")"
check "extractor finds the lilcmd fence body" \
  '[[ "$cmd" == "ls -la" ]]'

rm -rf "$tmp" "$stage_run"

print -r -- ""
print -r -- "$( (( fail )) && echo "TESTS FAILED" || echo "ALL TESTS PASSED" )"
exit $fail
