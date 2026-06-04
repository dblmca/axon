#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cloud="$("$ROOT/bin/axon" --profile cloud-openrouter --model deepseek/deepseek-v4-pro version)"
grep -q "model: deepseek-v4-pro" <<<"$cloud"

local="$(AXON_DRY_RUN=1 "$ROOT/bin/axon" --model some/model run "echo hello")"
grep -q "model: some/model" <<<"$local"
grep -q "command: bun run dev run --dir" <<<"$local"
if grep -q -- "--dangerously-skip-permissions" <<<"$local"; then
  echo "plain axon run should not auto-approve permissions" >&2
  exit 1
fi

approved="$(AXON_DRY_RUN=1 "$ROOT/bin/axon" --profile minimal-offline run --yes "echo hello")"
grep -q -- "--dangerously-skip-permissions" <<<"$approved"

env_approved="$(AXON_DRY_RUN=1 AXON_SKIP_PERMISSIONS=1 "$ROOT/bin/axon" --profile minimal-offline run "echo hello")"
grep -q -- "--dangerously-skip-permissions" <<<"$env_approved"

project="$(AXON_DRY_RUN=1 "$ROOT/bin/axon" --project fleet-demo run "echo hello")"
grep -q "project: fleet-demo" <<<"$project"

echo "model_override=ok"
