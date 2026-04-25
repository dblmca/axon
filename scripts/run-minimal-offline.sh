#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="$ROOT/profiles/axon.minimal-offline.jsonc"

: "${AXON_QWEN_BASE_URL:=http://192.168.1.153:8081/v1}"
: "${AXON_QWEN_MODEL_ID:=Qwen3.6-35B-A3B-abliterated-Q4_K_M.gguf}"

if [[ ! -f "$PROFILE" ]]; then
  echo "Missing profile: $PROFILE" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required to launch the vendored OpenCode runtime." >&2
  exit 1
fi

export AXON_QWEN_BASE_URL
export AXON_QWEN_MODEL_ID
export OPENCODE_CONFIG_CONTENT="$(cat "$PROFILE")"

cd "$ROOT/opencode"
exec bun run dev "$@"
