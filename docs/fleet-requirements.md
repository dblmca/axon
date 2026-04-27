# Axon Fleet Capabilities — Requirements

## Context

Orchestrator v2 needs Axon agents as a fleet option alongside Claude Code agents. The engram fleet coordinator (AgentPool) must be able to spawn, manage, and drain Axon agents running DeepSeek V4 Pro, V4 Flash, or local Qwen models. Phase 4 target (post Wed Apr 29 kickoff).

Reference: engram-one-de9d feature request (#2797), engram notes #90 (role definitions), #91 (profiles + skill gaps), orchestrator v2 plan at `~/.claude/plans/orchestrator-v2-fleet.md`.

---

## R1: Profile-Based Agent Launching

### R1.1: `start-axon.sh --profile <name>` flag
Status: implemented via `start-axon.sh` pass-through to `bin/axon`.
- Accept `--profile <name>` that maps to `profiles/axon.<name>.jsonc`
- Fall back to `vector-qwen` if no profile specified (current behavior)
- Validate profile file exists before launching
- Pass through to `OPENCODE_CONFIG_CONTENT`

### R1.2: `--model <slug>` override
Status: implemented in `bin/axon`; local profiles set `AXON_QWEN_MODEL_ID`, cloud profiles set `AXON_OPENROUTER_MODEL`.
- Accept `--model <provider/model>` that overrides the profile's default model
- Sets `AXON_OPENROUTER_MODEL` for cloud profiles
- Sets `AXON_QWEN_MODEL_ID` for local profiles
- Example: `start-axon.sh --profile cloud-openrouter --model deepseek/deepseek-v4-pro`

### R1.3: `--project <name>` flag
Status: implemented in `bin/axon`; the plugin honors `ENGRAM_PROJECT`.
- Sets `ENGRAM_PROJECT` so the agent registers under the correct project in engram
- Defaults to directory-based detection (current behavior)

### R1.4: Fleet launcher profile support
Status: implemented in `start-axon-fleet.sh`; accepts positional count or `--count`.
- `start-axon-fleet.sh` accepts `--profile` and `--model` flags
- Passes them through to each `start-axon.sh` invocation
- Example: `start-axon-fleet.sh 3 --profile cloud-openrouter --model deepseek/deepseek-v4-pro`

### R1.5: Role instructions injection (stretch)
- On startup, fetch role instructions from engram DB: `GET /api/agents/profiles/{role}`
- Write to `.axon/instructions.md` (plugin already reads this file)
- Falls back gracefully if engram unreachable or role not found

---

## R2: Auto-Approve for Fleet Agents

### R2.1: CLI one-shot mode
- `opencode run` with `--dangerously-skip-permissions` auto-approves all permissions
- Already implemented in vendored OpenCode — **no code changes needed**
- Document this as the recommended fleet approach

### R2.2: Headless serve mode
- `opencode serve` needs equivalent of `--dangerously-skip-permissions`
- Verify this flag exists for serve mode; if not, add it or document the alternative

### R2.3: SDK programmatic path (future)
- `permission.reply({ requestID, action })` API available for granular control
- Not needed for Phase 4 — document for future use

---

## R3: Fleet Protocol Compliance

### R3.1: Task claiming
- Agent reads pending tasks via `engram_task action="scan_available"`
- Claims tasks matching its capability profile
- Implementation: model-level instructions in role profile, not plugin code
- Plugin could optionally auto-inject pending tasks into context (already partially done via context block)

### R3.2: Progress updates
- Agent posts structured updates to engram task record via `engram_task action="update"`
- Posts to project channel via `engram_channel`
- Implementation: role instructions define update cadence and format

### R3.3: Worktree isolation
Status: implemented in `bin/axon` for `--task <id> --worktree run ...`.
- Launcher creates `git worktree add` per task before starting agent
- Agent commits with `[task-{id}]` prefix
- On completion, worktree is cleaned up or merged
- Implementation: wrapper in `start-axon.sh` with `--task <id>` and `--worktree` flags

### R3.4: Shutdown protocol
Status: SIGTERM/SIGINT handler implemented in the plugin; inbox-driven shutdown remains instruction-based.
- On receiving `shutdown_request` message via engram inbox:
  1. Finish current tool execution
  2. Send `shutdown_response` message
  3. Exit cleanly
- Implementation options:
  a. Plugin polls inbox periodically (adds complexity)
  b. Model checks inbox between tasks (instruction-based)
  c. External signal (SIGTERM handler in plugin triggers drain + deregister)
- Recommended: (c) SIGTERM handler + model-level inbox check instructions

### R3.5: Channel posting
- Agent posts completion summaries to `#graph-{id}` channel
- Implementation: role instructions — no code changes needed

---

## R4: Pool Manager Integration

### R4.1: Spawn command template
- AgentPool spawns Axon agents with:
  ```
  tmux new-session -d -s {role}-{id} \
    "ENGRAM_API_KEY=... start-axon.sh --profile {profile} --model {model} --project {project}"
  ```
- Agent auto-registers with engram on startup (already implemented)

### R4.2: Ownership tracking
- Pool-spawned agents use naming convention: `{role}-{pool-id}`
- Pool tracks which tmux sessions it owns vs user-launched
- Implementation: engram-side, not Axon-side

### R4.3: Drain idle agents
- Pool sends `shutdown_request` via `engram_send`
- Agent responds per R3.4
- Pool waits for `shutdown_response`, then verifies tmux session gone

### R4.4: Force-kill
- After timeout, pool runs `tmux kill-session -t {session}`
- Engram marks agent as offline after missed heartbeats
- No Axon changes needed

---

## R5: Session Capture

### R5.1: Current capture (already works)
- Prompt capture → engram `/api/sessions/{id}/prompts`
- Tool observation capture → engram `/api/sessions/{id}/observations`
- Response capture → engram observations with type `assistant_response`
- Session summary on close → engram `/api/sessions/{id}/summarize`
- Agent registration + heartbeat → engram `/api/agents/register` + `/api/agents/heartbeat`
- Agent deregistration on session delete

### R5.2: Verify capture feeds working memory pipeline
- Confirm observations reach the engram working memory judge
- Confirm instinct extractor can learn from Axon agent sessions
- Implementation: integration test that runs an Axon session and checks engram for captured data

---

## T: Test Requirements

### T1: Tests for Existing Functionality

#### T1.1: Profile injection
Status: covered by `tests/test-profile-loading.sh` and launcher dry-run checks.
- Test: Load each profile JSONC, verify valid JSON after stripping comments
- Test: `OPENCODE_CONFIG_CONTENT` env var is set correctly by launcher scripts
- Test: Profile env var substitution works (`{env:VARIABLE}` patterns resolve)

#### T1.2: Plugin lifecycle
- Test: Session init → engram API called with correct project/hostname/source_ai
- Test: Agent registration includes correct capabilities from `.axon/engram-agent.json`
- Test: Heartbeat fires on each prompt
- Test: Session close → deregistration + summary posted
- Test: Drain waits for inflight requests

#### T1.3: Context injection
- Test: System prompt transform includes `<axon-engram>` block
- Test: Context respects character budget
- Test: Stale context is refreshed after TTL

#### T1.4: Tool observation capture
Status: tool classification covered by `tests/test-plugin-unit.mjs`; full observation capture remains an integration concern.
- Test: Bash execution → observation posted with type `command`
- Test: Edit execution → observation posted with type `code_edit`
- Test: Engram tools are skipped (type `skip`)

#### T1.5: CLI one-shot mode
- Test: `opencode run "prompt"` completes and exits
- Test: `--format json` outputs valid JSON events
- Test: `--dangerously-skip-permissions` auto-approves
- Test: `--session` continues existing session

#### T1.6: Fleet launcher
Status: command construction covered by `tests/test-fleet-spawn.sh` with a fake `tmux`.
- Test: `start-axon-fleet.sh 2` creates 2 tmux sessions
- Test: Already-running sessions are skipped (not duplicated)
- Test: Sessions are named `axon-1`, `axon-2`, etc.

### T2: Tests for New Functionality

#### T2.1: Profile flag
- Test: `start-axon.sh --profile cloud-openrouter` loads correct profile
- Test: `start-axon.sh --profile nonexistent` fails with clear error
- Test: `start-axon.sh` (no flag) defaults to vector-qwen

#### T2.2: Model override
Status: covered by `tests/test-model-override.sh`.
- Test: `--model deepseek/deepseek-v4-pro` sets correct env var
- Test: Model override propagates through to OpenCode config

#### T2.3: Worktree isolation
Status: covered by `tests/test-worktree.sh`.
- Test: `--task 42 --worktree` creates git worktree before launch
- Test: Agent working directory is the worktree
- Test: Worktree is cleaned up on agent exit

#### T2.4: Shutdown handler
Status: covered by `tests/test-signal-shutdown.mjs`.
- Test: SIGTERM → plugin drains inflight, deregisters, exits 0
- Test: Graceful shutdown completes within timeout

#### T2.5: End-to-end fleet test
- Test: Spawn 2 agents with cloud-openrouter profile + V4 Pro
- Test: Both register with engram
- Test: Send a simple prompt via `opencode run`
- Test: Verify response captured in engram
- Test: Shutdown both, verify deregistration

---

## Non-Requirements (Explicitly Out of Scope)

- Plugin-level auto-claiming (model-level instructions are sufficient)
- Profile inheritance/composition (single profile per agent is fine)
- Resource allocation/limits (handled by tmux + OS, not Axon)
- Dead letter queue (engram-side concern)
- Protocol version negotiation (premature)
