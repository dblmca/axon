# Axon

Networked coding-agent harness built on a vendored [OpenCode](https://github.com/anomalyco/opencode) runtime. Axon peers with Claude Code and Codex on a shared Engram memory/coordination plane via MCP.

Model-agnostic by design — provider and model selection come from runtime profiles, not repo-level code.

## Quick Reference

```bash
# Smoke test (Qwen endpoint + Engram worker + MCP servers + Axon round-trip)
scripts/smoke-vector-qwen.sh

# Launch interactive session (requires ENGRAM_API_KEY)
ENGRAM_API_KEY=... scripts/run-vector-qwen.sh

# Build/dev (vendored OpenCode)
cd opencode && bun install && bun run dev
```

**Requires:** `bun`, `ENGRAM_API_KEY` for authenticated Engram use.

## Architecture

Three integration layers connect Axon to Engram:

| Layer | Direction | What |
|-------|-----------|------|
| **Capture** | Axon -> Engram | Session init, agent register/heartbeat, prompt capture, tool observation capture |
| **Context** | Engram -> Axon | Startup context, decisions, observations, inbox previews injected into system prompt |
| **Tooling** | Bidirectional | Existing MCP tools (`engram_context`, `engram_search`, `engram_inbox`, `engram_task`, etc.) used directly |

### Boundary Rules

**Axon owns:** local runtime, agent loop, OpenCode UI/session model, Axon-specific prompts/branding, Engram adapter layer, model-selection plumbing.

**Engram owns:** persistent memory, agent registration/inbox/handoff, tasks/orchestration, channels/file locks, working-memory pipelines, MCP tool contracts.

**Shared rule:** Axon consumes Engram and MCPs as external network services. Never recreate those services locally.

## Key Files

| File | Purpose |
|------|---------|
| `opencode/.opencode/plugin/axon-engram.js` | Core Axon plugin — session lifecycle, capture, context injection, env propagation |
| `profiles/axon.vector-qwen-engram.jsonc` | Deployment profile — provider config, tool surface, MCP servers, permissions |
| `scripts/run-vector-qwen.sh` | Launcher — sets env vars, injects profile via `OPENCODE_CONFIG_CONTENT`, runs `bun run dev` |
| `scripts/smoke-vector-qwen.sh` | Smoke test — validates Qwen health, chat completion, Engram worker, MCP servers, full Axon round-trip |
| `docs/architecture.md` | Architecture plan, boundary rules, phase plan |
| `docs/runtime-bootstrap.md` | Deployment walkthrough, env var reference |
| `UPSTREAM.md` | Vendored OpenCode provenance and upstream tracking |

## Deployment

### Default Target: Vector Qwen

The first deployment profile targets the local Vector server running Qwen3.6-35B.

### Environment Variables

| Variable | Default | Required |
|----------|---------|----------|
| `ENGRAM_API_KEY` | — | Yes |
| `AXON_QWEN_BASE_URL` | `http://192.168.1.153:8081/v1` | No |
| `AXON_QWEN_MODEL_ID` | `Qwen3.6-35B-A3B-abliterated-Q4_K_M.gguf` | No |
| `ENGRAM_WORKER_URL` | `http://localhost:37779` | No |
| `AXON_ENGRAM_MCP_SERVER` | `/home/mmca/mcp-servers/engram-mcp/engram-mcp-server.mjs` | No |
| `AXON_AGENTIC_MCP_SERVER` | `/home/mmca/mcp-servers/agentic-mcp/agentic-mcp-server.mjs` | No |

### Profile Override Pattern

Profiles live in `profiles/` as `.jsonc` files. The launcher injects the active profile via `OPENCODE_CONFIG_CONTENT` so the repo-level OpenCode config stays neutral. To add a new deployment target, create a new profile and a corresponding launcher script.

## Subagents and Parallel Work

**Within this repo** — use Claude Code's `Agent` tool to spawn subagents for isolated, parallel subtasks (e.g., editing different files, running independent tests). Each subagent gets its own context and can read/write code in the same worktree.

**Across agents** — use `engram_orchestrate` to create task graphs with dependency ordering and dispatch work to other online agents (Axon, Claude Code, Codex). This is the right tool when tasks span multiple projects, need sequencing, or involve agents that are already running in separate sessions.

| Need | Tool | Example |
|------|------|---------|
| Parallel code tasks in one repo | `Agent` tool | Refactor module A while adding tests for module B |
| Cross-agent workflow with dependencies | `engram_orchestrate` | Task graph: index repo -> review -> write docs, dispatched to 3 agents |
| Send a one-off request to a specific agent | `engram_send` | Ask another agent to check its inbox or run a command |

## Development Notes

- **Runtime:** `bun` (required — OpenCode vendored runtime uses it)
- **Vendored OpenCode:** from `anomalyco/opencode` `dev` branch at commit `10267910`. Upstream tracked via `opencode-upstream` remote (see `UPSTREAM.md`)
- **No git hooks** configured yet
- **Plugin system:** OpenCode's `.opencode/plugin/` directory — the `axon-engram.js` plugin hooks into session events, chat messages, tool execution, shell env, and system prompt transform
- **Qwen tool-calling:** `chat_template_kwargs.enable_thinking=false` is set in the profile because llama.cpp tool-calling is more reliable with thinking disabled
- **Degradation:** If `ENGRAM_API_KEY` is missing, the plugin degrades to a no-op — no partial local imitation
