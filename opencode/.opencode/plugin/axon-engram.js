import { execSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const SERVICE = "axon-engram"
const SOURCE_AI = "axon"
const DEFAULT_WORKER_URL = "http://localhost:37779"
const DEFAULT_CONTEXT_TTL_MS = 30_000
const DEFAULT_TIMEOUT_MS = 1_500
const DRAIN_TIMEOUT_MS = 5_000
const CONTEXT_CHAR_BUDGET = 8_000
const DECISION_MAX_AGE_DAYS = 7
const OBSERVATION_MAX_AGE_DAYS = 3
const AGENT_SHORT_ID = crypto.randomBytes(2).toString("hex")

const sessionState = new Map()
const inflight = new Set()
let shuttingDown = false
let shutdownHandlersInstalled = false

function hostname() {
  return process.env.CLIENT_HOSTNAME || process.env.HOSTNAME || os.hostname()
}

function hostShort() {
  const value = hostname()
    .split(".")[0]
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 20)
  if (value) return value
  return crypto.createHash("sha1").update(hostname()).digest("hex").slice(0, 8)
}

function tmuxSession() {
  const explicit = (process.env.ENGRAM_TMUX_SESSION || "").trim()
  if (explicit) return explicit
  if (!process.env.TMUX) return ""
  try {
    return execSync("tmux display-message -p '#S'", { timeout: 2_000, encoding: "utf8" }).trim()
  } catch {
    return ""
  }
}

function slug(value, fallback = "project", max = 30) {
  const next = String(value || "")
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max)
  return next || fallback
}

function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value
}

function projectName(input) {
  return process.env.ENGRAM_PROJECT || input.project.name || path.basename(input.worktree || input.directory)
}

function mcpNames(options) {
  const raw = options.mcpNames ?? process.env.AXON_ENGRAM_MCP_NAMES ?? "engram"
  if (Array.isArray(raw)) return raw.map((item) => String(item).trim()).filter(Boolean)
  return String(raw)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function config(options) {
  const input = asRecord(options) ?? {}
  return {
    enabled: input.enabled !== false && process.env.AXON_ENGRAM_DISABLED !== "1",
    apiKey: String(input.apiKey ?? process.env.ENGRAM_API_KEY ?? "").trim(),
    workerUrl: String(input.workerUrl ?? process.env.ENGRAM_WORKER_URL ?? DEFAULT_WORKER_URL).trim(),
    agentName: String(input.agentName ?? process.env.ENGRAM_AGENT_NAME ?? "").trim(),
    modelProviderID: String(input.modelProviderID ?? process.env.AXON_ENGRAM_MODEL_PROVIDER ?? "").trim(),
    modelID: String(input.modelID ?? process.env.AXON_ENGRAM_MODEL_ID ?? "").trim(),
    modelLabel: String(input.modelLabel ?? process.env.AXON_ENGRAM_MODEL_LABEL ?? "").trim(),
    contextTtlMs: Number(input.contextTtlMs ?? process.env.AXON_ENGRAM_CONTEXT_TTL_MS ?? DEFAULT_CONTEXT_TTL_MS),
    timeoutMs: Number(input.timeoutMs ?? process.env.AXON_ENGRAM_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    captureResponses: (input.captureResponses ?? process.env.AXON_CAPTURE_RESPONSES ?? "true") !== "false",
    mcpNames: mcpNames(input),
  }
}

function state(sessionID) {
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

function modelRef(providerID, modelID) {
  const provider = String(providerID || "").trim()
  const model = String(modelID || "").trim()
  if (!provider || !model) return
  return {
    providerID: provider,
    modelID: model,
  }
}

function activeModel(runtime, current) {
  return (
    modelRef(current?.modelProviderID, current?.modelID) ||
    modelRef(runtime.modelProviderID, runtime.modelID)
  )
}

function modelLabel(runtime, model) {
  const override = String(runtime.modelLabel || "").trim()
  if (override) return override
  if (!model) return ""
  return `${model.providerID}/${model.modelID}`
}

function noteModel(sessionID, model) {
  const next = modelRef(model?.providerID, model?.modelID)
  if (!next) return false

  const current = state(sessionID)
  if (current.modelProviderID === next.providerID && current.modelID === next.modelID) return false
  current.modelProviderID = next.providerID
  current.modelID = next.modelID
  return true
}

function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

function cleanText(value, max = 1_200) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}

function json(value, max = 4_000) {
  let text = ""
  try {
    text = JSON.stringify(value)
  } catch {
    text = JSON.stringify(String(value))
  }
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}

function promptText(parts) {
  return parts
    .flatMap((part) => {
      if (!part || typeof part !== "object") return []
      if (part.type === "text" && typeof part.text === "string" && !part.synthetic) return [part.text]
      if (part.type === "subtask" && typeof part.prompt === "string") return [part.prompt]
      if (part.type === "file" && typeof part.filename === "string") return [`[file] ${part.filename}`]
      return []
    })
    .join("\n")
    .trim()
}

function toolType(tool, args) {
  const id = String(tool || "")
  const url = String(args?.url || "")
  if (id.startsWith("engram_") || id.includes("__engram__")) return "skip"
  if (["bash", "command", "run_shell_command"].includes(id)) return "command"
  if (["edit", "write", "apply_patch"].includes(id)) return "code_edit"
  if (["fetch", "search", "webfetch", "websearch"].includes(id) || /^https?:\/\//.test(url)) return "web_research"
  return "tool_use"
}

function title(tool, args, type) {
  if (type === "command") {
    const command = String(args?.command || args?.cmd || "").trim()
    if (command) return `${tool}: ${command.split(/\s+/)[0]}`
  }
  return `${tool} executed`
}

let cachedAgentConfig

function loadAgentConfig(worktree) {
  if (cachedAgentConfig !== undefined) return cachedAgentConfig
  for (const rel of [".axon/engram-agent.json", ".opencode/engram-agent.json"]) {
    const full = path.join(worktree, rel)
    try {
      const parsed = JSON.parse(fs.readFileSync(full, "utf8"))
      if (parsed && typeof parsed === "object") {
        cachedAgentConfig = parsed
        return cachedAgentConfig
      }
    } catch {}
  }
  cachedAgentConfig = null
  return null
}

function capabilities(input, runtime, current) {
  const local = []
  const file = path.join(input.worktree, ".mcp.json")
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
      if (parsed?.mcpServers && typeof parsed.mcpServers === "object") {
        local.push(...Object.keys(parsed.mcpServers))
      }
    } catch {}
  }
  const agentCfg = loadAgentConfig(input.worktree)
  const cfgCaps = agentCfg?.capabilities || {}
  const llm = activeModel(runtime, current)
  const label = modelLabel(runtime, llm) || cfgCaps.model || SOURCE_AI
  return {
    source_ai: agentCfg?.source_ai || SOURCE_AI,
    mcp_servers: Array.from(new Set([...runtime.mcpNames, ...local])).slice(0, 30),
    model: label,
    ...(llm
      ? {
          llm: {
            provider_id: llm.providerID,
            model_id: llm.modelID,
          },
        }
      : {}),
    domains: Array.from(new Set([...(cfgCaps.domains || []), "coding", "interop", "memory"])),
    ...(cfgCaps.tools?.length ? { tools: cfgCaps.tools } : {}),
  }
}

let cachedInstructions

function loadInstructions(worktree) {
  if (cachedInstructions !== undefined) return cachedInstructions
  for (const rel of [".axon/instructions.md", ".opencode/instructions.md"]) {
    const full = path.join(worktree, rel)
    try {
      const text = fs.readFileSync(full, "utf8").trim()
      if (text) {
        cachedInstructions = `<axon-instructions>\n${text}\n</axon-instructions>`
        return cachedInstructions
      }
    } catch {}
  }
  cachedInstructions = ""
  return cachedInstructions
}

function agentName(input, runtime) {
  if (runtime.agentName) return runtime.agentName
  return `${slug(projectName(input))}-${hostShort()}-${AGENT_SHORT_ID}`
}

function log(input, level, message, extra = {}) {
  return input.client.app
    .log({
      body: {
        service: SERVICE,
        level,
        message,
        extra,
      },
    })
    .catch(() => {})
}

function background(input, promise, message, extra = {}) {
  if (shuttingDown) return
  const tracked = promise.catch((error) => log(input, "WARN", message, { ...extra, error: errorMessage(error) }))
  inflight.add(tracked)
  tracked.finally(() => inflight.delete(tracked))
}

async function drain(input) {
  if (inflight.size === 0) return
  const pending = Array.from(inflight)
  const timeout = new Promise((resolve) => setTimeout(resolve, DRAIN_TIMEOUT_MS))
  const result = await Promise.race([
    Promise.allSettled(pending),
    timeout.then(() => "timeout"),
  ])
  if (result === "timeout") {
    await log(input, "WARN", `drain timed out with ${inflight.size} request(s) still pending`)
  }
}

async function request(runtime, endpoint, init = {}) {
  if (!runtime.enabled || !runtime.apiKey) return { ok: false, status: 0 }
  const url = new URL(endpoint, runtime.workerUrl)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), runtime.timeoutMs)
  try {
    const response = await fetch(url, {
      method: init.method || "GET",
      headers: {
        "content-type": "application/json",
        "x-api-key": runtime.apiKey,
        ...(init.headers || {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    })
    let data
    try {
      data = await response.json()
    } catch {}
    return { ok: response.ok, status: response.status, data }
  } finally {
    clearTimeout(timeout)
  }
}

function installShutdownHandlers(input, runtime) {
  if (shutdownHandlersInstalled) return
  shutdownHandlersInstalled = true

  const handleShutdown = (signal) => {
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
            body: {
              name: current.agentName,
              session_id: sessionID,
            },
          }).catch(() => {}),
        )
      }
      await Promise.allSettled(deregistrations)
      clearTimeout(timeout)
      process.exit(0)
    })().catch(() => process.exit(1))
  }

  process.on("SIGTERM", () => handleShutdown("SIGTERM"))
  process.on("SIGINT", () => handleShutdown("SIGINT"))
}

async function postObservation(runtime, sessionID, body) {
  const raw = await request(runtime, `/api/sessions/${sessionID}/observations/raw`, {
    method: "POST",
    body,
  })
  if (raw.ok || raw.status !== 404) return raw
  return request(runtime, `/api/sessions/${sessionID}/observations`, {
    method: "POST",
    body,
  })
}

async function syncAgent(input, runtime, sessionID) {
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

async function ensureSession(input, runtime, sessionID) {
  const current = state(sessionID)
  if (current.initialized) return current
  if (current.initializing) return current.initializing

  current.agentName = current.agentName || agentName(input, runtime)
  current.initializing = (async () => {
    const project = projectName(input)
    const init = await request(runtime, "/api/sessions/init", {
      method: "POST",
      body: {
        sdk_session_id: sessionID,
        ai_session_id: sessionID,
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

function daysOld(dateValue) {
  if (!dateValue) return Infinity
  const ts = typeof dateValue === "number" ? dateValue : Date.parse(dateValue)
  if (!Number.isFinite(ts)) return Infinity
  return (Date.now() - ts) / 86_400_000
}

function budgetAppend(lines, budget, section, items, render, maxItems = 3) {
  if (!Array.isArray(items) || items.length === 0) return budget
  const header = `\n### ${section}`
  let remaining = budget - header.length
  if (remaining <= 0) return 0
  const rendered = []
  for (const item of items.slice(0, maxItems)) {
    const line = render(item)
    if (!line) continue
    const cost = line.length + 1
    if (remaining - cost < 0) break
    remaining -= cost
    rendered.push(line)
  }
  if (rendered.length === 0) return budget
  lines.push(header, ...rendered)
  return remaining
}

async function contextBlock(input, runtime, sessionID) {
  const current = state(sessionID)
  if (current.context && current.contextExpiresAt > Date.now()) return current.context

  await ensureSession(input, runtime, sessionID)

  const project = projectName(input)
  const agent = current.agentName || agentName(input, runtime)
  const [ctx, inbox, instincts, tasks] = await Promise.all([
    request(runtime, "/api/search/context", {
      method: "POST",
      body: {
        project,
        query: project,
        session_limit: 4,
        observation_limit: 6,
      },
    }),
    request(runtime, `/api/agents/messages/inbox?name=${encodeURIComponent(agent)}&unread_only=true&limit=5`),
    request(
      runtime,
      `/api/instincts?project=${encodeURIComponent(project)}&min_confidence=0.7&limit=3`,
    ).catch(() => ({ ok: false, status: 0 })),
    request(
      runtime,
      `/api/tasks?project=${encodeURIComponent(project)}&assigned_to=${encodeURIComponent(agent)}`,
    ).catch(() => ({ ok: false, status: 0 })),
  ])

  const data = ctx.data || {}
  const unread = Array.isArray(inbox.data?.messages) ? inbox.data.messages : []
  const learned = Array.isArray(instincts.data?.instincts) ? instincts.data.instincts : []
  const allTasks = Array.isArray(tasks.data?.tasks) ? tasks.data.tasks : (Array.isArray(tasks.data) ? tasks.data : [])
  const pendingTasks = allTasks.filter((t) => t.status !== "done" && t.status !== "cancelled")

  const freshDecisions = (Array.isArray(data.recent_decisions) ? data.recent_decisions : [])
    .filter((d) => daysOld(d.created_at || d.date) < DECISION_MAX_AGE_DAYS)
  const freshObservations = (Array.isArray(data.relevant_observations) ? data.relevant_observations : [])
    .filter((o) => daysOld(o.created_at || o.date) < OBSERVATION_MAX_AGE_DAYS)

  const statusParts = [`inbox: ${unread.length} unread`, `tasks: ${pendingTasks.length} pending`]
  const lines = [
    "<axon-engram>",
    `Agent: ${agent} | Project: ${project} | Runtime: Axon+Engram`,
    statusParts.join(" | "),
    `MCP tools: ${runtime.mcpNames.join(", ")}`,
  ]

  let remaining = CONTEXT_CHAR_BUDGET - lines.join("\n").length

  remaining = budgetAppend(lines, remaining, "Inbox (act on these)", unread, (item) =>
    `- ${cleanText(item.sender, 60)}: ${cleanText(item.content, 200)}`, 5)

  remaining = budgetAppend(lines, remaining, "Recent Decisions", freshDecisions, (item) => {
    const why = cleanText(item.rationale, 100)
    return `- ${cleanText(item.chosen, 140)}${why ? ` — ${why}` : ""}`
  }, 3)

  remaining = budgetAppend(lines, remaining, "Sessions", data.recent_sessions, (item) => {
    const summary = cleanText(item.request || item.completed || item.note || "", 140)
    return `- ${cleanText(item.status || "recent", 16)} | ${cleanText(item.date || "", 10)} | ${summary}`
  }, 3)

  remaining = budgetAppend(lines, remaining, "Related Work", freshObservations, (item) => {
    const relevance = Number.isFinite(item.relevance) ? ` (${item.relevance}%)` : ""
    return `- ${cleanText(item.title, 140)}${relevance}`
  }, 4)

  budgetAppend(lines, remaining, "Learned Patterns", learned, (item) => {
    const trigger = cleanText(item.trigger_pattern, 70)
    const action = cleanText(item.action, 100)
    return `- ${trigger || "pattern"}${action ? ` -> ${action}` : ""}`
  }, 3)

  lines.push(
    "",
    "### Engram MCP Tools (call these as tools, NOT via bash)",
    "These are MCP tools in your tool list. Call them directly like you call bash, read, or edit.",
    "- engram_inbox: no args needed — returns unread messages",
    "- engram_search: args {\"query\": \"topic\"} — search Engram memory",
    "- engram_task: args {\"action\": \"complete\", \"id\": 42} — complete a task",
    "- engram_send: args {\"to\": \"agent-name\", \"message\": \"text\"} — message an agent",
    "- engram_note: args {\"action\": \"save\", \"project\": \"" + project + "\", \"title\": \"T\", \"content\": \"body\"} — save a note",
    "- engram_channel: args {\"action\": \"post\", \"channel\": \"#engram\", \"message\": \"text\"} — post to channel",
  )

  lines.push("</axon-engram>")

  current.context = lines.join("\n")
  current.contextExpiresAt = Date.now() + Math.max(5_000, runtime.contextTtlMs || DEFAULT_CONTEXT_TTL_MS)
  return current.context
}

function sessionIDFromEvent(event, kind) {
  if (event?.type === kind && typeof event.properties?.sessionID === "string") return event.properties.sessionID
  if (event?.type === "sync" && event.name === `${kind}.1` && typeof event.data?.sessionID === "string") {
    return event.data.sessionID
  }
}

export default {
  id: "axon.engram",
  server: async (input, options) => {
    const runtime = config(options)
    installShutdownHandlers(input, runtime)

    process.on("beforeExit", () => {
      if (inflight.size > 0) drain(input)
    })

    return {
      event: async ({ event }) => {
        if (!runtime.enabled || !runtime.apiKey) return

        const created = sessionIDFromEvent(event, "session.created")
        if (created) {
          background(input, ensureSession(input, runtime, created), "failed to initialize Engram session", {
            sessionID: created,
          })
          return
        }

        const deleted = sessionIDFromEvent(event, "session.deleted")
        if (!deleted) return

        const current = state(deleted)
        const tools = Array.from(current.toolsUsed)
        const files = Array.from(current.filesModified)
        const prompts = current.promptNumber
        const parts = [`${prompts} prompt${prompts !== 1 ? "s" : ""}`]
        if (tools.length) parts.push(`tools: ${tools.join(", ")}`)
        if (files.length) parts.push(`files: ${files.join(", ")}`)
        const summary = `Session summary: ${parts.join("; ")}`

        background(
          input,
          Promise.allSettled([
            request(runtime, `/api/sessions/${deleted}/summarize`, {
              method: "POST",
              body: {
                summary,
                metadata: { prompts, tools, files },
              },
            }),
            request(runtime, `/api/sessions/${deleted}/complete`, { method: "POST", body: {} }),
            current.agentName
              ? request(runtime, "/api/agents/deregister", {
                  method: "POST",
                  body: {
                    name: current.agentName,
                    session_id: deleted,
                  },
                })
              : Promise.resolve({ ok: false, status: 0 }),
          ]),
          "failed to finalize Engram session",
          { sessionID: deleted },
        )
        await drain(input)
        sessionState.delete(deleted)
      },

      "chat.message": async ({ sessionID, model }, output) => {
        if (!runtime.enabled || !runtime.apiKey) return
        if (output.message.role !== "user") return

        const text = promptText(output.parts)
        if (!text) return

        const current = state(sessionID)
        const changedModel = noteModel(sessionID, model)
        const prompt_number = current.promptNumber + 1
        current.promptNumber = prompt_number

        background(
          input,
          (async () => {
            await ensureSession(input, runtime, sessionID)
            if (changedModel) await syncAgent(input, runtime, sessionID)
            await request(runtime, `/api/sessions/${sessionID}/prompts`, {
              method: "POST",
              body: {
                prompt_number,
                prompt_text: text,
              },
            })
            if (!changedModel) {
              await request(runtime, "/api/agents/heartbeat", {
                method: "POST",
                body: {
                  name: current.agentName || agentName(input, runtime),
                  project: projectName(input),
                },
              })
            }
          })(),
          "failed to record Engram prompt",
          { sessionID, prompt_number },
        )
      },

      "tool.execute.after": async ({ tool, sessionID, args }, output) => {
        if (!runtime.enabled || !runtime.apiKey) return

        const type = toolType(tool, args)
        if (type === "skip") return

        const current = state(sessionID)
        current.toolsUsed.add(String(tool))
        if (type === "code_edit") {
          const file = String(args?.file_path || args?.path || args?.file || "").trim()
          if (file) current.filesModified.add(file)
        }

        background(
          input,
          (async () => {
            await ensureSession(input, runtime, sessionID)
            await postObservation(runtime, sessionID, {
              project: projectName(input),
              type,
              title: title(tool, args, type),
              subtitle: `Axon ${tool}`,
              facts: [],
              narrative: cleanText(output.output, 500),
              concepts: [String(tool)],
              prompt_number: state(sessionID).promptNumber,
              processing_tier: 1,
              tier_reason: "axon_plugin",
              client_hostname: hostname(),
              created_at_epoch: Date.now(),
              raw_input: json(args),
              raw_output_preview: cleanText(output.output, 1_200),
            })
          })(),
          "failed to record Engram observation",
          { sessionID, tool },
        )
      },

      "experimental.text.complete": async ({ sessionID, messageID, partID }, output) => {
        if (!runtime.enabled || !runtime.apiKey || !runtime.captureResponses) return
        const text = String(output.text || "").trim()
        if (!text) return

        const current = state(sessionID)
        const llm = activeModel(runtime, current)
        const label = modelLabel(runtime, llm)

        background(
          input,
          (async () => {
            await ensureSession(input, runtime, sessionID)
            await postObservation(runtime, sessionID, {
              project: projectName(input),
              type: "assistant_response",
              title: `assistant response${label ? ` (${label})` : ""}`,
              subtitle: `${SOURCE_AI} response`,
              facts: [],
              narrative: cleanText(text, 500),
              concepts: ["assistant_response"],
              prompt_number: current.promptNumber,
              processing_tier: 1,
              tier_reason: "axon_plugin",
              client_hostname: hostname(),
              created_at_epoch: Date.now(),
              raw_input: json({ messageID, partID }),
              raw_output_preview: cleanText(text, 10_000),
            })
          })(),
          "failed to record Engram assistant response",
          { sessionID, messageID },
        )
      },

      "shell.env": async ({ sessionID }, output) => {
        const project = projectName(input)
        output.env.AXON = "1"
        output.env.ENGRAM_PROJECT = project
        output.env.ENGRAM_SOURCE_AI = SOURCE_AI

        if (runtime.workerUrl) output.env.ENGRAM_WORKER_URL = runtime.workerUrl

        const current = sessionID ? state(sessionID) : undefined
        const agent = current?.agentName || agentName(input, runtime)
        const llm = activeModel(runtime, current)
        const llmLabel = modelLabel(runtime, llm)

        if (sessionID) output.env.ENGRAM_SESSION_ID = sessionID
        if (agent) output.env.ENGRAM_AGENT_NAME = agent
        if (llm?.providerID) output.env.AXON_MODEL_PROVIDER = llm.providerID
        if (llm?.modelID) output.env.AXON_MODEL_ID = llm.modelID
        if (llmLabel) output.env.AXON_MODEL_LABEL = llmLabel
      },

      "experimental.chat.system.transform": async ({ sessionID, model }, output) => {
        const instructions = loadInstructions(input.worktree)
        if (instructions) output.system.push(instructions)

        if (!runtime.enabled || !runtime.apiKey || !sessionID) return
        const changedModel = noteModel(sessionID, model)
        if (changedModel) {
          background(
            input,
            (async () => {
              await ensureSession(input, runtime, sessionID)
              await syncAgent(input, runtime, sessionID)
            })(),
            "failed to update Engram agent capabilities",
            { sessionID },
          )
        }
        try {
          output.system.push(await contextBlock(input, runtime, sessionID))
        } catch (error) {
          await log(input, "WARN", "failed to build Engram context block", {
            sessionID,
            error: errorMessage(error),
          })
        }
      },
    }
  },
}

export {
  capabilities,
  config,
  contextBlock,
  projectName,
  state,
  toolType,
}
