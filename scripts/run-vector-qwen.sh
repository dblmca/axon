#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="$ROOT/profiles/axon.vector-qwen-engram.jsonc"

: "${AXON_QWEN_BASE_URL:=http://192.168.1.153:8081/v1}"
: "${AXON_QWEN_MODEL_ID:=Qwen3.6-35B-A3B-abliterated-Q4_K_M.gguf}"
: "${AXON_ENGRAM_MCP_SERVER:=/home/mmca/mcp-servers/engram-mcp/engram-mcp-server.mjs}"
: "${AXON_AGENTIC_MCP_SERVER:=/home/mmca/mcp-servers/agentic-mcp/agentic-mcp-server.mjs}"
: "${ENGRAM_WORKER_URL:=http://localhost:37779}"
: "${AXON_ENGRAM_MCP_NAMES:=engram,agentic-mcp}"

if [[ -z "${ENGRAM_API_KEY:-}" ]]; then
  echo "ENGRAM_API_KEY is required for the shared Engram/MCP profile." >&2
  exit 1
fi

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
export AXON_ENGRAM_MCP_SERVER
export AXON_AGENTIC_MCP_SERVER
export ENGRAM_API_KEY
export ENGRAM_WORKER_URL
export AXON_ENGRAM_MCP_NAMES
export OPENCODE_CONFIG_CONTENT="$(cat "$PROFILE")"

cd "$ROOT/opencode"
exec bun run dev "$@"
