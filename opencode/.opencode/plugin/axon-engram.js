import { asRecord, request, errorMessage, cleanText, json } from "./lib/util.js"
import {
  SOURCE_AI,
  hostname,
  projectName,
  mcpNames,
  agentName,
  activeModel,
  modelLabel,
  capabilities,
} from "./lib/identity.js"
import {
  sessionState,
  inflight,
  state,
  noteModel,
  resolveSessionID,
  log,
  background,
  drain,
  syncAgent,
  ensureSession,
  finalizeSession,
  installShutdownHandlers,
} from "./lib/lifecycle.js"
import {
  promptText,
  toolType,
  sessionIDFromEvent,
  postVerify,
  onToolExecute,
  onTextComplete,
} from "./lib/capture.js"
import { loadInstructions, contextBlock } from "./lib/context.js"

const DEFAULT_WORKER_URL = "http://localhost:37779"
const DEFAULT_CONTEXT_TTL_MS = 30_000
const DEFAULT_TIMEOUT_MS = 1_500

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
    contextTtlMs: Number(
      input.contextTtlMs ?? process.env.AXON_ENGRAM_CONTEXT_TTL_MS ?? DEFAULT_CONTEXT_TTL_MS,
    ),
    timeoutMs: Number(input.timeoutMs ?? process.env.AXON_ENGRAM_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    captureResponses: (input.captureResponses ?? process.env.AXON_CAPTURE_RESPONSES ?? "true") !== "false",
    mcpNames: mcpNames(input),
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

        background(
          input,
          (async () => {
            await postVerify(input, runtime, deleted).catch(() => {})
            await finalizeSession(input, runtime, deleted)
          })(),
          "failed to finalize Engram session",
          { sessionID: deleted },
        )
        await drain(input)
        sessionState.delete(deleted)
      },

      "chat.message": async ({ sessionID: rawSessionID, model }, output) => {
        if (!runtime.enabled || !runtime.apiKey) return
        if (output.message.role !== "user") return

        const text = promptText(output.parts)
        if (!text) return

        const sessionID = resolveSessionID(rawSessionID)
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
              body: { prompt_number, prompt_text: text },
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

      "tool.execute.after": async ({ tool, sessionID: rawSessionID, args }, output) => {
        if (!runtime.enabled || !runtime.apiKey) return
        onToolExecute(input, runtime, rawSessionID, tool, args, output)
      },

      "experimental.text.complete": async ({ sessionID: rawSessionID, messageID, partID }, output) => {
        output.text = String(output.text || "").replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim()
        if (!runtime.enabled || !runtime.apiKey || !runtime.captureResponses) return
        const text = output.text
        if (!text) return
        onTextComplete(input, runtime, rawSessionID, null, messageID, partID, text, activeModel, modelLabel)
      },

      "shell.env": async ({ sessionID: rawSessionID }, output) => {
        const sessionID = resolveSessionID(rawSessionID)
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

      "experimental.chat.system.transform": async ({ sessionID: rawSessionID, model }, output) => {
        const sessionID = resolveSessionID(rawSessionID)
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

export { capabilities, config, contextBlock, postVerify, projectName, state, toolType }
