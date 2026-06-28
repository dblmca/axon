# Upstream Notes

`opencode` was vendored into this repository from:

- upstream repo: `https://github.com/anomalyco/opencode`
- upstream branch at import: `dev`
- upstream commit at import: `1026791076c6a4edf1d44422177e13d06c2930d6`
- upstream commit at last sync: `ae53163ca` (2026-06-27, 59 commits ahead of previous sync)

## Local patches reapplied after sync

1. **Skip npm install for local/dev builds** (`packages/opencode/src/config/config.ts`) — wraps `@opencode-ai/plugin` npm install in `if (!InstallationLocal)` guard. Prevents hangs when no network or proxy misconfiguration.
2. **MCP tool argument sanitization** (`packages/opencode/src/mcp/catalog.ts`) — `sanitizeToolArgs()` truncates oversized model-generated tool arguments before passing to MCP servers. Prevents blowouts from hallucinated mega-args.
3. **Kimi K2.6 reasoning field fallback** (`packages/core/src/github-copilot/chat/openai-compatible-chat-language-model.ts`) — adds `?? reasoning` fallback alongside Copilot's `reasoning_text`. Also adds `reasoning` to zod response/chunk schemas. File moved from `packages/opencode/src/provider/sdk/copilot/` to `packages/core/src/github-copilot/` in upstream commit `834515231`.
4. **XML tool-call detection warning** (`packages/opencode/src/session/processor.ts`) — warns when model emits `<tool_call>` or `<arg_key>` XML in the text stream instead of using proper tool-calling. Uses `Effect.logWarning` (updated from old `log.warn` API).

The outer `axon` repo also keeps an `opencode-upstream` remote so upstream changes can be inspected later without restoring the nested Git repository.

The original nested repository metadata was renamed to `opencode/.git.upstream/` and ignored by the outer repo.

Useful commands:

```bash
git fetch opencode-upstream
git log --oneline --decorate 1026791076c6a4edf1d44422177e13d06c2930d6..opencode-upstream/dev
git diff --stat 1026791076c6a4edf1d44422177e13d06c2930d6 opencode-upstream/dev
```
