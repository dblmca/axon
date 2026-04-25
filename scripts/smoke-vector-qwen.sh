#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="$ROOT/profiles/axon.vector-qwen-engram.jsonc"

model_id="${AXON_QWEN_MODEL_ID:-Qwen3.6-35B-A3B-abliterated-Q4_K_M.gguf}"
base_url="${AXON_QWEN_BASE_URL:-http://192.168.1.153:8081/v1}"
engram_worker_url="${ENGRAM_WORKER_URL:-http://localhost:37779}"
engram_mcp_server="${AXON_ENGRAM_MCP_SERVER:-/home/mmca/mcp-servers/engram-mcp/engram-mcp-server.mjs}"
agentic_mcp_server="${AXON_AGENTIC_MCP_SERVER:-/home/mmca/mcp-servers/agentic-mcp/agentic-mcp-server.mjs}"
engram_api_key="${ENGRAM_API_KEY:-dummy}"

api_root="${base_url%/}"
if [[ "$api_root" == */v1 ]]; then
  health_url="${api_root%/v1}/health"
else
  health_url="$api_root/health"
fi
models_url="${api_root%/}/models"
chat_url="${api_root%/}/chat/completions"

for file in "$engram_mcp_server" "$agentic_mcp_server"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing MCP server: $file" >&2
    exit 1
  fi
done

models_tmp="$(mktemp)"
chat_tmp="$(mktemp)"
smoke_dir="$(mktemp -d)"
roundtrip_tmp="$smoke_dir/axon-roundtrip.jsonl"
trap 'rm -f "$models_tmp" "$chat_tmp"; rm -rf "$smoke_dir"' EXIT

curl -fsS "$health_url" >/dev/null
curl -fsS "$models_url" >"$models_tmp"

if ! grep -Fq "$model_id" "$models_tmp"; then
  echo "Model ID not found in $models_url: $model_id" >&2
  exit 1
fi

curl -fsS "$chat_url" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"model":"%s","messages":[{"role":"user","content":"Reply with exactly: axon-smoke-ok"}],"max_tokens":32,"chat_template_kwargs":{"enable_thinking":false}}' "$model_id")" \
  >"$chat_tmp"

if ! grep -Fq "axon-smoke-ok" "$chat_tmp"; then
  echo "Chat completion smoke failed for $model_id" >&2
  exit 1
fi

curl -fsS "${engram_worker_url%/}/health" >/dev/null

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required for the Axon tool-call smoke." >&2
  exit 1
fi

if [[ ! -f "$PROFILE" ]]; then
  echo "Missing Axon profile: $PROFILE" >&2
  exit 1
fi

XDG_STATE_HOME="$smoke_dir/state" \
XDG_DATA_HOME="$smoke_dir/data" \
XDG_CONFIG_HOME="$smoke_dir/config" \
AXON_QWEN_BASE_URL="$base_url" \
AXON_QWEN_MODEL_ID="$model_id" \
AXON_ENGRAM_MCP_SERVER="$engram_mcp_server" \
AXON_AGENTIC_MCP_SERVER="$agentic_mcp_server" \
ENGRAM_WORKER_URL="$engram_worker_url" \
ENGRAM_API_KEY="$engram_api_key" \
OPENCODE_CONFIG_CONTENT="$(cat "$PROFILE")" \
  bun --cwd "$ROOT/opencode/packages/opencode" src/index.ts run \
    --pure \
    --format json \
    --dangerously-skip-permissions \
    "List the current directory using bash and then reply with exactly: axon-ls-ok" \
    >"$roundtrip_tmp"

if ! grep -Fq '"tool":"bash"' "$roundtrip_tmp"; then
  echo "Axon round-trip smoke did not execute bash." >&2
  exit 1
fi

if ! grep -Fq 'axon-ls-ok' "$roundtrip_tmp"; then
  echo "Axon round-trip smoke did not complete successfully." >&2
  exit 1
fi

printf 'STATUS\nqwen_endpoint=ok\nengram_worker=ok\nmcp_servers=ok\naxon_roundtrip=ok\n'
