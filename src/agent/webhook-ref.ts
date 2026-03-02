export type WebhookRef =
  | { kind: "literal"; value: string }
  | { kind: "env"; name: string; raw: string }

const ENV_REF_PATTERN = /^\$([A-Z0-9_]+)$/
const BRACED_ENV_REF_PATTERN = /^\$\{([A-Z0-9_]+)\}$/
const ALLOWED_HOSTNAMES = new Set(["api.brr.now", "dev.api.brrr.now"])

export function parseWebhookRef(rawValue: string): WebhookRef {
  const raw = rawValue.trim()
  if (!raw) throw new Error("Webhook must not be empty.")

  const envMatch = raw.match(ENV_REF_PATTERN) ?? raw.match(BRACED_ENV_REF_PATTERN)
  if (envMatch) {
    return { kind: "env", name: envMatch[1], raw }
  }

  assertBrrrWebhookUrl(raw, "Webhook must be a brrr webhook URL like https://api.brr.now/v1/br_*.")
  return { kind: "literal", value: raw }
}

export function resolveWebhookRef(ref: WebhookRef, env: NodeJS.ProcessEnv = process.env): string {
  if (ref.kind === "literal") return ref.value

  const value = env[ref.name]?.trim()
  if (!value) {
    throw new Error(`Environment variable ${ref.raw} is not set.`)
  }

  assertBrrrWebhookUrl(
    value,
    `Resolved webhook from ${ref.raw} must be a brrr webhook URL like https://api.brr.now/v1/br_*.`
  )
  return value
}

export function stringifyWebhookRef(ref: WebhookRef): string {
  return ref.kind === "literal" ? ref.value : ref.raw
}

export function assertBrrrWebhookUrl(value: string, errorMessage: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(errorMessage)
  }

  if (url.protocol !== "https:") {
    throw new Error(errorMessage)
  }

  if (!ALLOWED_HOSTNAMES.has(url.hostname)) {
    throw new Error(errorMessage)
  }

  if (!/^\/v1\/br_[A-Za-z0-9_]+$/.test(url.pathname)) {
    throw new Error(errorMessage)
  }
}
