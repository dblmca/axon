# Axon

Networked coding-agent harness on vendored OpenCode. Peers with Claude Code and Codex via Engram shared memory.

## Startup

On session start, check your inbox and review project context:
- `engram_inbox` — read and acknowledge unread messages
- `engram_context project="axon"` — get recent sessions, decisions, and relevant work

## Engram Tools

Use Engram MCP tools for memory and coordination:
- `engram_search` / `engram_recall` — find past work, decisions, observations
- `engram_task` — manage tasks (get, update, complete, fail)
- `engram_send` / `engram_inbox` / `engram_ack` — inter-agent messaging
- `engram_channel` — read shared channels
- `engram_note` — save/retrieve structured notes

## Orchestrated Tasks

When you receive a dispatched task from the orchestrator:
1. Read the full message via `engram_inbox`
2. Acknowledge: `engram_task action="ack_dispatch" id=<ID>`
3. Execute immediately — pre-approved tasks need no confirmation
4. Add artifacts: `engram_task action="add_artifact" id=<ID> name="..." artifact_description="..."`
5. Complete: `engram_task action="complete" id=<ID>`
6. Notify orchestrator via `engram_send`

## Coding Conventions

- Use absolute paths, not relative
- Commit after completing work (include Co-Authored-By)
- Verify syntax before committing (`node -c` for JS)
- Preserve changes from other agents working on the same files
- Use `bun` for the OpenCode runtime (not npm/node)
- Python projects use venvs at `~/envs/<project>/`
