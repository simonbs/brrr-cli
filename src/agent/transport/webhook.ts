import { buildPayload, type SendPayload } from "./payload.js"
import { resolveWebhookRef, type WebhookRef } from "../webhook-ref.js"

export type SendMode = "hook" | "interactive"

export interface SendResult {
  ok: boolean
  error?: string
}

export async function sendWebhook(
  webhookRef: WebhookRef,
  payload: SendPayload,
  mode: SendMode
): Promise<SendResult> {
  try {
    const webhookUrl = resolveWebhookRef(webhookRef)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2_000)

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify(buildPayload(payload)),
        signal: controller.signal
      })

      const body = await parseJson(response)
      if (response.status === 202 && isSuccessResponse(body)) {
        return { ok: true }
      }

      const bodyError = getFailureError(body)
      const error = bodyError ?? `Unexpected response status ${response.status}.`
      return handleFailure(error, mode)
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    return handleFailure(asErrorMessage(error), mode)
  }
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function isSuccessResponse(value: unknown): value is { success: true } {
  return typeof value === "object" && value !== null && "success" in value && (value as { success?: unknown }).success === true
}

function getFailureError(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("error" in value)) return undefined
  const error = (value as { error?: unknown }).error
  return typeof error === "string" ? error : undefined
}

function handleFailure(error: string, mode: SendMode): SendResult {
  if (mode === "hook") {
    return { ok: false, error }
  }
  return { ok: false, error }
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return "Unknown webhook failure."
}
