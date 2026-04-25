# Axon Architecture

## Purpose

Axon is not a fork of Engram and it is not a replacement for the shared MCP stack.

Axon should become a strong OpenCode-derived client that can participate in the
same live memory, inbox, task, channel, lock, and orchestration workflows as
Claude Code and Codex.

## Boundary

The repo boundary should stay clean.

### Axon owns

- the local runtime and agent loop
- OpenCode-derived UI and session model
- Axon-specific prompts, defaults, and branding
- an Engram adapter layer for capture, context injection, and env propagation
- model-selection plumbing and defaults, but not a fixed provider dependency

### Engram owns

- persistent memory and retrieval
- agent registration, inbox, handoff, and heartbeat state
- tasks, orchestration graphs, context windows, channels, and file locks
- working-memory judgment and memory extraction pipelines
- MCP tool contracts and network APIs

### Shared rule

Axon should consume Engram and the MCPs as external network services.
It should not recreate those services in this repo.

That interop requirement is the core constraint, not a nice-to-have.

## Why This Fits OpenCode

The vendored OpenCode base already has the right extension seams:

- repo-local server plugins under `.opencode/plugin`
- MCP client configuration and runtime
- system-prompt transform hooks
- message hooks
- tool hooks
- shell environment injection hooks

That means the Claude-side Engram patterns are portable, while the Codex
sidecar mechanics mostly are not.

The useful Claude/Codex lessons are:

- initialize shared session state early
- register a stable agent identity
- inject memory and inbox context conservatively
- record prompts and tool activity without breaking flow
- preserve a shared cross-client worldview through MCP tools

The parts that should *not* be pulled into Axon core are the Codex-specific
workarounds: tailing client logs, tmux injection, and sidecar replay.

## Axon Integration Model

Axon should integrate with Engram at three layers.

### 1. Capture layer

Axon should write session lifecycle and activity to Engram:

- session init
- agent register and heartbeat
- user prompt capture
- tool observation capture
- eventual assistant-response capture and summaries

### 2. Context layer

Axon should read Engram state to improve live sessions:

- startup context for the current project
- recent decisions
- relevant observations and sessions
- inbox previews and identity reminders

### 3. Tooling layer

Axon should use the existing MCP surface directly:

- `engram_context`
- `engram_search`
- `engram_recall`
- `engram_inbox`
- `engram_task`
- `engram_channel`
- `engram_file_lock`
- related shared MCP tools from the broader stack

This is what makes Claude Code, Codex, and Axon peers rather than islands.

## First Slice

The first implementation slice should stay small and network-first.

Implemented in [opencode/.opencode/plugin/axon-engram.js](/home/mmca/projects/axon/opencode/.opencode/plugin/axon-engram.js):

- Engram session initialization and agent registration
- prompt capture for user turns
- lightweight tool observation capture
- shell environment propagation for downstream tools and MCP calls
- cached system-prompt context built from Engram server state

Not in the first slice:

- local Engram server clone
- local MCP reimplementation
- tmux delivery
- sidecar log scraping
- full response summarization pipeline

## Runtime Contract

Axon should assume these live outside the repo:

- `ENGRAM_API_KEY`
- `ENGRAM_WORKER_URL`
- one or more connected MCP servers, including Engram
- provider and model selection for the active deployment

If those are missing, the Axon plugin should degrade to a no-op instead of
creating a partial local imitation.

The initial deployment target can be a local `qwen3.6`, but that choice should
stay in runtime configuration. Axon should report the active provider/model to
Engram when known and remain able to run against different local or remote
models without code changes.

## Phase Plan

### Phase 1

- keep the vendored OpenCode tree intact
- land the Axon/Engram plugin
- document the boundary clearly

### Phase 2

- add default Axon config profiles for networked Engram and shared MCP servers
- tighten prompt injection around inbox, decisions, and startup recall
- add assistant-response capture

### Phase 3

- add interop tests proving Claude -> Axon -> Codex workflows
- verify shared task graphs, channels, and file locks across clients
- align agent naming and capabilities with Engram discovery conventions

### Phase 4

- rebrand and reshape the user-facing Axon experience
- add Axon-native affordances for shared memory and coordination without
  changing Engram's network contracts

## Design Rule

When Axon needs a new shared capability, prefer:

1. use an existing Engram API or MCP tool
2. extend Engram's shared API if needed
3. only add Axon-local state when it is purely local UX state

That rule protects interoperability and keeps the system coherent.
