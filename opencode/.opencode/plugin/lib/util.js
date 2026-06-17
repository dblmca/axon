export const DEFAULT_WORKER_URL = "http://localhost:37779"
export const DEFAULT_TIMEOUT_MS = 1_500

export function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value
}

export function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim()
    if (text) return text
  }
  return ""
}

export function envText(...names) {
  return firstText(...names.map((name) => process.env[name]))
}

export function splitList(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function uniqueList(...values) {
  return Array.from(new Set(values.flatMap(splitList))).filter(Boolean)
}

export function parseJsonish(value) {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

export function boolish(value) {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value === "boolean") return value
  const text = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(text)) return true
  if (["0", "false", "no", "off"].includes(text)) return false
  return undefined
}

export function numberish(value) {
  const text = String(value ?? "").trim()
  if (!text || !/^\d+$/.test(text)) return undefined
  return Number(text)
}

export function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

export function cleanText(value, max = 1_200) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}

export function json(value, max = 4_000) {
  let text = ""
  try {
    text = JSON.stringify(value)
  } catch {
    text = JSON.stringify(String(value))
  }
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}

export async function request(runtime, endpoint, init = {}) {
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
