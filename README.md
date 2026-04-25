# Axon

Axon is a networked coding-agent harness built from a vendored OpenCode base and shaped to interoperate with Engram, Claude Code, and Codex.

Axon should stay model-agnostic. The first deployment target can be a local `qwen3.6`, but provider and model selection should come from runtime configuration rather than repo-level assumptions or hardwired plugin logic.

The current direction is deliberate:

- keep the OpenCode-derived runtime, agent loop, and UI in this repo
- keep Engram as the shared memory and coordination plane on the network
- preserve MCP and server interoperability instead of cloning Engram locally

The current architectural plan lives in [docs/architecture.md](/home/mmca/projects/axon/docs/architecture.md).

The first Axon-specific implementation slice currently lives in [opencode/.opencode/plugin/axon-engram.js](/home/mmca/projects/axon/opencode/.opencode/plugin/axon-engram.js).

The first concrete deployment/bootstrap path lives in [docs/runtime-bootstrap.md](/home/mmca/projects/axon/docs/runtime-bootstrap.md), with the profile at [profiles/axon.vector-qwen-engram.jsonc](/home/mmca/projects/axon/profiles/axon.vector-qwen-engram.jsonc), launcher at [scripts/run-vector-qwen.sh](/home/mmca/projects/axon/scripts/run-vector-qwen.sh), and smoke check at [scripts/smoke-vector-qwen.sh](/home/mmca/projects/axon/scripts/smoke-vector-qwen.sh).
