import assert from "node:assert/strict"
import { spawn } from "node:child_process"

import {
  state,
  ensureSession,
  finalizeSession,
  drain,
  installShutdownHandlers,
  inflight,
  sessionState,
  resolveSessionID,
} from "../opencode/.opencode/plugin/lib/lifecycle.js"

let calls = []
function resetCalls() {
  calls = []
}

global.fetch = async (url, init = {}) => {
  const record = { url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined }
  calls.push(record)
  if (String(url).includes("/api/sessions/init")) {
    return { ok: true, status: 200, json: async () => ({ session_id: JSON.parse(init.body).sdk_session_id }) }
  }
  if (String(url).includes("/api/agents/register")) {
    return { ok: true, status: 200, json: async () => ({}) }
  }
  if (String(url).includes("/api/agents/heartbeat")) {
    return { ok: true, status: 200, json: async () => ({}) }
  }
  if (String(url).includes("/summarize")) {
    return { ok: true, status: 200, json: async () => ({}) }
  }
  if (String(url).includes("/complete")) {
    return { ok: true, status: 200, json: async () => ({}) }
  }
  if (String(url).includes("/api/agents/deregister")) {
    return { ok: true, status: 200, json: async () => ({}) }
  }
  return { ok: true, status: 200, json: async () => ({}) }
}

function makeRuntime(overrides = {}) {
  return {
    enabled: true,
    apiKey: "test-key",
    workerUrl: "http://engram.test",
    timeoutMs: 500,
    mcpNames: [],
    ...overrides,
  }
}

function makeInput() {
  return {
    project: { name: "axon-test" },
    worktree: process.cwd(),
    directory: process.cwd(),
    client: { app: { log: async () => ({}) } },
  }
}

function cleanupSessions() {
  sessionState.clear()
  inflight.clear()
}

function saveOrcaEnv() {
  const saved = {}
  for (const key of ["ENGRAM_PROJECT", "AXON_SESSION_ID", "AXON_TASK_ID", "ENGRAM_AGENT_NAME"]) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  return saved
}

function restoreOrcaEnv(saved) {
  for (const key of Object.keys(saved)) {
    if (saved[key] !== undefined) process.env[key] = saved[key]
    else delete process.env[key]
  }
}

// --- ensureSession ---

{
  const saved = saveOrcaEnv()
  const input = makeInput()
  const runtime = makeRuntime()
  const sid = "ensure-session-test-1"

  cleanupSessions()
  resetCalls()

  const result = await ensureSession(input, runtime, sid)
  assert.equal(result.initialized, true)
  assert.equal(result.initializing, undefined)

  const initCalls = calls.filter((c) => c.url.includes("/api/sessions/init"))
  assert.equal(initCalls.length, 1)
  assert.equal(initCalls[0].method, "POST")
  assert.equal(initCalls[0].body.sdk_session_id, sid)

  const registerCalls = calls.filter((c) => c.url.includes("/api/agents/register"))
  assert.equal(registerCalls.length, 1)

  const heartbeatCalls = calls.filter((c) => c.url.includes("/api/agents/heartbeat"))
  assert.equal(heartbeatCalls.length, 1)

  restoreOrcaEnv(saved)
}

// ensureSession caches initialized state
{
  const saved = saveOrcaEnv()
  const input = makeInput()
  const runtime = makeRuntime()
  const sid = "ensure-session-cached-1"

  cleanupSessions()
  resetCalls()

  const first = await ensureSession(input, runtime, sid)
  assert.equal(first.initialized, true)
  const firstCallCount = calls.length

  const second = await ensureSession(input, runtime, sid)
  assert.equal(second.initialized, true)
  assert.equal(calls.length, firstCallCount)

  restoreOrcaEnv(saved)
}

// ensureSession handles init failure
{
  const saved = saveOrcaEnv()
  const originalFetch = global.fetch
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method })
    if (String(url).includes("/api/sessions/init")) {
      return { ok: false, status: 500, json: async () => ({ error: "internal" }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }

  const input = makeInput()
  const runtime = makeRuntime()
  const sid = "ensure-session-fail-1"

  cleanupSessions()
  resetCalls()

  try {
    await ensureSession(input, runtime, sid)
    assert.fail("expected ensureSession to throw on init failure")
  } catch (err) {
    assert.match(err.message, /session init failed/)
  }

  global.fetch = originalFetch
  restoreOrcaEnv(saved)
}

// --- finalizeSession ---
{
  const runtime = makeRuntime()
  const sid = "finalize-session-1"

  cleanupSessions()
  resetCalls()

  const current = state(sid)
  current.agentName = "test-agent"
  current.toolsUsed.add("bash")
  current.toolsUsed.add("edit")
  current.filesModified.add("src/foo.ts")
  current.promptNumber = 3

  await finalizeSession(makeInput(), runtime, sid)

  const summarizeCalls = calls.filter((c) => c.url.includes("/summarize"))
  assert.equal(summarizeCalls.length, 1)
  assert.equal(summarizeCalls[0].method, "POST")
  assert.match(summarizeCalls[0].body.summary, /3 prompts/)
  assert.match(summarizeCalls[0].body.summary, /bash, edit/)
  assert.equal(summarizeCalls[0].body.metadata.prompts, 3)

  const completeCalls = calls.filter((c) => c.url.includes("/complete"))
  assert.equal(completeCalls.length, 1)
  assert.equal(completeCalls[0].method, "POST")

  const deregisterCalls = calls.filter((c) => c.url.includes("/api/agents/deregister"))
  assert.equal(deregisterCalls.length, 1)
  assert.equal(deregisterCalls[0].body.name, "test-agent")
  assert.equal(deregisterCalls[0].body.session_id, sid)
}

// finalizeSession skips deregister when no agent name
{
  const runtime = makeRuntime()
  const sid = "finalize-no-agent-1"

  cleanupSessions()
  resetCalls()

  const current = state(sid)
  current.agentName = ""
  current.promptNumber = 1

  await finalizeSession(makeInput(), runtime, sid)

  const deregisterCalls = calls.filter((c) => c.url.includes("/api/agents/deregister"))
  assert.equal(deregisterCalls.length, 0)
}

// finalizeSession summary for 1 prompt (singular)
{
  const runtime = makeRuntime()
  const sid = "finalize-singular-1"

  cleanupSessions()
  resetCalls()

  const current = state(sid)
  current.agentName = "single-agent"
  current.promptNumber = 1

  await finalizeSession(makeInput(), runtime, sid)

  const summarizeCalls = calls.filter((c) => c.url.includes("/summarize"))
  assert.match(summarizeCalls[0].body.summary, /1 prompt/)
  assert.equal(summarizeCalls[0].body.summary.includes("; tools:"), false)
  assert.equal(summarizeCalls[0].body.summary.includes("; files:"), false)
}

// --- drain ---
// drain completes when inflight is empty
{
  cleanupSessions()
  resetCalls()

  const input = makeInput()
  await drain(input)

  assert.equal(inflight.size, 0)
}

// drain waits for inflight promises
{
  cleanupSessions()
  resetCalls()

  const input = makeInput()
  let resolved = false
  const p = new Promise((resolve) => {
    setTimeout(() => { resolved = true; resolve() }, 10)
  })
  inflight.add(p)
  p.finally(() => inflight.delete(p))

  await drain(input)
  assert.equal(resolved, true)
  assert.equal(inflight.size, 0)
}

// drain times out after DRAIN_TIMEOUT_MS
{
  cleanupSessions()
  resetCalls()

  const input = makeInput()
  const hanging = new Promise(() => {})
  inflight.add(hanging)

  const start = Date.now()
  await drain(input)
  const elapsed = Date.now() - start

  assert.ok(elapsed >= 4950, `drain timeout too fast: ${elapsed}ms`)
  assert.ok(elapsed < 6000, `drain timeout too slow: ${elapsed}ms`)
  assert.equal(inflight.size, 1)

  inflight.delete(hanging)
}

// drain logs warning on timeout
{
  cleanupSessions()
  resetCalls()

  let logMessage = null
  const input = {
    ...makeInput(),
    client: {
      app: {
        log: async ({ body }) => {
          logMessage = body
          return {}
        },
      },
    },
  }

  const hanging = new Promise(() => {})
  inflight.add(hanging)

  await drain(input)
  assert.ok(logMessage !== null)
  assert.equal(logMessage.service, "axon-engram")
  assert.equal(logMessage.level, "WARN")
  assert.match(logMessage.message, /drain timed out/)

  inflight.delete(hanging)
}

// --- shutdown (installShutdownHandlers via child process) ---
{
  cleanupSessions()

  const testScript = `
    import { state, installShutdownHandlers, inflight, sessionState } from "./opencode/.opencode/plugin/lib/lifecycle.js"

    const fetchCalls = []
    global.fetch = async (url, init = {}) => {
      fetchCalls.push({ url: String(url), method: init.method })
      return { ok: true, status: 200, json: async () => ({}) }
    }

    delete process.env.ENGRAM_PROJECT
    delete process.env.AXON_SESSION_ID
    delete process.env.AXON_TASK_ID
    delete process.env.ENGRAM_AGENT_NAME

    const input = {
      project: { name: "axon-shutdown-test" },
      worktree: process.cwd(),
      directory: process.cwd(),
      client: { app: { log: async () => ({}) } },
    }
    const runtime = {
      enabled: true,
      apiKey: "test-key",
      workerUrl: "http://engram.test",
      timeoutMs: 100,
      mcpNames: [],
    }

    state("sd-sess-1").agentName = "sd-agent-1"
    state("sd-sess-2").agentName = "sd-agent-2"
    state("sd-sess-3").agentName = ""

    installShutdownHandlers(input, runtime)

    process.stdout.write(JSON.stringify({ stage: "ready" }) + "\\n")

    process.kill(process.pid, "SIGTERM")

    setTimeout(() => {}, 10_000)
  `

  const child = spawn(process.execPath, ["--input-type=module", "-e", testScript], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  })

  const output = await new Promise((resolve) => {
    const chunks = []
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      resolve(chunks.join(""))
    }, 4000)
    child.stdout.on("data", (data) => { chunks.push(data.toString()) })
    child.on("exit", () => {
      clearTimeout(timer)
      resolve(chunks.join(""))
    })
  })

  const ready = output.split("\n").find((line) => {
    try { return JSON.parse(line).stage === "ready" } catch { return false }
  })
  assert.ok(ready, `child did not emit ready message; output: ${output.slice(0, 200)}`)
}

// shutdown handler double-fire guard
{
  const saved = saveOrcaEnv()
  const runtime = makeRuntime()
  const input = makeInput()

  cleanupSessions()
  resetCalls()

  const originalOn = process.on
  const handlers = {}
  process.on = (event, handler) => {
    handlers[event] = handler
    return process
  }

  state("sd-double-sess").agentName = "sd-double-agent"
  installShutdownHandlers(input, runtime)

  assert.ok(handlers.SIGTERM, "SIGTERM handler not installed")
  assert.ok(handlers.SIGINT, "SIGINT handler not installed")

  process.on = originalOn
  restoreOrcaEnv(saved)
}

// resolveSessionID respects env override
{
  const saved = saveOrcaEnv()
  process.env.AXON_SESSION_ID = "override-123"
  assert.equal(resolveSessionID("original"), "override-123")
  delete process.env.AXON_SESSION_ID
  assert.equal(resolveSessionID("original"), "original")
  restoreOrcaEnv(saved)
}

console.log("lifecycle=ok")
