# Axon

A networked coding-agent harness built on [OpenCode](https://github.com/anomalyco/opencode), designed to peer with Claude Code and Codex on a shared [Engram](https://github.com/dblmca/engram) memory and coordination plane.

Model-agnostic by design. The default deployment target is DeepSeek V4 Pro, but provider and model selection come from runtime profiles, not hardwired code.

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

# Automation mode with permission auto-approval
axon run --yes "run the smoke check"

# Smoke test + interop test
axon smoke
axon test

# Use a different profile
axon --profile vector-qwen-engram
axon --profile cloud-openrouter
axon --profile minimal-offline

# Start a fleet of N agents in tmux
axon fleet 4

# Start a cloud fleet with an explicit model and project
axon fleet 3 --profile cloud-openrouter --model deepseek/deepseek-v4-pro --project axon

# Run a task in an isolated git worktree
axon --task 42 --worktree run "complete task 42"
```

Requires `bun`, `DEEPSEEK_API_KEY` for the default profile, and a running Engram server (except `minimal-offline` profile).

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
| `profiles/axon.cloud-deepseek.jsonc` | Default deployment profile — DeepSeek V4 Pro with Engram/MCP config |
| `profiles/axon.vector-qwen-engram.jsonc` | Local Qwen deployment profile — provider, tools, permissions, MCP config |
| `scripts/run-vector-qwen.sh` | Launcher — injects profile via `OPENCODE_CONFIG_CONTENT` |
| `scripts/smoke-vector-qwen.sh` | Smoke test — validates full stack end-to-end |
| `scripts/test-interop.sh` | Interop test suite — 10 tests across Engram coordination plane |
| `.axon/instructions.md` | System instructions injected into every Axon session |
| `profiles/axon.remote-engram.jsonc` | Remote Engram profile — Qwen + remote Engram host |
| `profiles/axon.cloud-openrouter.jsonc` | Cloud profile — OpenRouter + local Engram |
| `profiles/axon.minimal-offline.jsonc` | Offline profile — local Qwen only, no network |
| `docs/architecture.md` | Architecture plan and boundary rules |
| `docs/runtime-bootstrap.md` | Deployment walkthrough and env var reference |

## Deployment Profiles

Profiles live in `profiles/` as `.jsonc` files. The launcher injects the active profile via `OPENCODE_CONFIG_CONTENT`, keeping the repo-level OpenCode config neutral.

| Profile | Provider | Engram | Use Case |
|---------|----------|--------|----------|
| `axon.cloud-deepseek` | DeepSeek V4 Pro | Local | Default — cloud model with local Engram |
| `axon.vector-qwen-engram` | Local Qwen3.6-35B | Local | Full local stack |
| `axon.remote-engram` | Local Qwen3.6-35B | Remote host | Axon on a different machine than Engram |
| `axon.cloud-openrouter` | OpenRouter (DeepSeek V4 Pro) | Local | OpenRouter fallback |
| `axon.minimal-offline` | Local Qwen3.6-35B | None | Offline coding, no network dependencies |

| Variable | Default |
|----------|---------|
| `ENGRAM_API_KEY` | *(required, except minimal-offline)* |
| `AXON_QWEN_BASE_URL` | `http://192.168.1.153:8081/v1` |
| `AXON_QWEN_MODEL_ID` | `Qwen3.6-35B-A3B-abliterated-Q4_K_M.gguf` |
| `AXON_OPENROUTER_MODEL` | `deepseek/deepseek-v4-pro` |
| `AXON_DEEPSEEK_MODEL` | `deepseek-v4-pro` |
| `AXON_WORKTREE_ROOT` | `/tmp/axon-worktrees` |
| `AXON_SKIP_PERMISSIONS` | `1` enables headless permission auto-approval |
| `AXON_NO_ENGRAM` | `1` disables Engram session init/complete in the launcher (MCP must also be disabled in profile) |
| `AXON_AGENT_ROLE` / `ENGRAM_AGENT_ROLE` | `implementation_worker` |
| `AXON_MODEL_CLASS` / `ENGRAM_MODEL_CLASS` | inferred from active model |
| `AXON_MODEL_TIER` / `ENGRAM_MODEL_TIER` | inferred from active model |
| `AXON_COST_TIER` / `ENGRAM_COST_TIER` | inferred from active model |
| `AXON_AGENT_CAPABILITIES` / `ENGRAM_AGENT_CAPABILITIES` | comma-separated extra capability tags |
| `AXON_AGENT_SKILLS` / `ENGRAM_AGENT_SKILLS` | comma-separated skill tags |
| `AXON_AGENT_LIMITS` / `ENGRAM_AGENT_LIMITS` | JSON limits object/array |
| `AXON_RELEASE_AGENT_EXEMPT` / `ENGRAM_RELEASE_AGENT_EXEMPT` | `true` for out-of-pool release agents |
| `ENGRAM_WORKER_URL` | `http://localhost:37779` |
| `DEEPSEEK_API_KEY` | *(required for default cloud-deepseek profile)* |
| `OPENROUTER_API_KEY` | *(required for cloud profile)* |

## Engram Connection

Engram is disabled in the `cloud-deepseek` profile as of 2026-06-07. Axon runs in tool-only mode — vergence-p MCP + jcodemunch, no shared memory or agent coordination. To re-enable:

1. Set `"enabled": true` on `engram` and `agentic-mcp` in `profiles/axon.cloud-deepseek.jsonc`
2. Remove `AXON_NO_ENGRAM` from env (if set)

Reason: during pentest testing, Engram adds latency and cross-talk without benefit to single-agent headless runs. Re-enable when fleet coordination or memory persistence is needed.

## Upstream

OpenCode vendored from [`anomalyco/opencode`](https://github.com/anomalyco/opencode) `dev` branch. See [UPSTREAM.md](UPSTREAM.md) for provenance and tracking commands.

## How This Was Built

Axon was bootstrapped by a team of AI agents coordinated through Engram's task orchestrator.

A human defined the project intent and architecture boundaries, then dispatched work as orchestrated task graphs. Four Claude Code agents — running in parallel tmux sessions — picked up tasks, executed them, and reported completion back through the Engram coordination plane. The orchestrator handled dependency ordering, dispatch, stall detection, and graph completion tracking.

The first sprint (initial commit, plugin audit, CLAUDE.md, smoke test verification) ran as a single graph with a sequential gate on the initial commit followed by three parallel tasks. The second sprint (system-message fix, codebase investigation, subagent guidance, gap tracker) ran fully parallel.

Along the way, bugs in the orchestrator itself were found and fixed: idle detection that couldn't see past the Claude Code status bar, dispatch messages that didn't tell agents how to close their tasks, reminder dedup races, and a schema constraint that silently blocked a message type.

Sprint 3 fixed the system-message ordering bug that blocked non-pure (authenticated) launches with Qwen's chat template.

Sprint 4 closed all Phase 2 and Phase 3 gaps from the architecture: assistant-response capture, session summarization, tighter prompt injection, three new deployment profiles, agent naming alignment, and a 10-test interop suite proving Axon participates on the Engram coordination plane (agent registration, messaging, channels, tasks, context retrieval).

Sprint 5 added tmux-based persistent sessions and fleet management, plus a status dashboard.

Sprint 6 added the `bin/axon` CLI wrapper (profile auto-detection, ENGRAM_API_KEY auto-load, subcommands), `.axon/instructions.md` for per-project system instructions, graceful shutdown with HTTP request draining, and fixed MCP tool visibility so Qwen can discover and call engram tools.

Sprint 7 wired Axon for fleet spawning: `--model` and `--project` pass-through, tmux launchers use `bin/axon`, task worktrees are created and cleaned up by the launcher, and the plugin deregisters agents on SIGTERM/SIGINT.

The agents that built Axon are the same kind of agents Axon is designed to run.

## License

See [opencode/LICENSE](opencode/LICENSE) for the vendored OpenCode license.
