import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { capabilities, config, projectName, state, toolType } from "../opencode/.opencode/plugin/axon-engram.js"

const calls = []
global.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init })
  return {
    ok: true,
    status: 200,
    async json() {
      if (String(url).includes("/api/search/context")) return { recent_decisions: [], relevant_observations: [] }
      if (String(url).includes("/api/agents/messages/inbox")) return { messages: [] }
      if (String(url).includes("/api/tasks")) return { tasks: [] }
      if (String(url).includes("/api/instincts")) return { instincts: [] }
      return {}
    },
  }
}

const runtime = config({
  apiKey: "test-key",
  workerUrl: "http://engram.test",
  mcpNames: ["engram"],
  modelProviderID: "vector-qwen",
  modelID: "qwen-test",
})

assert.equal(runtime.enabled, true)
assert.equal(runtime.apiKey, "test-key")
assert.deepEqual(runtime.mcpNames, ["engram"])

const input = {
  project: { name: "axon" },
  worktree: path.resolve("."),
  directory: path.resolve("."),
  client: { app: { log: async () => ({}) } },
}

assert.equal(projectName(input), "axon")
assert.equal(toolType("engram_search", {}), "skip")
assert.equal(toolType("bash", { command: "ls" }), "command")
assert.equal(toolType("apply_patch", { file_path: "bin/axon" }), "code_edit")
assert.equal(toolType("webfetch", { url: "https://example.test" }), "web_research")

const current = state("plugin-unit-session")
current.modelProviderID = "vector-qwen"
current.modelID = "qwen-test"
const caps = capabilities(input, runtime, current)
assert.equal(caps.source_ai, "axon")
assert.equal(caps.llm.provider_id, "vector-qwen")
assert.equal(caps.llm.model_id, "qwen-test")
assert.equal(caps.role, "implementation_worker")
assert.equal(caps.agent_role, "implementation_worker")
assert.equal(caps.model_class, "qwen3")
assert.equal(caps.model_tier, 2)
assert.equal(caps.cost_tier, 1)
assert.equal(caps.release_agent_exempt, false)
assert.ok(caps.capabilities.includes("code_edit"))
assert.ok(caps.capabilities.includes("engram_memory"))
assert.ok(caps.mcp_servers.includes("engram"))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axon-plugin-unit-"))
fs.mkdirSync(path.join(tmp, ".axon"))
fs.writeFileSync(path.join(tmp, ".axon", "engram-agent.json"), JSON.stringify({
  role: "release_agent",
  model_class: "deepseek-v4-pro",
  model_tier: 5,
  cost_tier: 4,
  agent_capabilities: ["release_gate", "repo_publish"],
  skills: ["release"],
  limits: ["no_unreviewed_release"],
  capabilities: {
    domains: ["release"],
    tools: ["git", "gh"],
  },
}))

const fileCaps = capabilities({ ...input, worktree: tmp, directory: tmp }, runtime, current)
assert.equal(fileCaps.role, "release_agent")
assert.equal(fileCaps.model_class, "deepseek-v4-pro")
assert.equal(fileCaps.model_tier, 5)
assert.equal(fileCaps.cost_tier, 4)
assert.equal(fileCaps.release_agent_exempt, true)
assert.ok(fileCaps.capabilities.includes("release_gate"))
assert.ok(fileCaps.skills.includes("release"))
assert.ok(fileCaps.limits.includes("pool_exempt_release_agent"))
assert.ok(fileCaps.domains.includes("release"))
assert.deepEqual(fileCaps.tools, ["git", "gh"])

process.env.AXON_AGENT_ROLE = "research_worker"
process.env.AXON_AGENT_CAPABILITIES = "web_research,datasheet_analysis"
const envCaps = capabilities(input, runtime, current)
assert.equal(envCaps.role, "research_worker")
assert.ok(envCaps.capabilities.includes("datasheet_analysis"))
delete process.env.AXON_AGENT_ROLE
delete process.env.AXON_AGENT_CAPABILITIES

console.log("plugin_unit=ok")
