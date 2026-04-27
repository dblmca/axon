#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE_ROOT="$(mktemp -d /tmp/axon-worktree-test.XXXXXX)"
trap 'git -C "$ROOT" worktree remove "$WORKTREE_ROOT/task-100" --force >/dev/null 2>&1 || true; rm -rf "$WORKTREE_ROOT"' EXIT

clean_output="$(AXON_DRY_RUN=1 AXON_WORKTREE_ROOT="$WORKTREE_ROOT" "$ROOT/bin/axon" --profile minimal-offline --task 99 --worktree run "echo hello")"
grep -q "project_dir: $WORKTREE_ROOT/task-99" <<<"$clean_output"

if [[ -d "$WORKTREE_ROOT/task-99" ]]; then
  echo "expected successful clean worktree to be removed" >&2
  exit 1
fi

set +e
fail_output="$(AXON_DRY_RUN=fail AXON_WORKTREE_ROOT="$WORKTREE_ROOT" "$ROOT/bin/axon" --profile minimal-offline --task 100 --worktree run "echo hello" 2>&1)"
status=$?
set -e

if [[ "$status" -eq 0 ]]; then
  echo "expected failing run to return non-zero" >&2
  exit 1
fi
grep -q "Worktree kept (dirty or failed): $WORKTREE_ROOT/task-100" <<<"$fail_output"
[[ -d "$WORKTREE_ROOT/task-100" ]]

echo "worktree=ok"
