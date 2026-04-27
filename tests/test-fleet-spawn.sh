#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d /tmp/axon-fleet-test.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

TMUX_LOG="$TMP/tmux.log"
export TMUX_LOG

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'case "$1" in' \
  '  has-session) exit 1 ;;' \
  '  new-session) printf "%s\n" "$*" >> "$TMUX_LOG"; exit 0 ;;' \
  '  attach-session) exit 0 ;;' \
  '  *) echo "unexpected tmux command: $*" >&2; exit 2 ;;' \
  'esac' > "$TMP/tmux"
chmod +x "$TMP/tmux"

PATH="$TMP:$PATH" "$ROOT/scripts/start-axon-fleet.sh" --count 2 --profile cloud-openrouter --model deepseek/deepseek-v4-pro --project axon >/dev/null

grep -q "new-session -d -s axon-1" "$TMUX_LOG"
grep -q "new-session -d -s axon-2" "$TMUX_LOG"
grep -q "$ROOT/bin/axon --profile cloud-openrouter --model deepseek/deepseek-v4-pro --project axon tui" "$TMUX_LOG"

: > "$TMUX_LOG"
PATH="$TMP:$PATH" "$ROOT/scripts/start-axon.sh" --session axon-test --profile minimal-offline >/dev/null

grep -q "new-session -d -s axon-test" "$TMUX_LOG"
grep -q "$ROOT/bin/axon --profile minimal-offline tui" "$TMUX_LOG"

: > "$TMUX_LOG"
PATH="$TMP:$PATH" "$ROOT/bin/axon" --profile cloud-openrouter --model deepseek/deepseek-v4-flash --project axon fleet 1 >/dev/null

grep -q "new-session -d -s axon-1" "$TMUX_LOG"
grep -q "$ROOT/bin/axon --profile cloud-openrouter --model deepseek/deepseek-v4-flash --project axon tui" "$TMUX_LOG"

echo "fleet_spawn=ok"
