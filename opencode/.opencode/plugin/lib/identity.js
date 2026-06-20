import { execSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { firstText, envText, splitList, uniqueList, parseJsonish, boolish, numberish } from "./util.js"

export const SOURCE_AI = "axon"
export const AGENT_SHORT_ID = crypto.randomBytes(2).toString("hex")

const cachedAgentConfig = new Map()

export function hostname() {
  return process.env.CLIENT_HOSTNAME || process.env.HOSTNAME || os.hostname()
}

export function hostShort() {
  const value = hostname()
    .split(".")[0]
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 20)
  if (value) return value
  return crypto.createHash("sha1").update(hostname()).digest("hex").slice(0, 8)
}

export function tmuxSession() {
  const explicit = (process.env.ENGRAM_TMUX_SESSION || "").trim()
  if (explicit) return explicit
  if (!process.env.TMUX) return ""
  try {
    return execSync("tmux display-message -p '#S'", { timeout: 2_000, encoding: "utf8" }).trim()
  } catch {
    return ""
  }
}

export function slug(value, fallback = "project", max = 30) {
  const next = String(value || "")
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max)
  return next || fallback
}

export function projectName(input) {
  return process.env.ENGRAM_PROJECT || input.project?.name || path.basename(input.worktree || input.directory)
}

export function mcpNames(options) {
  const raw = options.mcpNames ?? process.env.AXON_ENGRAM_MCP_NAMES ?? "engram"
  if (Array.isArray(raw)) return raw.map((item) => String(item).trim()).filter(Boolean)
  return String(raw)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function agentName(input, runtime) {
  if (runtime.agentName) return runtime.agentName
  return `${slug(projectName(input))}-${hostShort()}-${AGENT_SHORT_ID}`
}

export function loadAgentConfig(worktree) {
  const key = path.resolve(worktree || ".")
  if (cachedAgentConfig.has(key)) return cachedAgentConfig.get(key)
  for (const rel of [".axon/engram-agent.json", ".opencode/engram-agent.json"]) {
    const full = path.join(key, rel)
    try {
      const parsed = JSON.parse(fs.readFileSync(full, "utf8"))
      if (parsed && typeof parsed === "object") {
        cachedAgentConfig.set(key, parsed)
        return parsed
      }
    } catch (_err) {
      if (_err?.code === "ENOENT") {
        console.debug("axon-engram agent config file not found", { file: full })
      } else {
        console.warn("axon-engram failed to parse agent config", { file: full, error: String(_err) })
      }
    }
  }
  cachedAgentConfig.set(key, null)
  return null
}

export function configCapabilities(agentCfg) {
  const value = agentCfg?.capabilities
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

export function modelRef(providerID, modelID) {
  const provider = String(providerID || "").trim()
  const model = String(modelID || "").trim()
  if (!provider || !model) return
  return { providerID: provider, modelID: model }
}

export function activeModel(runtime, current) {
  return (
    modelRef(current?.modelProviderID, current?.modelID) ||
    modelRef(runtime.modelProviderID, runtime.modelID)
  )
}

export function modelLabel(runtime, model) {
  const override = String(runtime.modelLabel || "").trim()
  if (override) return override
  if (!model) return ""
  return `${model.providerID}/${model.modelID}`
}

export function inferredModel(runtime, current) {
  const llm = activeModel(runtime, current)
  const label = modelLabel(runtime, llm)
  const raw = firstText(
    label,
    runtime.modelID,
    process.env.AXON_OPENROUTER_MODEL,
    process.env.AXON_DEEPSEEK_MODEL,
    process.env.AXON_QWEN_MODEL_ID,
  )
  const lower = raw.toLowerCase()
  if (lower.includes("deepseek-v4-pro")) return { className: "deepseek-v4-pro", tier: 3, cost: 2 }
  if (lower.includes("deepseek-v4-flash")) return { className: "deepseek-v4-flash", tier: 2, cost: 1 }
  if (lower.includes("deepseek")) return { className: "deepseek", tier: 3, cost: 2 }
  if (lower.includes("qwen3") || lower.includes("qwen")) return { className: "qwen3", tier: 2, cost: 1 }
  if (lower.includes("openrouter")) return { className: "openrouter", tier: 3, cost: 3 }
  return { className: "axon", tier: 2, cost: 1 }
}

function withReleaseLimit(limits, releaseAgentExempt) {
  if (!releaseAgentExempt) return limits
  if (Array.isArray(limits) || typeof limits === "string") return uniqueList(limits, "pool_exempt_release_agent")
  if (limits && typeof limits === "object") return { ...limits, release_agent_exempt: true }
  return ["pool_exempt_release_agent"]
}

export function agentProfile(agentCfg, runtime, current) {
  const cfgCaps = configCapabilities(agentCfg)
  const inferred = inferredModel(runtime, current)
  const role = firstText(
    envText("ENGRAM_AGENT_ROLE", "AXON_AGENT_ROLE", "ORCA_AGENT_ROLE"),
    agentCfg?.agent_role,
    agentCfg?.role,
    cfgCaps.agent_role,
    cfgCaps.role,
    "implementation_worker",
  )
  const modelClass = firstText(
    envText("ENGRAM_MODEL_CLASS", "AXON_MODEL_CLASS", "ORCA_MODEL_CLASS"),
    agentCfg?.model_class,
    cfgCaps.model_class,
    inferred.className,
  )
  const modelTier =
    numberish(envText("ENGRAM_MODEL_TIER", "AXON_MODEL_TIER", "ORCA_MODEL_TIER")) ??
    numberish(agentCfg?.model_tier) ??
    numberish(cfgCaps.model_tier) ??
    inferred.tier
  const costTier =
    numberish(envText("ENGRAM_COST_TIER", "AXON_COST_TIER", "ORCA_COST_TIER")) ??
    numberish(agentCfg?.cost_tier) ??
    numberish(cfgCaps.cost_tier) ??
    inferred.cost
  const releaseAgentExempt =
    boolish(envText("ENGRAM_RELEASE_AGENT_EXEMPT", "AXON_RELEASE_AGENT_EXEMPT", "ORCA_RELEASE_AGENT_EXEMPT")) ??
    boolish(agentCfg?.release_agent_exempt) ??
    boolish(cfgCaps.release_agent_exempt) ??
    role === "release_agent"
  const limits =
    parseJsonish(envText("ENGRAM_AGENT_LIMITS", "AXON_AGENT_LIMITS", "ORCA_AGENT_LIMITS")) ??
    agentCfg?.limits ??
    cfgCaps.limits ??
    []
  return {
    role,
    agent_role: role,
    model_class: modelClass,
    model_tier: modelTier,
    cost_tier: costTier,
    capabilities: uniqueList(
      "code_edit",
      "mcp_tools",
      "engram_memory",
      agentCfg?.agent_capabilities,
      Array.isArray(agentCfg?.capabilities) ? agentCfg.capabilities : undefined,
      cfgCaps.capabilities,
      envText("ENGRAM_AGENT_CAPABILITIES", "AXON_AGENT_CAPABILITIES", "ORCA_AGENT_CAPABILITIES"),
    ),
    skills: uniqueList(
      agentCfg?.skills,
      cfgCaps.skills,
      envText("ENGRAM_AGENT_SKILLS", "AXON_AGENT_SKILLS", "ORCA_AGENT_SKILLS"),
    ),
    limits: withReleaseLimit(limits, releaseAgentExempt),
    release_agent_exempt: releaseAgentExempt,
  }
}

export function capabilities(input, runtime, current) {
  const local = []
  const file = path.join(input.worktree, ".mcp.json")
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
      if (parsed?.mcpServers && typeof parsed.mcpServers === "object") {
        local.push(...Object.keys(parsed.mcpServers))
      }
    } catch (_err) {
      console.warn("axon-engram failed to parse mcp.json", { file, error: String(_err) })
    }
  }
  const agentCfg = loadAgentConfig(input.worktree)
  const cfgCaps = configCapabilities(agentCfg)
  const profile = agentProfile(agentCfg, runtime, current)
  const llm = activeModel(runtime, current)
  const label = modelLabel(runtime, llm) || cfgCaps.model || SOURCE_AI
  return {
    source_ai: agentCfg?.source_ai || SOURCE_AI,
    mcp_servers: Array.from(new Set([...runtime.mcpNames, ...local])).slice(0, 30),
    model: label,
    ...profile,
    ...(llm ? { llm: { provider_id: llm.providerID, model_id: llm.modelID } } : {}),
    domains: Array.from(new Set([...(cfgCaps.domains || []), "coding", "interop", "memory"])),
    ...(cfgCaps.tools?.length ? { tools: cfgCaps.tools } : {}),
  }
}
