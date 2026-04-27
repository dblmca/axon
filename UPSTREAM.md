# Upstream Notes

`opencode` was vendored into this repository from:

- upstream repo: `https://github.com/anomalyco/opencode`
- upstream branch at import: `dev`
- upstream commit at import: `1026791076c6a4edf1d44422177e13d06c2930d6`
- upstream commit at last sync: `dfc0075f9` (2026-04-27, 40 commits ahead)

## Local patches reapplied after sync

1. **Qwen system message consolidation** (`llm.ts`) — joins multi-part system messages for non-Anthropic providers. Upstream still sends multiple system messages which breaks llama.cpp Qwen chat templates.
2. **DeepSeek reasoning_content** — upstream now handles this via `interleaved: { field: "reasoning_content" }` in provider config (`738b3065d`), superseding our manual zod patch.

The outer `axon` repo also keeps an `opencode-upstream` remote so upstream changes can be inspected later without restoring the nested Git repository.

The original nested repository metadata was renamed to `opencode/.git.upstream/` and ignored by the outer repo.

Useful commands:

```bash
git fetch opencode-upstream
git log --oneline --decorate 1026791076c6a4edf1d44422177e13d06c2930d6..opencode-upstream/dev
git diff --stat 1026791076c6a4edf1d44422177e13d06c2930d6 opencode-upstream/dev
```
