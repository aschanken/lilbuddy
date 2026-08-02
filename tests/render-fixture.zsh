#!/bin/zsh
# render-fixture.zsh — fixture-driven renderer test for Lil Buddy.
# Proves the eza fixture renders with no literal backticks/fences, amber+green
# SGR codes present, the gutter glyph present, and the alias one-liner's quotes
# survive rendering byte-for-byte (no sed mangling of /, &, " or ').
# Run from the repo root:  zsh tests/render-fixture.zsh
set -e
cd "${0:A:h}/.." || exit 1
source ./lil.zsh

ESC=$'\e'
AMBER="${ESC}[38;5;214m"
GREEN="${ESC}[38;5;84m"
ITALIC="${ESC}[38;5;41m"

fail=0
check() {
  if eval "$2"; then
    print -r -- "ok:   $1"
  else
    print -r -- "FAIL: $1"
    fail=1
  fi
}

fixture="tests/fixtures/eza-answer.md"
stripped="$(_lil_strip_cmd "$(cat "$fixture")")"
rendered="$(COLUMNS=80 _lil_render "$stripped")"

check "strip removed the <lilcmd> block"   '[[ "$stripped" != *"brew install eza"* ]]'
check "strip kept prose ('graduate to')"   '[[ "$stripped" == *"graduate to"* ]]'
check "render has no <lilcmd> tag"         '[[ "$rendered" != *"<lilcmd>"* ]]'
check "render has no backtick"             '[[ "$rendered" != *"\`"* ]]'
check "render has no \`\`\` fence"         '[[ "$rendered" != *"\`\`\`"* ]]'
check "render has amber SGR (214)"         '[[ "$rendered" == *"$AMBER"* ]]'
check "render has green SGR (84)"          '[[ "$rendered" == *"$GREEN"* ]]'
check "render has italic SGR (41)"         '[[ "$rendered" == *"$ITALIC"* ]]'
check "render has gutter glyph ┃"          '[[ "$rendered" == *"┃"* ]]'

# Alias byte-intact: render the alias one-liner inside a ```sh fence and
# compare the SGR/whitespace-stripped bytes to the original (order preserved).
alias_src=$'```sh\nbrew install eza && echo \'alias ls="eza -la --group-directories-first"\' >> ~/.zshrc && source ~/.zshrc\n```\n'
alias_render="$(COLUMNS=80 _lil_render "$alias_src")"
alias_plain="$(print -r -- "$alias_render" | sed $'s/\e\[[0-9;]*m//g' | tr -d '[:space:]┃')"
alias_expected="$(print -r -- "$alias_src" | sed -n '2p' | tr -d '[:space:]')"
check "alias quotes byte-intact in render" '[[ "$alias_plain" == "$alias_expected" ]]'

print -r -- ""
print -r -- "$( (( fail )) && echo "TESTS FAILED" || echo "ALL TESTS PASSED" )"
exit $fail
