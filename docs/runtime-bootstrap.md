# Axon Runtime Bootstrap

This is the first concrete Axon deployment path.

It keeps the architecture model-agnostic while giving Axon a real initial runtime:

- provider: local Vector `Qwen3.6-35B-A3B-abliterated-Q4_K_M`
- MCP bootstrap: local `engram-mcp` and `agentic-mcp`
- Engram session/plugin wiring: still handled by [opencode/.opencode/plugin/axon-engram.js](/home/mmca/projects/axon/opencode/.opencode/plugin/axon-engram.js)
- local runtime guardrails: Qwen thinking disabled in provider options, reduced default tool surface, curated Engram interop whitelist

## Files

- profile: [profiles/axon.vector-qwen-engram.jsonc](/home/mmca/projects/axon/profiles/axon.vector-qwen-engram.jsonc)
- launcher: [scripts/run-vector-qwen.sh](/home/mmca/projects/axon/scripts/run-vector-qwen.sh)
- smoke check: [scripts/smoke-vector-qwen.sh](/home/mmca/projects/axon/scripts/smoke-vector-qwen.sh)

## Required Env

- `ENGRAM_API_KEY`

## Defaults Set By The Launcher

- `AXON_QWEN_BASE_URL=http://192.168.1.153:8081/v1`
- `AXON_QWEN_MODEL_ID=Qwen3.6-35B-A3B-abliterated-Q4_K_M.gguf`
- `AXON_ENGRAM_MCP_SERVER=/home/mmca/mcp-servers/engram-mcp/engram-mcp-server.mjs`
- `AXON_AGENTIC_MCP_SERVER=/home/mmca/mcp-servers/agentic-mcp/agentic-mcp-server.mjs`
- `ENGRAM_WORKER_URL=http://localhost:37779`
- `AXON_ENGRAM_MCP_NAMES=engram,agentic-mcp`

Override any of those in the shell if the deployment moves.

## Run

Smoke the provider/bootstrap wiring first:

```bash
cd /home/mmca/projects/axon
scripts/smoke-vector-qwen.sh
```

That smoke now verifies both:

- direct Qwen health/models/chat reachability
- a real Axon `bash` tool round-trip against the patched local profile

If `ENGRAM_API_KEY` is unset, the smoke uses a dummy value and only proves the local Axon/Qwen path. Authenticated Engram tool use still needs the real key.

Launch the vendored OpenCode runtime with the Axon profile:

```bash
cd /home/mmca/projects/axon
ENGRAM_API_KEY=... scripts/run-vector-qwen.sh
```

The launcher injects the profile through `OPENCODE_CONFIG_CONTENT`, so the repo-level config can stay neutral while the deployment profile stays concrete.

## Local Qwen Notes

The local Qwen profile intentionally does not expose the entire OpenCode tool catalog by default.

- `chat_template_kwargs.enable_thinking=false` is injected for this provider because llama.cpp tool-calling is more reliable that way.
- heavy built-in tools such as `task`, `skill`, `webfetch`, `websearch`, and `codesearch` are disabled in this profile
- Engram stays connected, but only a core coordination/memory subset is enabled by default for the local model
- the smoke round-trip runs with `--pure` so it validates the local Axon/Qwen tool path without depending on plugin-injected system context

This is a deployment constraint, not an Axon architecture rule. Other profiles can widen the tool surface later.
