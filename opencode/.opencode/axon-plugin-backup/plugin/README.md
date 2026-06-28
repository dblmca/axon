# Axon Plugin Directory

OpenCode auto-discovers plugins by globbing `{plugin,plugins}/*.{ts,js}` in `.opencode/`.
Every `.js` file at this level is loaded as a separate plugin.

## Rules

1. **Only plugin entry points go here.** Currently: `axon-engram.js`.
2. **Helper modules go in `lib/`.** The glob is `*.{ts,js}` — it does NOT recurse into subdirectories.
3. **Never add `.js` files here** unless they export `{ id, server() }` as a default export.
   Files without a proper plugin shape will crash at runtime with:
   `TypeError: undefined is not an object (evaluating 'hook[name]')`

## What happened (a832d688a)

The Orca refactor split axon-engram.js into 6 modules (capture.js, context.js, etc.)
and placed them alongside the main plugin file. OpenCode loaded each one as a separate
plugin. Their named function exports were treated as legacy plugin constructors,
producing invalid hooks objects that crashed Plugin.trigger.

Fix: moved helpers to `lib/` subdirectory.

## File layout

```
.opencode/plugin/
  axon-engram.js        ← plugin entry point (has default export with id + server)
  README.md             ← this file
  lib/
    capture.js          ← helper module (imported by axon-engram.js)
    context.js          ← helper module
    identity.js         ← helper module
    lifecycle.js        ← helper module
    util.js             ← helper module
    axon-engram.test.js ← tests (also kept out of glob path)
```
