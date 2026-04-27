#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cloud="$("$ROOT/bin/axon" --profile cloud-openrouter --model deepseek/deepseek-v4-pro version)"
grep -q "model: deepseek-v4-pro" <<<"$cloud"

local="$(AXON_DRY_RUN=1 "$ROOT/bin/axon" --model some/model run "echo hello")"
grep -q "model: some/model" <<<"$local"
grep -q "command: bun run dev run --dir" <<<"$local"

project="$(AXON_DRY_RUN=1 "$ROOT/bin/axon" --project fleet-demo run "echo hello")"
grep -q "project: fleet-demo" <<<"$project"

echo "model_override=ok"
