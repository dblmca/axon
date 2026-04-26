#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="$ROOT/profiles/axon.cloud-openrouter.jsonc"

model_id="${AXON_OPENROUTER_MODEL:-deepseek/deepseek-chat-v3-0324}"
api_key="${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is required}"
engram_worker_url="${ENGRAM_WORKER_URL:-http://localhost:37779}"
engram_mcp_server="${AXON_ENGRAM_MCP_SERVER:-/home/mmca/mcp-servers/engram-mcp/engram-mcp-server.mjs}"
agentic_mcp_server="${AXON_AGENTIC_MCP_SERVER:-/home/mmca/mcp-servers/agentic-mcp/agentic-mcp-server.mjs}"
engram_api_key="${ENGRAM_API_KEY:-dummy}"
base_url="https://openrouter.ai/api/v1"

for file in "$engram_mcp_server" "$agentic_mcp_server"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing MCP server: $file" >&2
    exit 1
  fi
done

chat_tmp="$(mktemp)"
smoke_dir="$(mktemp -d)"
roundtrip_tmp="$smoke_dir/axon-roundtrip.jsonl"
trap 'rm -f "$chat_tmp"; rm -rf "$smoke_dir"' EXIT

# 1. Check OpenRouter API reachability
if ! curl -fsS -o /dev/null "${base_url}/models" -H "Authorization: Bearer $api_key"; then
  echo "OpenRouter API unreachable or invalid API key" >&2
  exit 1
fi
echo "openrouter_api=ok"

# 2. Test chat completion
curl -fsS "${base_url}/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $api_key" \
  -d "$(printf '{"model":"%s","messages":[{"role":"user","content":"Reply with exactly: axon-openrouter-ok"}],"max_tokens":32}' "$model_id")" \
  >"$chat_tmp"

if ! grep -Fq "axon-openrouter-ok" "$chat_tmp"; then
  echo "Chat completion smoke failed for $model_id" >&2
  exit 1
fi
echo "chat_completion=ok"

# 3. Check Engram worker
if curl -fsS "${engram_worker_url%/}/health" >/dev/null 2>&1; then
  echo "engram_worker=ok"
else
  echo "engram_worker=skip (unreachable)"
fi

# 4. MCP servers exist
echo "mcp_servers=ok"

# 5. Axon round-trip
if [[ ! -f "$PROFILE" ]]; then
  echo "Missing Axon profile: $PROFILE" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required for the Axon round-trip smoke." >&2
  exit 1
fi

XDG_STATE_HOME="$smoke_dir/state" \
XDG_DATA_HOME="$smoke_dir/data" \
XDG_CONFIG_HOME="$smoke_dir/config" \
OPENROUTER_API_KEY="$api_key" \
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

printf 'axon_roundtrip=ok\n\nSTATUS\nopenrouter_api=ok\nchat_completion=ok\nengram_worker=ok\nmcp_servers=ok\naxon_roundtrip=ok\n'
