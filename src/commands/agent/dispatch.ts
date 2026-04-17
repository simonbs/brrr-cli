import { readFile } from "node:fs/promises"
import type { SendPayload } from "../../agent/transport/payload.js"
import { sendWebhook } from "../../agent/transport/webhook.js"
import { parseWebhookRef } from "../../agent/webhook-ref.js"
import { buildClaudeApprovalPayload, buildClaudeFinishedPayload } from "../../agent/config/claude-settings.js"
import { buildCodexFinishedPayload } from "../../agent/config/codex-config.js"
import { buildCopilotErrorPayload, buildCopilotFinishedPayload } from "../../agent/config/copilot-config.js"
import { shouldSkipNotificationForIdleThreshold } from "../../agent/idle.js"

export interface DispatchOptions {
  agent: "claude" | "codex" | "copilot"
  event: "finished" | "needs-approval" | "error"
  webhook: string
  idleSeconds?: number
  payloadJson?: string
}

export async function dispatchCommand(options: DispatchOptions): Promise<void> {
  const webhookRef = parseWebhookRef(options.webhook)
  const payload = await buildDispatchPayload(options)
  if (!payload) {
    return
  }
  if (await shouldSkipNotificationForIdleThreshold(options.idleSeconds)) {
    return
  }
  const result = await sendWebhook(webhookRef, payload, "hook")
  if (!result.ok && result.error) {
    console.error(`brrr hook send failed: ${result.error}`)
  }
}

async function buildDispatchPayload(options: DispatchOptions): Promise<SendPayload | undefined> {
  if (options.agent === "claude") {
    const input = JSON.parse(await readStdin()) as ClaudePayload
    if (options.event === "needs-approval") {
      return buildClaudeApprovalPayload(
        input.cwd,
        input.message ?? extractClaudeNeedsAttentionMessage(input.tool_name, input.tool_input)
      )
    }
    return buildClaudeFinishedPayload(
      input.cwd,
      input.last_assistant_message?.trim() || (input.stop_hook_active ? undefined : input.message)
    )
  }

  if (options.agent === "copilot") {
    const input = JSON.parse(await readStdin()) as CopilotPayload
    if (options.event === "error") {
      return buildCopilotErrorPayload(input.cwd, input.error?.message)
    }

    return input.reason === undefined || input.reason === "complete"
      ? buildCopilotFinishedPayload(input.cwd)
      : undefined
  }

  if (!options.payloadJson) {
    throw new Error("Missing Codex payload JSON.")
  }

  const input = JSON.parse(options.payloadJson) as CodexPayload
  return buildCodexFinishedPayload(input.cwd, input["last-assistant-message"] ?? undefined)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}

interface ClaudePayload {
  cwd?: string
  message?: string
  last_assistant_message?: string
  stop_hook_active?: boolean
  tool_name?: string
  tool_input?: unknown
}

interface CodexPayload {
  cwd?: string
  "last-assistant-message"?: string | null
}

interface CopilotPayload {
  cwd?: string
  reason?: "complete" | "error" | "abort" | "timeout" | "user_exit"
  error?: {
    message?: string
  }
}

function extractClaudeNeedsAttentionMessage(toolName?: string, toolInput?: unknown): string | undefined {
  if (toolName !== "AskUserQuestion") return undefined
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) return undefined

  const question = readStringField(toolInput, "question")
    ?? readStringField(toolInput, "prompt")
    ?? readStringField(toolInput, "message")
    ?? readStringField(toolInput, "text")

  return question ? `Claude is waiting for your input: ${question}` : undefined
}

function readStringField(value: object, key: string): string | undefined {
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : undefined
}
