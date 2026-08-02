#!/bin/zsh
# spinner-fixture.zsh — fixture-driven tests for the Katamari marquee spinner v3
# and the pi --mode json stage/extraction pipeline.
# Run from the repo root:  zsh tests/spinner-fixture.zsh
set -e
cd "${0:A:h}/.." || exit 1
source ./lil.zsh

ESC=$'\e'
fail=0
check() {
  if eval "$2"; then
    print -r -- "ok:   $1"
  else
    print -r -- "FAIL: $1"
    fail=1
  fi
}

MSG="The King of All Terminals ponders your tiny, precious question…"
f0="$(COLUMNS=80 _lil_marquee_frame "$MSG" 0 58)"
f6="$(COLUMNS=80 _lil_marquee_frame "$MSG" 6 58)"

# --- 1. frame shape: distinct ramp codes, chars in message order, [0m at end
RESET="${ESC}[0m"
check "frame has multiple distinct ramp codes" \
  '[[ $(print -rn -- "$f0" | grep -o $ESC"\[38;5;[0-9]*m" | sort -u | wc -l | tr -d " ") -ge 6 ]]'
check "frame ends with [0m (LIL_RESET)" \
  '[[ "$f0" == *"$RESET" ]]'
plain0="$(print -rn -- "$f0" | sed $'s/\x1b\\[[0-9;]*m//g')"
check "chars in message order at offset 0" \
  '[[ "${plain0# }" == "${MSG:0:58}" ]]'

# --- 2. rainbow-per-char: first 12 visible chars follow the ramp order
frame="${f0# }"                       # drop leading space
frame="${frame%$RESET}"               # drop trailing reset
RB_RE="$(printf '^%s\[38;5;([0-9]+)m(.)' $'\e')"   # zsh =~ needs the regex in a var
got_colors=() got_chars_s=""
for (( i = 1; i <= 12; i++ )); do
  if [[ "$frame" =~ $RB_RE ]]; then
    got_colors+=("${match[1]}")
    got_chars_s+="${match[2]}"
    frame="${frame:${#MATCH}}"
  else
    got_colors+=("?"); got_chars_s+="?"
  fi
done
check "rainbow colors follow ramp order" \
  '[[ "${got_colors[@]}" == "${_lil_ramp[@]}" ]]'
check "rainbow chars follow message order" \
  '[[ "$got_chars_s" == "${MSG:0:12}" ]]'

# --- 3. offset shift is left→right (offset 6 shows the message 12 cols right)
plain6="$(print -rn -- "$f6" | sed $'s/\x1b\\[[0-9;]*m//g')"
plain6_nobar="${plain6# }"
check "offset 6 shifts message right by 12 columns" \
  '[[ "${plain6_nobar:12:14}" == "${MSG:0:14}" ]]'
check "offset 6 keeps the bar at column 2 (leading space)" \
  '[[ "${plain6[1]}" == " " ]]'

# --- 4. JSONL answer extraction: clean markdown, no JSON artifacts
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

# --- 5. stage machine: start → thinking → tool:<name> → writing → done
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

# --- 6. extractor fence test (```lilcmd block)
fenced=$'Prose above.\n```lilcmd\nls -la\n```\nMore prose.'
cmd="$(_lil_extract_cmd "$fenced")"
check "extractor finds the lilcmd fence body" \
  '[[ "$cmd" == "ls -la" ]]'

rm -rf "$tmp" "$stage_run"

print -r -- ""
print -r -- "$( (( fail )) && echo "TESTS FAILED" || echo "ALL TESTS PASSED" )"
exit $fail
