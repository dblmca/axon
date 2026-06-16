# V1 Plan #1: Stabilize Axon Core

**Status:** ✅ COMPLETED (2026-06-16)
**Source:** Planning market `orca-axon-whats-next-2c4d37d6` (2026-06-15)
**Winner:** risk-stability (Gemini 2.5 Pro), unanimous across 4 judges
**Estimated cost:** $2–4 | **Estimated time:** ~90 min parallel

## Goal

Fix a verified critical bug (inbox .catch()), build a test safety net for the
plugin backbone, add memory-leak guards, then split the 989-line plugin monolith.

## Tasks

### Task 1: Fix inbox .catch() bug + harden request() error handling

**Model:** deepseek-v4-flash
**Blocks:** (none — independent)
**Estimated cost:** $0.05

CRITICAL BUG: `contextBlock()` line 649 — inbox request in `Promise.all` has no
`.catch()`. A network error rejects the entire `Promise.all`, silently dropping
sandwich + tasks context too. One-line fix.

Also harden `request()` (lines ~455-478): add error logging around fetch and the
silent JSON-parse swallow.

**Acceptance checks:**
- [ ] Inbox request has `.catch(() => ({ok:false,status:0}))` or equivalent
- [ ] request() logs errors instead of swallowing them silently
- [ ] Existing tests still pass (if any)

### Task 2: Unit tests for HTTP/lifecycle/context backbone

**Model:** deepseek-v4-pro
**After:** 1
**Estimated cost:** $0.45

Add unit tests for the core plugin functions: `request()`, `ensureSession()`,
`syncAgent()`, `contextBlock()`, `postObservation()`, `drain()`, `agentProfile()`.
Mock fetch; verify timeout, error, and success paths. Target ~60% function coverage.

**Acceptance checks:**
- [ ] Unit test file exists (test/axon-engram.test.js or similar)
- [ ] Tests cover request(), ensureSession(), syncAgent(), contextBlock()
- [ ] Tests verify error paths (network failure, timeout, bad JSON)
- [ ] Tests pass

### Task 3: SessionState eviction + inflight cap + remove daysOld

**Model:** deepseek-v4-pro
**After:** 2
**Estimated cost:** $0.30

`sessionState` Map and `inflight` Set grow unboundedly. Add TTL-based eviction
and a concurrency cap. Remove ONLY the one confirmed-dead function `daysOld`
(line 595) — do NOT remove noteModel, promptText, toolType, or splitList (they
are live via dynamic dispatch despite jCodeMunch flagging them).

**Acceptance checks:**
- [ ] sessionState has TTL-based eviction (e.g. 1 hour)
- [ ] inflight has a concurrency cap (e.g. 20)
- [ ] daysOld function removed
- [ ] noteModel, promptText, toolType, splitList UNTOUCHED
- [ ] Tests pass

### Task 4: Split axon-engram.js into focused modules

**Model:** claude-sonnet-4-6
**After:** 2
**Parallel with:** 3
**Estimated cost:** $3.60

Split the 989-line `opencode/.opencode/plugin/axon-engram.js` into focused
modules: lifecycle, capture, context, identity, util. Keep the main plugin file
as a thin orchestrator that imports and wires the modules.

Run the full test suite after each extraction. This is the riskiest task — must
be done AFTER the test net (task 2) exists.

**Acceptance checks:**
- [ ] axon-engram.js reduced to thin orchestrator (under ~200 lines)
- [ ] Each extracted module under 300 lines
- [ ] All plugin hooks still fire correctly
- [ ] Tests from task 2 still pass
- [ ] OpenCode plugin system loads the refactored plugin without errors

## Dependency Graph

```
Task 1 (bug fix) → Task 2 (tests) → Task 3 (eviction)
                                   → Task 4 (split)  [3 and 4 parallel]
```

## Deferred to Backlog

- Phase 3 interop (cross-agent handoff, live fleet e2e) — after stability
- Fleet health monitoring + auto-restart — needs design spec first
- UX: surface plugin errors, profile validation, fleet dashboard
- Feature-gap T-01 (assistant-response capture) — already shipped at line 893
