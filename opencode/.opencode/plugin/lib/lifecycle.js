import { request, errorMessage } from "./util.js"
import { SOURCE_AI, hostname, projectName, agentName, tmuxSession, capabilities, modelRef } from "./identity.js"

const SERVICE = "axon-engram"
const DRAIN_TIMEOUT_MS = 5_000
const SESSION_TTL_MS = 3_600_000
const MAX_INFLIGHT = 20

const CIRCUIT_THRESHOLD = 5
const CIRCUIT_COOLDOWN_MS = 30_000
const circuit = { failures: 0, lastFailure: 0, open: false }

async function requestWithRetry(runtime, endpoint, init = {}, maxRetries = 3) {
  if (circuit.open) {
    if (Date.now() - circuit.lastFailure > CIRCUIT_COOLDOWN_MS) {
      circuit.open = false
      circuit.failures = 0
    } else {
      return { ok: false, status: 0, _circuit_open: true }
    }
  }

  let lastError
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await request(runtime, endpoint, init)
      if (result.ok) {
        circuit.failures = 0
        return result
      }
      if (result.status === 429) {
        lastError = result
        if (attempt < maxRetries) {
          const retryAfterMs = (() => {
            const header = result.data?.retryAfter ?? result.headers?.get?.("retry-after")
            const secs = header ? Number(header) : NaN
            return isNaN(secs) ? Math.pow(2, attempt) * 200 * (0.5 + Math.random()) : secs * 1_000
          })()
          await new Promise((r) => setTimeout(r, retryAfterMs))
        }
        continue
      }
      if (result.status >= 400 && result.status < 500) {
        return result
      }
      lastError = result
    } catch (err) {
      lastError = { ok: false, status: 0, _error: errorMessage(err) }
    }

    if (attempt < maxRetries) {
      const baseDelay = Math.pow(2, attempt) * 200
      const jitter = baseDelay * (0.5 + Math.random())
      await new Promise((r) => setTimeout(r, jitter))
    }
  }

  circuit.failures++
  circuit.lastFailure = Date.now()
  if (circuit.failures >= CIRCUIT_THRESHOLD) {
    circuit.open = true
    console.warn("axon-engram circuit breaker opened", {
      failures: circuit.failures,
      threshold: CIRCUIT_THRESHOLD,
      endpoint,
    })
  }
  return lastError || { ok: false, status: 0 }
}

export function resetCircuit() {
  circuit.failures = 0
  circuit.lastFailure = 0
  circuit.open = false
}

export const sessionState = new Map()
export const inflight = new Set()
export let shuttingDown = false
let shutdownHandlersInstalled = false

export function state(sessionID) {
  const hit = sessionState.get(sessionID)
  if (hit) { hit._lastAccess = Date.now(); return hit }
  evictStaleSessions()
  const next = {
    agentName: "",
    initialized: false,
    initializing: undefined,
    promptNumber: 0,
    modelProviderID: "",
    modelID: "",
    context: "",
    contextExpiresAt: 0,
    toolsUsed: new Set(),
    filesModified: new Set(),
    _lastAccess: Date.now(),
  }
  sessionState.set(sessionID, next)
  return next
}

function evictStaleSessions() {
  const now = Date.now()
  for (const [id, s] of sessionState) {
    if (now - (s._lastAccess || 0) > SESSION_TTL_MS) sessionState.delete(id)
  }
}

export function noteModel(sessionID, model) {
  const next = modelRef(model?.providerID, model?.modelID)
  if (!next) return false
  const current = state(sessionID)
  if (current.modelProviderID === next.providerID && current.modelID === next.modelID) return false
  current.modelProviderID = next.providerID
  current.modelID = next.modelID
  return true
}

export function resolveSessionID(sessionID) {
  return process.env.AXON_SESSION_ID || sessionID
}

export function taskDescription(sessionID) {
  const taskId = process.env.AXON_TASK_ID || ""
  const current = state(sessionID)
  if (current._taskDescription) return current._taskDescription
  if (taskId) return `Orchestrated task ${taskId}`
  return ""
}

export function log(input, level, message, extra = {}) {
  return input.client.app
    .log({ body: { service: SERVICE, level, message, extra } })
    .catch((_err) => { console.debug("axon-engram log delivery failed", String(_err)) })
}

export function background(input, promise, message, extra = {}) {
  const tracked = promise.catch((error) =>
    log(input, "WARN", message, { ...extra, error: errorMessage(error) }),
  )
  if (shuttingDown || inflight.size >= MAX_INFLIGHT) {
    if (!shuttingDown) {
      log(input, "WARN", "backpressure: dropped request at MAX_INFLIGHT", {
        inflight: inflight.size,
        max: MAX_INFLIGHT,
      })
    }
    return
  }
  inflight.add(tracked)
  tracked.finally(() => inflight.delete(tracked))
}

export async function drain(input) {
  if (inflight.size === 0) return
  const pending = Array.from(inflight)
  const timeout = new Promise((resolve) => setTimeout(resolve, DRAIN_TIMEOUT_MS))
  const result = await Promise.race([Promise.allSettled(pending), timeout.then(() => "timeout")])
  if (result === "timeout") {
    await log(input, "WARN", `drain timed out with ${inflight.size} request(s) still pending`)
  }
}

export async function syncAgent(input, runtime, sessionID) {
  const current = state(sessionID)
  current.agentName = current.agentName || agentName(input, runtime)
  const project = projectName(input)
  const tmux = tmuxSession()
  await Promise.allSettled([
    requestWithRetry(runtime, "/api/agents/register", {
      method: "POST",
      body: {
        name: current.agentName,
        session_id: sessionID,
        hostname: hostname(),
        project,
        source_ai: SOURCE_AI,
        capabilities: JSON.stringify(capabilities(input, runtime, current)),
        ...(tmux ? { tmux_session: tmux } : {}),
      },
    }),
    request(runtime, "/api/agents/heartbeat", {
      method: "POST",
      body: {
        name: current.agentName,
        project,
        ...(tmux ? { tmux_session: tmux } : {}),
      },
    }),
  ])
}

export async function ensureSession(input, runtime, sessionID) {
  const effectiveID = resolveSessionID(sessionID)
  const current = state(effectiveID)
  if (current.initialized) return current
  if (current.initializing) return current.initializing

  current.agentName = current.agentName || agentName(input, runtime)
  current.initializing = (async () => {
    const project = projectName(input)
    const init = await requestWithRetry(runtime, "/api/sessions/init", {
      method: "POST",
      body: {
        sdk_session_id: effectiveID,
        ai_session_id: effectiveID,
        source_ai: SOURCE_AI,
        project,
        client_hostname: hostname(),
      },
    })
    await syncAgent(input, runtime, effectiveID)
    current.initialized = init.ok
    current.initializing = undefined
    if (init.ok) return current
    throw new Error(`session init failed (${init.status || "no-status"})`)
  })()

  return current.initializing
}

export async function finalizeSession(input, runtime, deleted) {
  const current = state(deleted)
  const tools = Array.from(current.toolsUsed)
  const files = Array.from(current.filesModified)
  const prompts = current.promptNumber
  const parts = [`${prompts} prompt${prompts !== 1 ? "s" : ""}`]
  if (tools.length) parts.push(`tools: ${tools.join(", ")}`)
  if (files.length) parts.push(`files: ${files.join(", ")}`)
  const summary = `Session summary: ${parts.join("; ")}`
  await Promise.allSettled([
    request(runtime, `/api/sessions/${deleted}/summarize`, {
      method: "POST",
      body: { summary, metadata: { prompts, tools, files } },
    }),
    request(runtime, `/api/sessions/${deleted}/complete`, { method: "POST", body: {} }),
    current.agentName
      ? request(runtime, "/api/agents/deregister", {
          method: "POST",
          body: { name: current.agentName, session_id: deleted },
        })
      : Promise.resolve({ ok: false, status: 0 }),
  ])
}

export function installShutdownHandlers(input, runtime) {
  if (shutdownHandlersInstalled) return
  shutdownHandlersInstalled = true

  const handleShutdown = () => {
    if (shuttingDown) return
    shuttingDown = true

    const timeout = setTimeout(() => process.exit(1), DRAIN_TIMEOUT_MS + 1_000)
    timeout.unref?.()
    ;(async () => {
      await drain(input)
      const deregistrations = []
      for (const [sessionID, current] of sessionState) {
        if (!current.agentName) continue
        deregistrations.push(
          request(runtime, "/api/agents/deregister", {
            method: "POST",
            body: { name: current.agentName, session_id: sessionID },
          }).catch((_err) => { console.debug("axon-engram shutdown deregister failed", String(_err)) }),
        )
      }
      await Promise.allSettled(deregistrations)
      clearTimeout(timeout)
      process.exit(0)
    })().catch(() => process.exit(1))
  }

  process.on("SIGTERM", handleShutdown)
  process.on("SIGINT", handleShutdown)
}
