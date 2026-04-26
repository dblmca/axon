#!/usr/bin/env bash
set -euo pipefail

pass=0
fail=0

check() {
  local name="$1" url="$2" expect="$3"
  if curl -sf "$url" >/dev/null 2>&1; then
    echo "PASS  $name ($url → $expect)"
    ((pass++))
  else
    echo "FAIL  $name ($url)"
    ((fail++))
  fi
}

check "Engram worker"    "http://localhost:37779/health" "200"
check "Qwen endpoint"    "http://192.168.1.153:8081/"    "200"
check "Qdrant"           "http://localhost:6333/"        "200"

echo "---"
echo "Passed: $pass  Failed: $fail"

[[ $fail -eq 0 ]]