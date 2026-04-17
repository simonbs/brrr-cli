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

    return shouldSendCopilotFinishedNotification(input)
      ? buildCopilotFinishedPayload(input.cwd, await extractCopilotFinishedMessage(input))
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
  stopReason?: string
  transcriptPath?: string
  message?: string
  response?: string
  summary?: string
  output?: string
  text?: string
  last_assistant_message?: string
  agent?: {
    message?: string
    response?: string
    summary?: string
    output?: string
    text?: string
  }
  result?: {
    message?: string
    response?: string
    summary?: string
    output?: string
    text?: string
  }
  error?: {
    message?: string
  }
}

async function extractCopilotFinishedMessage(input: CopilotPayload): Promise<string | undefined> {
  return input.last_assistant_message?.trim()
    || input.message?.trim()
    || input.response?.trim()
    || input.summary?.trim()
    || input.output?.trim()
    || input.text?.trim()
    || readObjectStringField(input.agent, "message")
    || readObjectStringField(input.agent, "response")
    || readObjectStringField(input.agent, "summary")
    || readObjectStringField(input.agent, "output")
    || readObjectStringField(input.agent, "text")
    || readObjectStringField(input.result, "message")
    || readObjectStringField(input.result, "response")
    || readObjectStringField(input.result, "summary")
    || readObjectStringField(input.result, "output")
    || readObjectStringField(input.result, "text")
    || await readCopilotTranscriptMessage(input.transcriptPath)
}

function shouldSendCopilotFinishedNotification(input: CopilotPayload): boolean {
  if (input.stopReason !== undefined) {
    return input.stopReason === "end_turn"
  }

  return input.reason === undefined || input.reason === "complete"
}

async function readCopilotTranscriptMessage(transcriptPath: string | undefined): Promise<string | undefined> {
  if (!transcriptPath) return undefined

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const transcript = await readFile(transcriptPath, "utf8")
      const lines = transcript.split("\n").map((line) => line.trim()).filter(Boolean)

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        let event: CopilotTranscriptEvent
        try {
          event = JSON.parse(lines[index]) as CopilotTranscriptEvent
        } catch {
          continue
        }

        if (event.type !== "assistant.message") continue

        const content = event.data?.content?.trim()
        if (content) return content
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`brrr hook transcript read failed: ${message}`)
    }

    if (attempt < 2) {
      await delay(50)
    }
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

function readObjectStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return readStringField(value, key)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

interface CopilotTranscriptEvent {
  type?: string
  data?: {
    content?: string
  }
}
