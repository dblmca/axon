import assert from "node:assert/strict"
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
assert.ok(caps.mcp_servers.includes("engram"))

console.log("plugin_unit=ok")
