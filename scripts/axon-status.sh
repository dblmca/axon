#!/usr/bin/env bash
set -euo pipefail

: "${ENGRAM_WORKER_URL:=http://localhost:37779}"
: "${ENGRAM_API_KEY:=}"

API="${ENGRAM_WORKER_URL%/}"

GREEN=$(tput setaf 2)
YELLOW=$(tput setaf 3)
NC=$(tput sgr0)

print_header() {
  printf "${YELLOW}=== %s ===${NC}\n" "$1"
}

print_count() {
  printf "  ${GREEN}%s${NC}\n" "$1"
}

# --- Agents ---
print_header "Agents"

agents_json=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" "$API/api/agents?online_only=true" 2>/dev/null) || true

if [[ -n "$agents_json" ]]; then
  echo "$agents_json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
agents = data.get('agents', [])
print(f'Online: {len(agents)}')
for a in agents[:5]:
    print(f'  {a[\"name\"]} ({a[\"project\"]})')
" 2>/dev/null && print_count "" || print_count "Unable to retrieve agent list (API may be unreachable or invalid key)"
else
  print_count "Unable to retrieve agent list (API may be unreachable or invalid key)"
fi

echo ""

# --- Tasks ---
print_header "Tasks"

tasks_json=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" "$API/api/tasks" 2>/dev/null) || true

if [[ -n "$tasks_json" ]]; then
  echo "$tasks_json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
tasks = data.get('tasks', [])
print(f'Pending: {len(tasks)}')
for t in tasks[:5]:
    print(f'  {t[\"title\"]} ({t.get(\"project\", \"\")})')
" 2>/dev/null && print_count "" || print_count "Unable to retrieve task list (API may be unreachable or invalid key)"
else
  print_count "Unable to retrieve task list (API may be unreachable or invalid key)"
fi

echo ""

# --- Recent Agent Messages ---
print_header "Recent Agent Messages"

agents_json=$(curl -fsS -H "x-api-key: $ENGRAM_API_KEY" "$API/api/agents?online_only=true" 2>/dev/null) || true

if [[ -n "$agents_json" ]]; then
  echo "$agents_json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
agents = data.get('agents', [])
if not agents:
    print('  No recent messages')
else:
    print(f'  Showing last messages from {min(len(agents), 5)} agents')
    for a in agents[:5]:
        print(f'  {a[\"name\"]} ({a[\"project\"]})')
" 2>/dev/null && print_count "" || print_count "Unable to retrieve agent list (API may be unreachable or invalid key)"
else
  print_count "Unable to retrieve agent list (API may be unreachable or invalid key)"
fi

echo ""
printf "${YELLOW}=== End ===${NC}\n"
