# Axon

A networked coding-agent harness built on [OpenCode](https://github.com/anomalyco/opencode), designed to peer with Claude Code and Codex on a shared [Engram](https://github.com/dblmca/engram) memory and coordination plane.

Model-agnostic by design. The first deployment target is a local Qwen3.6-35B, but provider and model selection come from runtime profiles, not hardwired code.

## What It Does

Axon gives any LLM the same collaborative infrastructure that Claude Code agents use:

- **Shared memory** — sessions, observations, and decisions persist in Engram across all agents
- **Agent identity** — registers on the Engram agent network with heartbeat, inbox, and capability discovery
- **Cross-agent coordination** — tasks, orchestration graphs, channels, file locks, and context windows
- **MCP interop** — consumes the same MCP tool surface as Claude Code and Codex

## Quick Start

```bash
# Add to PATH (or symlink bin/axon somewhere on your PATH)
export PATH="/home/mmca/projects/axon/bin:$PATH"

# Interactive TUI (auto-loads ENGRAM_API_KEY from ~/engram/engram-server/.env)
axon

# Headless single-prompt mode
axon run "list the current directory"

# Smoke test + interop test
axon smoke
axon test

# Use a different profile
axon --profile cloud-openrouter
axon --profile minimal-offline

# Start a fleet of N agents in tmux
axon fleet 4
```

Requires `bun` and a running Engram server (except `minimal-offline` profile).

## Architecture

```
Axon (this repo)                    Engram (network)
+-----------------------+           +------------------------+
|  OpenCode runtime     |           |  Memory + retrieval    |
|  Agent loop + TUI     |<---MCP--->|  Agent registry        |
|  axon-engram plugin   |           |  Tasks + orchestrator  |
|  Deployment profiles  |           |  Channels + locks      |
+-----------------------+           +------------------------+
```

Three integration layers:

| Layer | Direction | Purpose |
|-------|-----------|---------|
| **Capture** | Axon -> Engram | Session lifecycle, agent registration, prompt/tool observation capture |
| **Context** | Engram -> Axon | Startup context, decisions, inbox previews injected into system prompt |
| **Tooling** | Bidirectional | MCP tools used directly (`engram_search`, `engram_task`, `engram_inbox`, etc.) |

**Boundary rule:** Axon consumes Engram as an external service. It never recreates memory, coordination, or retrieval locally.

Full architecture doc: [docs/architecture.md](docs/architecture.md)

## Key Files

| File | What |
|------|------|
| `bin/axon` | CLI entry point — profile selection, subcommands, auto-config |
| `opencode/.opencode/plugin/axon-engram.js` | Core plugin — session init, capture, context injection |
| `profiles/axon.vector-qwen-engram.jsonc` | Deployment profile — provider, tools, permissions, MCP config |
| `scripts/run-vector-qwen.sh` | Launcher — injects profile via `OPENCODE_CONFIG_CONTENT` |
| `scripts/smoke-vector-qwen.sh` | Smoke test — validates full stack end-to-end |
| `scripts/test-interop.sh` | Interop test suite — 10 tests across Engram coordination plane |
| `profiles/axon.remote-engram.jsonc` | Remote Engram profile — Qwen + remote Engram host |
| `profiles/axon.cloud-openrouter.jsonc` | Cloud profile — OpenRouter + local Engram |
| `profiles/axon.minimal-offline.jsonc` | Offline profile — local Qwen only, no network |
| `docs/architecture.md` | Architecture plan and boundary rules |
| `docs/runtime-bootstrap.md` | Deployment walkthrough and env var reference |

## Deployment Profiles

Profiles live in `profiles/` as `.jsonc` files. The launcher injects the active profile via `OPENCODE_CONFIG_CONTENT`, keeping the repo-level OpenCode config neutral.

| Profile | Provider | Engram | Use Case |
|---------|----------|--------|----------|
| `axon.vector-qwen-engram` | Local Qwen3.6-35B | Local | Default — full local stack |
| `axon.remote-engram` | Local Qwen3.6-35B | Remote host | Axon on a different machine than Engram |
| `axon.cloud-openrouter` | OpenRouter (DeepSeek V3) | Local | When local GPU is busy |
| `axon.minimal-offline` | Local Qwen3.6-35B | None | Offline coding, no network dependencies |

| Variable | Default |
|----------|---------|
| `ENGRAM_API_KEY` | *(required, except minimal-offline)* |
| `AXON_QWEN_BASE_URL` | `http://192.168.1.153:8081/v1` |
| `AXON_QWEN_MODEL_ID` | `Qwen3.6-35B-A3B-abliterated-Q4_K_M.gguf` |
| `ENGRAM_WORKER_URL` | `http://localhost:37779` |
| `OPENROUTER_API_KEY` | *(required for cloud profile)* |

## Upstream

OpenCode vendored from [`anomalyco/opencode`](https://github.com/anomalyco/opencode) `dev` branch. See [UPSTREAM.md](UPSTREAM.md) for provenance and tracking commands.

## How This Was Built

Axon was bootstrapped by a team of AI agents coordinated through Engram's task orchestrator.

A human defined the project intent and architecture boundaries, then dispatched work as orchestrated task graphs. Four Claude Code agents — running in parallel tmux sessions — picked up tasks, executed them, and reported completion back through the Engram coordination plane. The orchestrator handled dependency ordering, dispatch, stall detection, and graph completion tracking.

The first sprint (initial commit, plugin audit, CLAUDE.md, smoke test verification) ran as a single graph with a sequential gate on the initial commit followed by three parallel tasks. The second sprint (system-message fix, codebase investigation, subagent guidance, gap tracker) ran fully parallel.

Along the way, bugs in the orchestrator itself were found and fixed: idle detection that couldn't see past the Claude Code status bar, dispatch messages that didn't tell agents how to close their tasks, reminder dedup races, and a schema constraint that silently blocked a message type.

Sprint 3 fixed the system-message ordering bug that blocked non-pure (authenticated) launches with Qwen's chat template.

Sprint 4 closed all Phase 2 and Phase 3 gaps from the architecture: assistant-response capture, session summarization, tighter prompt injection, three new deployment profiles, agent naming alignment, and a 10-test interop suite proving Axon participates on the Engram coordination plane (agent registration, messaging, channels, tasks, context retrieval). Two Phase 4 items remain (UX rebrand and native coordination affordances).

The agents that built Axon are the same kind of agents Axon is designed to run.

## License

See [opencode/LICENSE](opencode/LICENSE) for the vendored OpenCode license.
