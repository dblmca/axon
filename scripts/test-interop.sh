#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${AXON_QWEN_BASE_URL:=http://192.168.1.153:8081/v1}"
: "${AXON_QWEN_MODEL_ID:=Qwen3.6-35B-A3B-abliterated-Q4_K_M.gguf}"
: "${AXON_ENGRAM_MCP_SERVER:=/home/mmca/mcp-servers/engram-mcp/engram-mcp-server.mjs}"
: "${AXON_AGENTIC_MCP_SERVER:=/home/mmca/mcp-servers/agentic-mcp/agentic-mcp-server.mjs}"
: "${ENGRAM_WORKER_URL:=http://localhost:37779}"

PROFILE="$ROOT/profiles/axon.vector-qwen-engram.jsonc"
AGENT_NAME="axon-interop-test-$$"
AGENT_NAME_B="claude-interop-test-$$"
AGENT_NAME_C="codex-interop-test-$$"
SESSION_ID="interop-test-session-$$"
API="${ENGRAM_WORKER_URL%/}"
PASS=0
FAIL=0
TASK_ID=""
CHANNEL_ID=""
GRAPH_ID="interop-graph-$$"
TASK_IDS=()
FILE_LOCK_PATH="/interop/test-lock-$$.txt"
FILE_LOCK_ID=""

cleanup() {
  echo ""
  echo "--- Cleanup ---"
  for tid in "${TASK_IDS[@]}"; do
    curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X DELETE "$API/api/tasks/$tid" \
      -H "Content-Type: application/json" -d "{\"agent_name\":\"$AGENT_NAME\"}" >/dev/null 2>&1 || true
    echo "Deleted task $tid"
  done
  if [[ -n "$TASK_ID" ]]; then
    curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X DELETE "$API/api/tasks/$TASK_ID" \
      -H "Content-Type: application/json" -d "{\"agent_name\":\"$AGENT_NAME\"}" >/dev/null 2>&1 || true
    echo "Deleted task $TASK_ID"
  fi
  if [[ -n "$CHANNEL_ID" ]]; then
    curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X DELETE "$API/api/channels/$CHANNEL_ID" \
      -H "Content-Type: application/json" -d "{\"agent_name\":\"$AGENT_NAME\"}" >/dev/null 2>&1 || true
    echo "Archived test channel $CHANNEL_ID"
  fi
  if [[ -n "$FILE_LOCK_ID" ]]; then
    curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X DELETE "$API/api/files/locks/$FILE_LOCK_ID" \
      -H "Content-Type: application/json" -d "{\"agent_name\":\"$AGENT_NAME\"}" >/dev/null 2>&1 || true
    echo "Released file lock $FILE_LOCK_ID"
  fi
  for agent in "$AGENT_NAME" "$AGENT_NAME_B" "$AGENT_NAME_C"; do
    curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/agents/deregister" \
      -H "Content-Type: application/json" -d "{\"name\":\"$agent\"}" >/dev/null 2>&1 || true
  done
  echo "Deregistered agents"
  rm -rf "$smoke_dir" 2>/dev/null || true
}
trap cleanup EXIT

report() {
  local name="$1" result="$2"
  if [[ "$result" == "PASS" ]]; then
    PASS=$((PASS + 1))
    echo "  PASS  $name"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL  $name"
  fi
}

smoke_dir="$(mktemp -d)"

# --- Prerequisites ---
echo "=== Prerequisites ==="

if [[ -z "${ENGRAM_API_KEY:-}" ]]; then
  echo "ENGRAM_API_KEY is required." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required." >&2
  exit 1
fi

if ! curl -fsS "$API/health" >/dev/null 2>&1; then
  echo "Engram worker at $API is not healthy." >&2
  exit 1
fi
echo "  OK  Engram worker healthy"

api_root="${AXON_QWEN_BASE_URL%/}"
health_url="${api_root%/v1}/health"
if ! curl -fsS "$health_url" >/dev/null 2>&1; then
  echo "Qwen endpoint at $AXON_QWEN_BASE_URL is not healthy." >&2
  exit 1
fi
echo "  OK  Qwen endpoint healthy"

if [[ ! -f "$PROFILE" ]]; then
  echo "Missing profile: $PROFILE" >&2
  exit 1
fi
echo "  OK  Profile exists"
echo ""

# --- Test a: Agent Registration ---
echo "=== Test a: Agent Registration ==="

reg_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/agents/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$AGENT_NAME\",\"session_id\":\"$SESSION_ID\",\"hostname\":\"interop-test\",\"project\":\"axon\",\"source_ai\":\"axon-test\"}" 2>&1) || true

if echo "$reg_resp" | grep -q '"Agent registered"'; then
  report "agent_registration" "PASS"
else
  report "agent_registration" "FAIL"
  echo "    Response: $reg_resp"
fi

agents_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" "$API/api/agents" 2>&1) || true
if echo "$agents_resp" | grep -qF "$AGENT_NAME"; then
  report "agent_visible_in_list" "PASS"
else
  report "agent_visible_in_list" "FAIL"
fi
echo ""

# --- Test b: Message Send/Receive ---
echo "=== Test b: Message Send/Receive ==="

msg_marker="interop-ping-$$-$(date +%s)"
send_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/agents/messages" \
  -H "Content-Type: application/json" \
  -d "{\"sender\":\"$AGENT_NAME\",\"recipient\":\"$AGENT_NAME\",\"content\":\"$msg_marker\"}" 2>&1) || true

if echo "$send_resp" | grep -q '"Message sent"'; then
  report "message_send" "PASS"
else
  report "message_send" "FAIL"
  echo "    Response: $send_resp"
fi

inbox_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" "$API/api/agents/messages/inbox?name=$AGENT_NAME" 2>&1) || true
if echo "$inbox_resp" | grep -qF "$msg_marker"; then
  report "message_receive" "PASS"
else
  report "message_receive" "FAIL"
  echo "    Response: $inbox_resp"
fi
echo ""

# --- Test c: Channel Participation ---
echo "=== Test c: Channel Participation ==="

chan_name="#interop-test-$$"
chan_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/channels" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$chan_name\",\"description\":\"interop test channel\",\"created_by\":\"$AGENT_NAME\"}" 2>&1) || true

CHANNEL_ID=$(echo "$chan_resp" | grep -oP '"id":\s*\K\d+' | head -1) || true

if [[ -n "$CHANNEL_ID" ]]; then
  report "channel_create" "PASS"
else
  report "channel_create" "FAIL"
  echo "    Response: $chan_resp"
fi

if [[ -n "$CHANNEL_ID" ]]; then
  curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/channels/$CHANNEL_ID/join" \
    -H "Content-Type: application/json" -d "{\"agent_name\":\"$AGENT_NAME\"}" >/dev/null 2>&1 || true

  chan_marker="chan-ping-$$-$(date +%s)"
  post_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/channels/$CHANNEL_ID/messages" \
    -H "Content-Type: application/json" \
    -d "{\"sender\":\"$AGENT_NAME\",\"content\":\"$chan_marker\"}" 2>&1) || true

  if echo "$post_resp" | grep -qF "$chan_marker"; then
    report "channel_post" "PASS"
  else
    report "channel_post" "FAIL"
    echo "    Response: $post_resp"
  fi

  read_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" \
    "$API/api/channels/$CHANNEL_ID/messages?agent_name=$AGENT_NAME&limit=1" 2>&1) || true
  if echo "$read_resp" | grep -qF "$chan_marker"; then
    report "channel_read" "PASS"
  else
    report "channel_read" "FAIL"
    echo "    Response: $read_resp"
  fi
else
  report "channel_post" "FAIL"
  report "channel_read" "FAIL"
fi
echo ""

# --- Test d: Task Creation ---
echo "=== Test d: Task Creation ==="

task_marker="interop-task-$$"
task_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"$task_marker\",\"project\":\"axon\",\"assigned_to\":\"$AGENT_NAME\",\"created_by\":\"$AGENT_NAME\",\"description\":\"automated interop test task\"}" 2>&1) || true

TASK_ID=$(echo "$task_resp" | grep -oP '"id":\s*\K\d+' | head -1) || true

if [[ -n "$TASK_ID" ]]; then
  report "task_create" "PASS"
else
  report "task_create" "FAIL"
  echo "    Response: $task_resp"
fi

tasks_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" "$API/api/tasks?project=axon&limit=50" 2>&1) || true
if echo "$tasks_resp" | grep -qF "$task_marker"; then
  report "task_visible_in_list" "PASS"
else
  report "task_visible_in_list" "FAIL"
fi
echo ""

# --- Test e: Context Retrieval ---
echo "=== Test e: Context Retrieval ==="

ctx_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/search/context" \
  -H "Content-Type: application/json" \
  -d '{"project":"axon","session_limit":1,"observation_limit":1}' 2>&1) || true

if echo "$ctx_resp" | grep -q '"project"'; then
  report "context_retrieval" "PASS"
else
  report "context_retrieval" "FAIL"
  echo "    Response: $ctx_resp"
fi
echo ""

# --- Test f: Shared Task Graph ---
echo "=== Test f: Shared Task Graph ==="

GRAPH_ID="interop-graph-$$-$(date +%s)"
graph_tasks=()

for slot in alpha beta gamma; do
  task_marker="graph-task-${slot}-$$"
  task_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/tasks" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"$task_marker\",\"project\":\"axon\",\"created_by\":\"$AGENT_NAME\",\"description\":\"graph interop test task ${slot}\",\"graph_id\":\"$GRAPH_ID\"}" 2>&1) || true

  tid=$(echo "$task_resp" | grep -oP '"id":\s*\K\d+' | head -1) || true
  if [[ -n "$tid" ]]; then
    TASK_IDS+=("$tid")
    graph_tasks+=("$tid")
  fi
done

if [[ "${#graph_tasks[@]}" -eq 3 ]]; then
  report "graph_tasks_created" "PASS"
else
  report "graph_tasks_created" "FAIL"
  echo "    Expected 3 tasks, got ${#graph_tasks[@]}"
fi

graph_list_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" \
  "$API/api/tasks/graph/$GRAPH_ID" 2>&1) || true

graph_found=0
for tid in "${graph_tasks[@]}"; do
  if echo "$graph_list_resp" | grep -qF "$tid"; then
    graph_found=$((graph_found + 1))
  fi
done

if [[ "$graph_found" -eq 3 ]]; then
  report "graph_tasks_visible_by_graph_id" "PASS"
else
  report "graph_tasks_visible_by_graph_id" "FAIL"
  echo "    Expected 3 tasks visible, found $graph_found"
fi
echo ""

# --- Test g: Task Claim ---
echo "=== Test g: Task Claim ==="

claim_target="${graph_tasks[0]}"
claim_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/tasks/$claim_target/claim" \
  -H "Content-Type: application/json" \
  -d "{\"agent_name\":\"$AGENT_NAME\"}" 2>&1) || true

if echo "$claim_resp" | grep -qF '"in_progress"' || echo "$claim_resp" | grep -qF '"claimed"'; then
  report "task_claim_patch" "PASS"
else
  report "task_claim_patch" "FAIL"
  echo "    Response: $claim_resp"
fi

claim_verify_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" \
  "$API/api/tasks/graph/$GRAPH_ID" 2>&1) || true

if echo "$claim_verify_resp" | grep -qF '"in_progress"'; then
  report "task_claim_visible" "PASS"
else
  report "task_claim_visible" "FAIL"
  echo "    Response: $claim_verify_resp"
fi

# Second agent (Claude) claims another task in the same graph
curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/agents/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$AGENT_NAME_B\",\"session_id\":\"$SESSION_ID-claude\",\"hostname\":\"interop-test\",\"project\":\"axon\",\"source_ai\":\"claude\"}" >/dev/null 2>&1 || true

if [[ "${#graph_tasks[@]}" -ge 2 ]]; then
  claim_target_b="${graph_tasks[1]}"
  claim_b_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/tasks/$claim_target_b/claim" \
    -H "Content-Type: application/json" \
    -d "{\"agent_name\":\"$AGENT_NAME_B\"}" 2>&1) || true

  if echo "$claim_b_resp" | grep -qF '"in_progress"' || echo "$claim_b_resp" | grep -qF '"claimed"'; then
    report "task_cross_agent_claim" "PASS"
  else
    report "task_cross_agent_claim" "FAIL"
    echo "    Response: $claim_b_resp"
  fi
else
  report "task_cross_agent_claim" "FAIL"
  echo "    Not enough graph tasks to test cross-agent claim"
fi

# Verify both agents appear as assignees in the graph
graph_agents_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" \
  "$API/api/tasks/graph/$GRAPH_ID" 2>&1) || true

if echo "$graph_agents_resp" | grep -qF "$AGENT_NAME" && echo "$graph_agents_resp" | grep -qF "$AGENT_NAME_B"; then
  report "graph_cross_agent_visibility" "PASS"
else
  report "graph_cross_agent_visibility" "FAIL"
  echo "    Response: $graph_agents_resp"
fi
echo ""

# --- Test h: File Lock ---
echo "=== Test h: File Lock ==="

FILE_LOCK_PATH="/interop/test-lock-$$-$(date +%s)"

lock_create_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" -X POST "$API/api/files/locks" \
  -H "Content-Type: application/json" \
  -d "{\"file_path\":\"$FILE_LOCK_PATH\",\"project\":\"axon\",\"locked_by\":\"$AGENT_NAME\"}" 2>&1) || true

FILE_LOCK_ID=$(echo "$lock_create_resp" | grep -oP '"id":\s*\K\d+' | head -1) || true

if [[ -n "$FILE_LOCK_ID" ]]; then
  report "file_lock_create" "PASS"
else
  report "file_lock_create" "FAIL"
  echo "    Response: $lock_create_resp"
fi

if [[ -n "$FILE_LOCK_ID" ]]; then
  # Lock is acquired atomically on create; verify by listing
  report "file_lock_acquire" "PASS"

  lock_list_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" \
    "$API/api/files/locks?project=axon" 2>&1) || true

  if echo "$lock_list_resp" | grep -qF "$FILE_LOCK_PATH"; then
    report "file_lock_visible" "PASS"
  else
    report "file_lock_visible" "FAIL"
    echo "    Response: $lock_list_resp"
  fi

  lock_release_resp=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" \
    -X DELETE "$API/api/files/locks/$FILE_LOCK_ID" \
    -H "Content-Type: application/json" \
    -d "{\"agent_name\":\"$AGENT_NAME\"}" 2>&1) || true

  if echo "$lock_release_resp" | grep -q '"Lock released"' || echo "$lock_release_resp" | grep -q '"released"' || echo "$lock_release_resp" | grep -q '"message"'; then
    report "file_lock_release" "PASS"
  else
    report "file_lock_release" "FAIL"
    echo "    Response: $lock_release_resp"
  fi
else
  report "file_lock_acquire" "FAIL"
  report "file_lock_visible" "FAIL"
  report "file_lock_release" "FAIL"
fi
echo ""

# --- Summary ---
echo "=== Results ==="
TOTAL=$((PASS + FAIL))
echo "  $PASS/$TOTAL passed, $FAIL failed"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
