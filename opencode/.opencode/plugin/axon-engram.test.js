import { describe, it, expect, beforeEach } from "bun:test"

// util.js
import {
  asRecord,
  firstText,
  envText,
  splitList,
  uniqueList,
  parseJsonish,
  boolish,
  numberish,
  errorMessage,
  cleanText,
  json,
} from "./util.js"

// identity.js
import {
  SOURCE_AI,
  slug,
  hostname,
  hostShort,
  modelRef,
  activeModel,
  modelLabel,
  inferredModel,
  agentProfile,
  projectName,
  mcpNames,
} from "./identity.js"

// lifecycle.js
import {
  state,
  noteModel,
  resolveSessionID,
  taskDescription,
  daysOld,
} from "./lifecycle.js"

// capture.js
import {
  promptText,
  toolType,
  toolTitle,
  sessionIDFromEvent,
} from "./capture.js"

// context.js
import { budgetAppend, loadInstructions } from "./context.js"

// --- util tests ---
describe("util: asRecord", () => {
  it("returns plain objects", () => expect(asRecord({ a: 1 })).toEqual({ a: 1 }))
  it("returns undefined for arrays", () => expect(asRecord([1, 2])).toBeUndefined())
  it("returns undefined for null", () => expect(asRecord(null)).toBeUndefined())
  it("returns undefined for primitives", () => expect(asRecord("x")).toBeUndefined())
})

describe("util: firstText", () => {
  it("returns first non-empty string", () => expect(firstText("", "  ", "hello", "world")).toBe("hello"))
  it("returns empty string if all empty", () => expect(firstText("", null, undefined)).toBe(""))
})

describe("util: splitList", () => {
  it("splits comma-separated string", () => expect(splitList("a,b, c")).toEqual(["a", "b", "c"]))
  it("handles array input", () => expect(splitList(["a", "b"])).toEqual(["a", "b"]))
  it("returns empty array for falsy", () => expect(splitList(null)).toEqual([]))
})

describe("util: uniqueList", () => {
  it("deduplicates and flattens", () => expect(uniqueList("a,b", ["b", "c"])).toEqual(["a", "b", "c"]))
})

describe("util: parseJsonish", () => {
  it("parses valid JSON", () => expect(parseJsonish('{"a":1}')).toEqual({ a: 1 }))
  it("returns undefined for bad JSON", () => expect(parseJsonish("not json")).toBeUndefined())
  it("returns non-string values as-is", () => expect(parseJsonish(42)).toBe(42))
  it("returns undefined for null/empty", () => expect(parseJsonish(null)).toBeUndefined())
})

describe("util: boolish", () => {
  it("parses truthy strings", () => {
    expect(boolish("true")).toBe(true)
    expect(boolish("1")).toBe(true)
    expect(boolish("yes")).toBe(true)
  })
  it("parses falsy strings", () => {
    expect(boolish("false")).toBe(false)
    expect(boolish("0")).toBe(false)
    expect(boolish("no")).toBe(false)
  })
  it("returns undefined for unknown", () => expect(boolish("maybe")).toBeUndefined())
  it("passes through booleans", () => {
    expect(boolish(true)).toBe(true)
    expect(boolish(false)).toBe(false)
  })
})

describe("util: numberish", () => {
  it("parses integer strings", () => expect(numberish("42")).toBe(42))
  it("returns undefined for non-numeric", () => expect(numberish("abc")).toBeUndefined())
  it("returns undefined for empty", () => expect(numberish("")).toBeUndefined())
})

describe("util: errorMessage", () => {
  it("extracts Error message", () => expect(errorMessage(new Error("oops"))).toBe("oops"))
  it("stringifies non-errors", () => expect(errorMessage(42)).toBe("42"))
})

describe("util: cleanText", () => {
  it("collapses whitespace", () => expect(cleanText("a  b\n  c")).toBe("a b c"))
  it("truncates long text", () => {
    const long = "x".repeat(1300)
    expect(cleanText(long)).toHaveLength(1200)
    expect(cleanText(long).endsWith("...")).toBe(true)
  })
  it("returns empty string for falsy", () => expect(cleanText(null)).toBe(""))
})

describe("util: json", () => {
  it("serializes objects", () => expect(json({ a: 1 })).toBe('{"a":1}'))
  it("truncates at max", () => {
    const big = { x: "y".repeat(5000) }
    const out = json(big, 100)
    expect(out).toHaveLength(100)
    expect(out.endsWith("...")).toBe(true)
  })
})

// --- identity tests ---
describe("identity: slug", () => {
  it("lowercases and removes special chars", () => expect(slug("My_Project!")).toBe("my-project"))
  it("uses fallback for empty", () => expect(slug("")).toBe("project"))
  it("truncates to max", () => expect(slug("a".repeat(50), "x", 10)).toHaveLength(10))
})

describe("identity: modelRef", () => {
  it("returns ref for valid inputs", () =>
    expect(modelRef("openai", "gpt-4")).toEqual({ providerID: "openai", modelID: "gpt-4" }))
  it("returns undefined for empty provider", () => expect(modelRef("", "gpt-4")).toBeUndefined())
  it("returns undefined for empty model", () => expect(modelRef("openai", "")).toBeUndefined())
})

describe("identity: activeModel", () => {
  it("prefers current state model", () => {
    const runtime = { modelProviderID: "a", modelID: "ma" }
    const current = { modelProviderID: "b", modelID: "mb" }
    expect(activeModel(runtime, current)).toEqual({ providerID: "b", modelID: "mb" })
  })
  it("falls back to runtime model", () => {
    const runtime = { modelProviderID: "a", modelID: "ma" }
    expect(activeModel(runtime, { modelProviderID: "", modelID: "" })).toEqual({
      providerID: "a",
      modelID: "ma",
    })
  })
})

describe("identity: modelLabel", () => {
  it("uses override if set", () =>
    expect(modelLabel({ modelLabel: "custom" }, { providerID: "a", modelID: "b" })).toBe("custom"))
  it("builds label from model", () =>
    expect(modelLabel({ modelLabel: "" }, { providerID: "a", modelID: "b" })).toBe("a/b"))
  it("returns empty for null model", () => expect(modelLabel({ modelLabel: "" }, null)).toBe(""))
})

describe("identity: inferredModel", () => {
  it("maps deepseek-v4-pro", () => {
    const r = inferredModel({ modelLabel: "", modelProviderID: "", modelID: "deepseek-v4-pro" }, {})
    expect(r.className).toBe("deepseek-v4-pro")
    expect(r.tier).toBe(3)
  })
  it("maps qwen", () => {
    const r = inferredModel({ modelLabel: "", modelProviderID: "", modelID: "qwen3-235b" }, {})
    expect(r.className).toBe("qwen3")
  })
  it("defaults to axon", () => {
    const r = inferredModel({ modelLabel: "", modelProviderID: "", modelID: "" }, {})
    expect(r.className).toBe("axon")
  })
})

describe("identity: mcpNames", () => {
  it("parses comma string", () => expect(mcpNames({ mcpNames: "a,b,c" })).toEqual(["a", "b", "c"]))
  it("passes through array", () => expect(mcpNames({ mcpNames: ["x", "y"] })).toEqual(["x", "y"]))
})

describe("identity: SOURCE_AI", () => {
  it("is axon", () => expect(SOURCE_AI).toBe("axon"))
})

// --- lifecycle tests ---
describe("lifecycle: state", () => {
  it("creates and caches session state", () => {
    const s1 = state("test-sess-1")
    const s2 = state("test-sess-1")
    expect(s1).toBe(s2)
    expect(s1.initialized).toBe(false)
    expect(s1.promptNumber).toBe(0)
  })

  it("creates independent state per session", () => {
    const a = state("sess-a")
    const b = state("sess-b")
    a.promptNumber = 5
    expect(b.promptNumber).toBe(0)
  })
})

describe("lifecycle: noteModel", () => {
  it("returns true on model change", () => {
    const sid = "nm-sess-1"
    expect(noteModel(sid, { providerID: "p", modelID: "m" })).toBe(true)
  })
  it("returns false on same model", () => {
    const sid = "nm-sess-2"
    noteModel(sid, { providerID: "p", modelID: "m" })
    expect(noteModel(sid, { providerID: "p", modelID: "m" })).toBe(false)
  })
  it("returns false for invalid model", () => {
    expect(noteModel("nm-sess-3", null)).toBe(false)
  })
})

describe("lifecycle: resolveSessionID", () => {
  it("returns env override if set", () => {
    process.env.AXON_SESSION_ID = "override-123"
    expect(resolveSessionID("original")).toBe("override-123")
    delete process.env.AXON_SESSION_ID
  })
  it("returns original if no env override", () => {
    delete process.env.AXON_SESSION_ID
    expect(resolveSessionID("original")).toBe("original")
  })
})

describe("lifecycle: daysOld", () => {
  it("returns Infinity for null", () => expect(daysOld(null)).toBe(Infinity))
  it("returns ~0 for now", () => expect(daysOld(Date.now())).toBeLessThan(0.001))
  it("returns ~1 for yesterday", () => {
    const yesterday = Date.now() - 86_400_000
    expect(daysOld(yesterday)).toBeCloseTo(1, 1)
  })
})

describe("lifecycle: taskDescription", () => {
  it("returns orchestrated task when AXON_TASK_ID is set", () => {
    process.env.AXON_TASK_ID = "99"
    const desc = taskDescription("td-sess-1")
    expect(desc).toBe("Orchestrated task 99")
    delete process.env.AXON_TASK_ID
  })
  it("returns empty when no task", () => {
    delete process.env.AXON_TASK_ID
    expect(taskDescription("td-sess-2")).toBe("")
  })
})

// --- capture tests ---
describe("capture: promptText", () => {
  it("extracts text parts", () => {
    const parts = [{ type: "text", text: "hello" }, { type: "text", text: "world" }]
    expect(promptText(parts)).toBe("hello\nworld")
  })
  it("skips synthetic parts", () => {
    const parts = [{ type: "text", text: "real" }, { type: "text", text: "synth", synthetic: true }]
    expect(promptText(parts)).toBe("real")
  })
  it("includes subtask prompts", () => {
    const parts = [{ type: "subtask", prompt: "do it" }]
    expect(promptText(parts)).toBe("do it")
  })
  it("labels file parts", () => {
    const parts = [{ type: "file", filename: "foo.ts" }]
    expect(promptText(parts)).toBe("[file] foo.ts")
  })
})

describe("capture: toolType", () => {
  it("skips engram tools", () => expect(toolType("engram_inbox", {})).toBe("skip"))
  it("skips __engram__ tools", () => expect(toolType("mcp__engram__inbox", {})).toBe("skip"))
  it("classifies bash as command", () => expect(toolType("bash", {})).toBe("command"))
  it("classifies edit as code_edit", () => expect(toolType("edit", {})).toBe("code_edit"))
  it("classifies fetch as web_research", () => expect(toolType("fetch", {})).toBe("web_research"))
  it("classifies unknown as tool_use", () => expect(toolType("read", {})).toBe("tool_use"))
})

describe("capture: toolTitle", () => {
  it("includes command name for command type", () => {
    expect(toolTitle("bash", { command: "git status" }, "command")).toBe("bash: git")
  })
  it("uses generic title for other types", () => {
    expect(toolTitle("read", {}, "tool_use")).toBe("read executed")
  })
})

describe("capture: sessionIDFromEvent", () => {
  it("extracts from typed event", () => {
    const event = { type: "session.created", properties: { sessionID: "abc" } }
    expect(sessionIDFromEvent(event, "session.created")).toBe("abc")
  })
  it("extracts from sync event", () => {
    const event = { type: "sync", name: "session.deleted.1", data: { sessionID: "xyz" } }
    expect(sessionIDFromEvent(event, "session.deleted")).toBe("xyz")
  })
  it("returns undefined for non-matching event", () => {
    const event = { type: "other", properties: { sessionID: "abc" } }
    expect(sessionIDFromEvent(event, "session.created")).toBeUndefined()
  })
})

// --- context tests ---
describe("context: budgetAppend", () => {
  it("appends items within budget", () => {
    const lines = []
    const remaining = budgetAppend(lines, 500, "Tests", ["item1", "item2"], (i) => `- ${i}`, 3)
    expect(lines).toContain("\n### Tests")
    expect(lines.some((l) => l.includes("item1"))).toBe(true)
    expect(remaining).toBeLessThan(500)
  })
  it("skips section when budget is zero", () => {
    const lines = []
    const remaining = budgetAppend(lines, 0, "Tests", ["item1"], (i) => `- ${i}`)
    expect(lines).toHaveLength(0)
    expect(remaining).toBe(0)
  })
  it("returns unchanged budget for empty items", () => {
    const lines = []
    const remaining = budgetAppend(lines, 500, "Tests", [], (i) => `- ${i}`)
    expect(lines).toHaveLength(0)
    expect(remaining).toBe(500)
  })
  it("respects maxItems limit", () => {
    const lines = []
    budgetAppend(lines, 10_000, "Tests", ["a", "b", "c", "d", "e"], (i) => `- ${i}`, 2)
    const items = lines.filter((l) => l.startsWith("- "))
    expect(items).toHaveLength(2)
  })
})
