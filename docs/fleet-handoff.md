# Axon Fleet: Thin Launcher Implementation Plan

**Approach:** A — Thin Launcher (rewire fleet to use existing `bin/axon`, add SIGTERM + worktree + tests)
**Approved:** 2026-04-27
**Status:** Implemented locally 2026-04-27; live e2e still pending
**Origin:** engram-one-de9d feature request (#2797), brainstorm session with Codex (gpt-5.4)
**Requirements:** `docs/fleet-requirements.md`

---

## 2026-04-27 Codex Implementation Update

Codex implemented the thin-launcher fleet work in the current worktree.

Completed:
- `bin/axon` now supports global `--model`, `--project`, `--task`, and `--worktree` flags.
- `--model` sets `AXON_OPENROUTER_MODEL` for `cloud-openrouter` and `AXON_QWEN_MODEL_ID` for local profiles.
- `--project` exports `ENGRAM_PROJECT`; the plugin now honors this in `projectName()`.
- `bin/axon run` passes `--dir "$AXON_PROJECT_DIR"` into OpenCode so task worktrees become the working directory while the vendored runtime still launches from `opencode/`.
- `--task <id> --worktree run ...` creates `/tmp/axon-worktrees/task-<id>` or `$AXON_WORKTREE_ROOT/task-<id>`, exports `AXON_TASK_ID` and `AXON_WORKTREE`, removes clean successful worktrees, and preserves dirty or failed worktrees.
- `scripts/start-axon.sh` and `scripts/start-axon-fleet.sh` now call `bin/axon` instead of `scripts/run-vector-qwen.sh`.
- Fleet launch accepts positional count or `--count`, and passes `--profile`, `--model`, and `--project`.
- Global `bin/axon --profile ... --model ... --project ... fleet N` now forwards those flags to `start-axon-fleet.sh`.
- `opencode/.opencode/plugin/axon-engram.js` now installs SIGTERM/SIGINT handlers, gates new background work while shutting down, drains in-flight requests, deregisters known agents/sessions, and exits 0 with a timeout fallback.
- Added CI-safe tests:
  - `tests/test-profile-loading.sh`
  - `tests/test-model-override.sh`
  - `tests/test-fleet-spawn.sh`
  - `tests/test-plugin-unit.mjs`
  - `tests/test-signal-shutdown.mjs`
  - `tests/test-worktree.sh`
- Updated docs/help:
  - `bin/axon help`
  - `docs/fleet-requirements.md`
  - `README.md`
  - `.claude/CLAUDE.md`

Verified:
- `tests/test-profile-loading.sh`
- `tests/test-model-override.sh`
- `tests/test-fleet-spawn.sh`
- `node tests/test-plugin-unit.mjs`
- `node tests/test-signal-shutdown.mjs`
- `bin/axon --profile cloud-openrouter --model deepseek/deepseek-v4-pro version`
- `tests/test-worktree.sh` passed only with elevated filesystem permission because the sandbox mounted `.git/worktrees` read-only; behavior was otherwise correct.

Not run:
- Live OpenRouter run: `bin/axon --profile cloud-openrouter --model deepseek/deepseek-v4-pro run "2+2"`.
- Live e2e fleet test with real registration/capture/deregistration.

Engram communication blocker:
- The user asked Codex to join/post updates in `#axon`.
- Direct HTTP to `localhost:37779/health` failed from the sandbox.
- Engram MCP identified the current session, but write/read operations returned HTTP 403:
  - `engram_channel join #axon`
  - `engram_channel post #axon`
  - `engram_channel list`
  - `engram_channel create #axon`
  - `engram_inbox`
  - `engram_send to project:axon`
- Because of this, no channel/direct status update could be sent from this session.

Current follow-up items:
- Fix Engram MCP/API permissions for this Codex session if channel/inbox/project messaging is required.
- Run the live OpenRouter one-shot and live fleet e2e once credentials/services are available.
- Decide whether to add the deferred `axon worker` loop after measuring per-task startup overhead.

---

## Overview

`bin/axon` already has `--profile`, `run --dangerously-skip-permissions`, JSON output, and profile validation. The fleet launcher scripts don't use it yet. This plan rewires the fleet scripts to use `bin/axon`, adds missing pieces (model override, SIGTERM handler, worktree isolation), and writes tests for both existing and new functionality.

Key insight: `opencode run` is the proven fleet primitive (successful in tests #56 and #60). `opencode serve` is a future optimization, not needed now.

---

## Key Decisions

1. **`opencode run` per task, not `opencode serve`** — process isolation, proven path, natural cleanup on exit
2. **SIGTERM is authoritative shutdown, inbox check is cooperative** — plugin handles SIGTERM with drain + deregister; model-level instructions handle inbox-based shutdown between tasks
3. **Worktree lifecycle in launcher, not plugin** — bash creates worktree before `bin/axon run`, cleans up after
4. **Orchestration complexity stays in Engram** — Axon provides reliable worker primitives, not scheduling policy
5. **Tests split into CI-safe (no LLM) and live (requires endpoint)** — most things testable with mocked fetch

---

## Tasks

### Task 1: Add `--model` flag to `bin/axon`

**File:** `bin/axon`
**What:** Parse `--model <slug>` alongside existing `--profile`. Set `AXON_OPENROUTER_MODEL` for cloud profiles, `AXON_QWEN_MODEL_ID` for local profiles. Pass through to `launch()`.
**Lines:** ~15 new lines in the arg parsing block (lines 10-25) and env export block (lines 44-53).
**Test:** `bin/axon --profile cloud-openrouter --model deepseek/deepseek-v4-pro version` shows correct model.

**Current state (lines 10-25):**
```bash
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE_NAME="$2"; shift 2 ;;
    --profile=*) PROFILE_NAME="${1#*=}"; shift ;;
    *) break ;;
  esac
done
```

**Target state:**
```bash
MODEL_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE_NAME="$2"; shift 2 ;;
    --profile=*) PROFILE_NAME="${1#*=}"; shift ;;
    --model) MODEL_OVERRIDE="$2"; shift 2 ;;
    --model=*) MODEL_OVERRIDE="${1#*=}"; shift ;;
    *) break ;;
  esac
done
```

Then after profile is loaded, apply override:
```bash
if [[ -n "$MODEL_OVERRIDE" ]]; then
  case "$PROFILE_NAME" in
    cloud-openrouter) export AXON_OPENROUTER_MODEL="$MODEL_OVERRIDE" ;;
    *) export AXON_QWEN_MODEL_ID="$MODEL_OVERRIDE" ;;
  esac
fi
```

### Task 2: Rewire `start-axon-fleet.sh` to use `bin/axon`

**File:** `scripts/start-axon-fleet.sh`
**What:** Replace hardcoded `run-vector-qwen.sh` with `bin/axon`. Pass through `--profile` and `--model` flags. Accept count as positional arg or `--count N`.
**Dependencies:** Task 1

**Current state (line 18-19):**
```bash
tmux new-session -d -s "$SESSION" \
  "ENGRAM_API_KEY='${ENGRAM_API_KEY}' ENGRAM_TMUX_SESSION='${SESSION}' '$ROOT/scripts/run-vector-qwen.sh'; exec bash"
```

**Target state:**
```bash
tmux new-session -d -s "$SESSION" \
  "ENGRAM_TMUX_SESSION='${SESSION}' '$ROOT/bin/axon' ${PROFILE_FLAG} ${MODEL_FLAG} tui; exec bash"
```

Also remove the manual ENGRAM_API_KEY extraction — `bin/axon` auto-loads it (line 35-42 of `bin/axon`).

### Task 3: Rewire `start-axon.sh` to use `bin/axon`

**File:** `scripts/start-axon.sh`
**What:** Same pattern — replace hardcoded launcher with `bin/axon`, pass through flags.
**Dependencies:** Task 1

### Task 4: Add `--project` flag to `bin/axon`

**File:** `bin/axon`
**What:** Accept `--project <name>`, export as `ENGRAM_PROJECT`. Plugin reads this via `projectName()` (axon-engram.js line 62-64). Low priority — directory-based detection works for most cases.

### Task 5: SIGTERM handler in plugin

**File:** `opencode/.opencode/plugin/axon-engram.js`
**What:** Add SIGTERM/SIGINT handlers that:
1. Set `shuttingDown = true` flag
2. Stop starting new background work
3. Await `drain(input)` (already exists, line 292-303)
4. Deregister all known agents/sessions
5. Exit 0 after timeout-bounded cleanup

**Current state (line 535-537):**
```js
process.on("beforeExit", () => {
  if (inflight.size > 0) drain(input)
})
```

**Target state — add after line 537:**
```js
let shuttingDown = false

function handleShutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  
  const cleanup = async () => {
    // Deregister all known sessions
    for (const [sessionID, current] of sessionState) {
      if (current.agentName) {
        await request(runtime, "/api/agents/deregister", {
          method: "POST",
          body: { name: current.agentName, session_id: sessionID },
        }).catch(() => {})
      }
    }
    await drain(input)
    process.exit(0)
  }
  
  // Timeout fallback
  setTimeout(() => process.exit(1), DRAIN_TIMEOUT_MS + 1000)
  cleanup()
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"))
process.on("SIGINT", () => handleShutdown("SIGINT"))
```

Also gate `background()` on `!shuttingDown` so no new inflight work starts during drain.

### Task 6: Worktree wrapper in `bin/axon`

**File:** `bin/axon`
**What:** Add `--task <id>` and `--worktree` flags. When both present:
1. `git worktree add /tmp/axon-worktrees/task-<id> HEAD`
2. `cd` into worktree
3. Run `bin/axon run` as normal
4. On exit: if clean and succeeded, remove worktree. If dirty/failed, keep and report path.

**Implementation:** New function `setup_worktree()` called before `launch()` in the `run` subcommand when `--task` is provided.

```bash
TASK_ID=""
USE_WORKTREE=false
# ... (parse in the existing while loop)

setup_worktree() {
  WORKTREE_ROOT="${AXON_WORKTREE_ROOT:-/tmp/axon-worktrees}"
  WORKTREE_PATH="$WORKTREE_ROOT/task-${TASK_ID}"
  mkdir -p "$WORKTREE_ROOT"
  git worktree add "$WORKTREE_PATH" HEAD 2>/dev/null || {
    echo "Failed to create worktree for task $TASK_ID" >&2
    exit 1
  }
  cd "$WORKTREE_PATH"
  export AXON_TASK_ID="$TASK_ID"
  export AXON_WORKTREE="$WORKTREE_PATH"
  
  # Cleanup trap
  trap 'cleanup_worktree' EXIT
}

cleanup_worktree() {
  local exit_code=$?
  if [[ -n "${WORKTREE_PATH:-}" && -d "$WORKTREE_PATH" ]]; then
    if [[ $exit_code -eq 0 ]] && git -C "$WORKTREE_PATH" diff --quiet 2>/dev/null; then
      git worktree remove "$WORKTREE_PATH" 2>/dev/null || true
    else
      echo "Worktree kept (dirty or failed): $WORKTREE_PATH" >&2
    fi
  fi
}
```

### Task 7: Tests — existing functionality

**Directory:** `tests/`
**Files:**

#### `tests/test-profile-loading.sh`
- Validate each profile JSONC parses (strip comments, pipe to jq)
- Verify `bin/axon --profile <name> version` succeeds for each known profile
- Verify `bin/axon --profile nonexistent version` fails with clear error

#### `tests/test-launcher-env.sh`
- Source `bin/axon` in dry-run mode (or parse its output)
- Verify OPENCODE_CONFIG_CONTENT is set
- Verify ENGRAM_API_KEY auto-load works
- Verify profile env var substitution

#### `tests/test-fleet-spawn.sh`
- `start-axon-fleet.sh 2` in a test namespace creates 2 tmux sessions
- Already-running sessions are skipped
- Sessions are named correctly

#### `tests/test-plugin-unit.js`
- Mock `fetch` to capture HTTP calls
- Import plugin functions (config, state, capabilities, contextBlock, etc.)
- Assert: session init → correct API call
- Assert: agent registration includes capabilities from engram-agent.json
- Assert: heartbeat fires on prompt
- Assert: tool observation → correct type classification
- Assert: engram tools skipped (toolType returns "skip")
- Assert: session close → deregistration + summary
- Assert: context block respects character budget

#### `tests/test-signal-shutdown.sh`
- Spawn a fake long-running process using the plugin
- Send SIGTERM
- Verify drain completes and process exits 0 within timeout

### Task 8: Tests — new functionality

**Files:**

#### `tests/test-model-override.sh`
- `bin/axon --profile cloud-openrouter --model deepseek/deepseek-v4-pro version` shows V4 Pro
- `bin/axon --model some/model version` sets model for default profile

#### `tests/test-worktree.sh`
- `bin/axon --task 99 --worktree run "echo hello"` creates worktree, runs, cleans up
- Dirty worktree is preserved on failure
- Worktree path matches expected pattern

#### `tests/test-e2e-fleet.sh` (live only — requires LLM endpoint)
- Spawn 2 agents with cloud-openrouter profile + V4 Pro
- Both register with engram (check via engram API)
- Send simple prompt via `opencode run`
- Verify response captured in engram observations
- Shutdown both, verify deregistration

### Task 9: Update documentation

**Files:** `docs/fleet-requirements.md` (mark completed items), `bin/axon` help text, `CLAUDE.md` (if new env vars or commands)

---

## Execution Order

```
Task 1 (--model flag)
  ↓
Task 2 (fleet script) ←── Task 3 (start-axon.sh) [parallel]
  ↓
Task 4 (--project flag) [can be parallel with 2/3]
  ↓
Task 5 (SIGTERM handler) [independent]
  ↓
Task 6 (worktree wrapper) [independent, after Task 1]
  ↓
Task 7 (existing tests) [independent, can start early]
  ↓
Task 8 (new tests) [after Tasks 1-6]
  ↓
Task 9 (docs) [last]
```

**Parallelizable groups:**
- Group A: Tasks 1, 5, 7 (no dependencies between them)
- Group B: Tasks 2, 3, 4 (all depend on Task 1)
- Group C: Tasks 6, 8 (depend on Group B)
- Group D: Task 9 (depends on all)

---

## Verification Criteria

- [ ] `bin/axon --profile cloud-openrouter --model deepseek/deepseek-v4-pro run "2+2"` completes
- [ ] `bin/axon fleet 2 --profile cloud-openrouter` spawns 2 tmux sessions using `bin/axon`
- [ ] SIGTERM to an Axon agent → clean exit within 6 seconds, agent deregistered from engram
- [ ] `bin/axon --task 42 --worktree run "echo done"` → worktree created, used, cleaned up
- [ ] `tests/test-profile-loading.sh` passes in CI (no LLM needed)
- [ ] `tests/test-plugin-unit.js` passes in CI (mocked fetch)
- [ ] `tests/test-e2e-fleet.sh` passes with live OpenRouter endpoint

---

## Open Questions

1. **Worker loop (Approach B):** Should we add `axon worker` as a follow-up? Depends on whether per-task startup overhead is a problem in practice.
2. **Role instructions from engram DB (R1.5):** Deferred — `.axon/instructions.md` + profile JSONC covers current needs.
3. **`opencode serve` fleet path (Approach C):** Deferred until startup overhead is measured and proven to be a bottleneck.
4. **`opencode run` "Provider returned error":** The V4 Pro test via `opencode run` failed with a provider error despite the direct curl working. This needs debugging before the e2e fleet test can pass — likely an OpenCode request formatting issue with the new model entry.
