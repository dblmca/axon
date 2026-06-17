import { cleanText, json, request } from "./util.js"
import { SOURCE_AI, hostname, projectName, agentName } from "./identity.js"
import { state, taskDescription, resolveSessionID, ensureSession, background, log } from "./lifecycle.js"

export function promptText(parts) {
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

export function toolType(tool, args) {
  const id = String(tool || "")
  const url = String(args?.url || "")
  if (id.startsWith("engram_") || id.includes("__engram__")) return "skip"
  if (["bash", "command", "run_shell_command"].includes(id)) return "command"
  if (["edit", "write", "apply_patch"].includes(id)) return "code_edit"
  if (["fetch", "search", "webfetch", "websearch"].includes(id) || /^https?:\/\//.test(url)) return "web_research"
  return "tool_use"
}

export function toolTitle(tool, args, type) {
  if (type === "command") {
    const command = String(args?.command || args?.cmd || "").trim()
    if (command) return `${tool}: ${command.split(/\s+/)[0]}`
  }
  return `${tool} executed`
}

export function sessionIDFromEvent(event, kind) {
  if (event?.type === kind && typeof event.properties?.sessionID === "string") return event.properties.sessionID
  if (event?.type === "sync" && event.name === `${kind}.1` && typeof event.data?.sessionID === "string") {
    return event.data.sessionID
  }
}

export async function postObservation(runtime, sessionID, body) {
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

export async function postVerify(input, runtime, sessionID) {
  const current = state(sessionID)
  const files = Array.from(current.filesModified)
  if (!files.length) return

  const project = projectName(input)
  const taskDesc = taskDescription(sessionID) || `Session work in ${project}`

  const result = await request(runtime, "/api/search/verify", {
    method: "POST",
    body: {
      project,
      task_description: taskDesc,
      files_changed: files.slice(0, 50),
      agent_name: current.agentName || agentName(input, runtime),
    },
  })

  if (result.ok && result.data && !result.data.clear && Array.isArray(result.data.concerns)) {
    const concerns = result.data.concerns
    await log(input, "WARN", `Post-verification found ${concerns.length} concern(s)`, {
      sessionID,
      concerns: concerns.map((c) => `[${c.severity}] ${c.description}`),
    })
  }
}

export function onToolExecute(input, runtime, rawSessionID, tool, args, output) {
  const type = toolType(tool, args)
  if (type === "skip") return

  const sessionID = resolveSessionID(rawSessionID)
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
        title: toolTitle(tool, args, type),
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
}

export function onTextComplete(input, runtime, rawSessionID, _model, messageID, partID, text, activeModelFn, modelLabelFn) {
  const sessionID = resolveSessionID(rawSessionID)
  const current = state(sessionID)
  const llm = activeModelFn(runtime, current)
  const label = modelLabelFn(runtime, llm)

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
}
