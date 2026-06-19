#!/bin/bash
set -euo pipefail

# Axon remote deploy — git-based, idempotent
# First run: clones repo, installs bun, installs deps, creates env
# Subsequent runs: pulls latest, reinstalls deps if lockfile changed

REMOTE="root@147.182.255.152"
REMOTE_DIR="/opt/axon"
REMOTE_OC_DIR="$REMOTE_DIR/opencode"

echo "=== Axon Remote Deploy ==="

# 0. Ensure local is pushed
LOCAL_HEAD=$(git -C /home/mmca/projects/axon rev-parse HEAD)
REMOTE_HEAD=$(git -C /home/mmca/projects/axon rev-parse origin/main 2>/dev/null || echo "unknown")
if [[ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]]; then
    echo "[0/5] Pushing local commits to origin..."
    git -C /home/mmca/projects/axon push origin main
else
    echo "[0/5] Local and origin in sync"
fi

# 1. First-run setup (idempotent)
echo "[1/5] Checking remote setup..."
ssh "$REMOTE" bash -s <<'SETUP'
set -euo pipefail

# Install bun if missing
if ! command -v bun >/dev/null 2>&1; then
    echo "Installing bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
    echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
fi

# Clone repo if missing
if [[ ! -d /opt/axon/.git ]]; then
    echo "Cloning axon..."
    git clone git@github.com:dblmca/axon.git /opt/axon
fi

# Create env file if missing
if [[ ! -f /opt/axon/.env ]]; then
    cat > /opt/axon/.env <<'ENV'
# Axon remote environment — API keys
# OPENROUTER_API_KEY=
# DEEPSEEK_API_KEY=
# VERGENCE_MCP_TOKEN=
# ENGRAM_API_KEY=
ENV
    echo "Created /opt/axon/.env — populate API keys before running"
fi

# Symlink bin to PATH if not already
if [[ ! -L /usr/local/bin/axon ]]; then
    ln -sf /opt/axon/bin/axon /usr/local/bin/axon
    echo "Symlinked axon to /usr/local/bin/axon"
fi

echo "Setup OK"
SETUP

# 2. Pull latest
echo "[2/5] Pulling latest..."
PULL_OUTPUT=$(ssh "$REMOTE" "cd $REMOTE_DIR && git pull --ff-only 2>&1")
echo "$PULL_OUTPUT"

# 3. Install/update deps if needed
LOCKFILE_CHANGED=$(echo "$PULL_OUTPUT" | grep -c 'bun.lock\|package.json' || true)
if [[ "$LOCKFILE_CHANGED" -gt 0 ]] || ! ssh "$REMOTE" "test -d $REMOTE_OC_DIR/node_modules"; then
    echo "[3/5] Installing OpenCode dependencies..."
    ssh "$REMOTE" "export BUN_INSTALL=\$HOME/.bun && export PATH=\$BUN_INSTALL/bin:\$PATH && cd $REMOTE_OC_DIR && bun install --frozen-lockfile 2>&1 | tail -3"
else
    echo "[3/5] Dependencies up to date"
fi

# 4. Verify
echo "[4/5] Verifying..."
REMOTE_SHA=$(ssh "$REMOTE" "cd $REMOTE_DIR && git rev-parse --short HEAD")
BUN_VER=$(ssh "$REMOTE" "export BUN_INSTALL=\$HOME/.bun && export PATH=\$BUN_INSTALL/bin:\$PATH && bun --version 2>/dev/null || echo 'not found'")
PROFILES=$(ssh "$REMOTE" "ls $REMOTE_DIR/profiles/axon.*.jsonc 2>/dev/null | xargs -I{} basename {} .jsonc | sed 's/^axon\.//' | paste -sd', '")
ENV_KEYS=$(ssh "$REMOTE" "grep -c '=' $REMOTE_DIR/.env 2>/dev/null || echo 0")

echo ""
echo "=== Deploy Complete ==="
echo "Commit:   $REMOTE_SHA"
echo "Bun:      $BUN_VER"
echo "Profiles: $PROFILES"
echo "Env keys: $ENV_KEYS configured"
echo ""

# 5. Smoke test (optional, only if --test flag)
if [[ "${1:-}" == "--test" ]]; then
    echo "[5/5] Smoke test..."
    ssh "$REMOTE" "export BUN_INSTALL=\$HOME/.bun && export PATH=\$BUN_INSTALL/bin:\$PATH && cd $REMOTE_DIR && AXON_DRY_RUN=1 bin/axon --profile remote-glm run 'test'" 2>&1
else
    echo "[5/5] Skipping smoke test (use --test to run)"
fi
