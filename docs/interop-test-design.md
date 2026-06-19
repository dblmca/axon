# Interop Test Design

## Purpose

Verify Claude <-> Axon <-> Codex interop through shared Engram state.
Phase 3 of the Axon architecture — prove the three clients are peers,
not islands.

## Test Layering

Tests are layered from cheapest/fastest to most expensive:

| Layer | Description | Live agents? | Runs in CI? |
|---|---|---|---|
| L0 | API contract (shell, curl) | No | Yes |
| L1 | MCP tool (bun, MCP SDK) | No | Yes |
| L2 | Single-agent Axon smoke (bun + real loop) | Yes | Conditional |
| L3 | Cross-agent scenario (multiple agents) | Yes | Manual / nightly |

The initial implementation targets L0 only — API-level calls against
the Engram worker, no live agent loop required.

## Scenarios

### S1: Shared Task Graph

**Goal:** Prove multiple agents from different clients can participate in
the same orchestrated task graph.

**Setup:**
- Create 3 tasks linked by a shared `graph_id`
- Register 3 agents: one each for Axon, Claude, Codex emulation

**Steps (L0):**
1. Create graph via `POST /api/tasks` with `graph_id="interop-graph-1"`
   and tasks T1, T2, T3
2. Verify all tasks visible via `GET /api/tasks?graph_id=...`
3. Agent-A (Axon) claims T1
4. Agent-B (Claude) claims T2
5. Agent-C (Codex) claims T3
6. Verify each task reflects the correct assignee
7. Clean up

**Assertions:**
- Three distinct agents see the same graph
- Each claim is atomic (no double-claim)
- Task state is consistent across clients

### S2: Cross-Agent Messaging

**Goal:** Agents from different runtimes exchange directed messages.

**Already covered by existing test b (message send/receive).**
Extend with multi-agent variation when L3 is implemented.

### S3: Shared Channels

**Goal:** Multiple agents from different clients read/write the same channel.

**Already covered by existing test c (channel create/post/read).**
Extend with cross-agent reads when L3 is implemented.

### S4: File Lock Coordination

**Goal:** Two agents from different clients coordinate exclusive access
to a shared file lock.

**Steps (L0):**
1. Create a file lock for path `/interop/test-file.txt`
2. Agent-A acquires the lock
3. Agent-B attempts to acquire the same lock — must fail or queue
4. Agent-A releases the lock
5. Agent-B acquires the lock
6. Clean up

**Assertions:**
- Exclusive ownership is enforced
- Release makes lock available
- Lock metadata identifies the holder

### S5: Context Visibility

**Goal:** Cross-client work is visible in shared context.

**Already partially covered by existing test e (context retrieval).**
Extend with cross-client session data when L2 is implemented.

## API Surface (Engram Worker)

The following endpoints are exercised by L0 tests:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/tasks` | POST | Create task (optionally in a graph) |
| `/api/tasks` | GET | List tasks by project, assignee, or graph |
| `/api/tasks/:id` | PATCH | Update task (claim, status, assign) |
| `/api/tasks/:id` | DELETE | Remove task |
| `/api/file-locks` | POST | Create a file lock |
| `/api/file-locks/:path` | POST | Acquire/release a file lock |
| `/api/file-locks` | GET | List file locks by project |
| `/api/channels` | POST | Create channel |
| `/api/channels/:id/messages` | POST | Post to channel |
| `/api/channels/:id/messages` | GET | Read channel messages |
| `/api/agents/register` | POST | Register agent |
| `/api/agents` | GET | List agents |
| `/api/agents/messages` | POST | Send agent-to-agent message |
| `/api/agents/messages/inbox` | GET | Read inbox |

## Running

```bash
# L0 — API contract tests (no live agents)
ENGRAM_API_KEY=... ./scripts/test-interop.sh

# L1 — MCP tool tests (no live agents, needs bun)
bun test tests/test-interop-mcp.mjs

# L2 — Single-agent smoke (needs model endpoint)
ENGRAM_API_KEY=... AXON_QWEN_BASE_URL=... ./scripts/test-interop-smoke.sh
```

## Acceptance for Phase 3

- [x] RS-1: Design doc written (this file)
- [ ] RS-2: L0 test passes (shared task-graph create/claim)
- [ ] RS-3: L1 MCP tool test framework in place
- [ ] RS-4: L2 smoke test stubs defined

## Future: L3 Cross-Agent Scenarios

When budget and infrastructure permit, add live multi-agent scenarios:
- Two Axon agents collaborating on the same graph
- Axon agent handing off to a Claude Code agent via Engram inbox
- Codex sidecar tailing an Axon session and picking up context
- File lock contention with real concurrent workers
