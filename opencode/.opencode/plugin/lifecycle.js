import { request, errorMessage } from "./util.js"
import { SOURCE_AI, hostname, projectName, agentName, tmuxSession, capabilities, modelRef } from "./identity.js"

const SERVICE = "axon-engram"
const DRAIN_TIMEOUT_MS = 5_000

export const sessionState = new Map()
export const inflight = new Set()
export let shuttingDown = false
let shutdownHandlersInstalled = false

export function state(sessionID) {
  const hit = sessionState.get(sessionID)
  if (hit) return hit
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
  }
  sessionState.set(sessionID, next)
  return next
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

export function daysOld(dateValue) {
  if (!dateValue) return Infinity
  const ts = typeof dateValue === "number" ? dateValue : Date.parse(dateValue)
  if (!Number.isFinite(ts)) return Infinity
  return (Date.now() - ts) / 86_400_000
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
    .catch(() => {})
}

export function background(input, promise, message, extra = {}) {
  if (shuttingDown) return
  const tracked = promise.catch((error) =>
    log(input, "WARN", message, { ...extra, error: errorMessage(error) }),
  )
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
    request(runtime, "/api/agents/register", {
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
    const init = await request(runtime, "/api/sessions/init", {
      method: "POST",
      body: {
        sdk_session_id: effectiveID,
        ai_session_id: effectiveID,
        source_ai: SOURCE_AI,
        project,
        client_hostname: hostname(),
      },
    })
    await syncAgent(input, runtime, sessionID)
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
          }).catch(() => {}),
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
