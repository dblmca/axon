import assert from "node:assert/strict"
import { spawn } from "node:child_process"

const child = spawn(process.execPath, ["--input-type=module", "-e", `
  import plugin, { state } from "./opencode/.opencode/plugin/axon-engram.js"
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) })
  const input = {
    project: { name: "axon" },
    worktree: process.cwd(),
    directory: process.cwd(),
    client: { app: { log: async () => ({}) } },
  }
  await plugin.server(input, { apiKey: "test-key", workerUrl: "http://engram.test", timeoutMs: 50 })
  state("signal-session").agentName = "axon-signal-test"
  process.kill(process.pid, "SIGTERM")
  setTimeout(() => {}, 10_000)
`], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
})

const exitCode = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    child.kill("SIGKILL")
    resolve(-1)
  }, 3_000)
  child.on("exit", (code) => {
    clearTimeout(timer)
    resolve(code)
  })
})

assert.equal(exitCode, 0)
console.log("signal_shutdown=ok")
