# Upstream Notes

`opencode` was vendored into this repository from:

- upstream repo: `https://github.com/anomalyco/opencode`
- upstream branch at import: `dev`
- upstream commit at import: `1026791076c6a4edf1d44422177e13d06c2930d6`

The outer `axon` repo also keeps an `opencode-upstream` remote so upstream changes can be inspected later without restoring the nested Git repository.

The original nested repository metadata was renamed to `opencode/.git.upstream/` and ignored by the outer repo.

Useful commands:

```bash
git fetch opencode-upstream
git log --oneline --decorate 1026791076c6a4edf1d44422177e13d06c2930d6..opencode-upstream/dev
git diff --stat 1026791076c6a4edf1d44422177e13d06c2930d6 opencode-upstream/dev
```
