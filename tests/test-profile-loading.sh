#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for profile in "$ROOT"/profiles/axon.*.jsonc; do
  name="$(basename "$profile" .jsonc)"
  name="${name#axon.}"

  node -e '
    const fs = require("fs")
    const file = process.argv[1]
    const text = fs.readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
    JSON.parse(text)
  ' "$profile"

  "$ROOT/bin/axon" --profile "$name" version >/dev/null
done

if "$ROOT/bin/axon" --profile nonexistent version >/tmp/axon-profile-loading.err 2>&1; then
  echo "expected nonexistent profile to fail" >&2
  exit 1
fi

grep -q "Unknown profile: nonexistent" /tmp/axon-profile-loading.err

echo "profile_loading=ok"
