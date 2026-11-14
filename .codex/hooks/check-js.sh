#!/bin/sh
# PostToolUse hook: after Claude edits or writes a .js file, parse it with `node --check`.
# A syntax error goes back to Claude at once (exit 2), before any test run or page load.
f=$(jq -r '.tool_input.file_path // empty')
case "$f" in
  *.js) ;;
  *) exit 0 ;;
esac
[ -f "$f" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
out=$(node --check "$f" 2>&1) && exit 0
# An ES module (import/export at the top level) parses only as one.
if printf '%s' "$out" | grep -q "Cannot use import statement\|Unexpected token 'export'"; then
  out=$(node --input-type=module --check < "$f" 2>&1) && exit 0
fi
printf 'Syntax error in %s:\n%s\n' "$f" "$out" >&2
exit 2
