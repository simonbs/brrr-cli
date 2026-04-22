import { basename, join } from "node:path"
import { homedir } from "node:os"
import { createBackup } from "./backup.js"
import { readTextFileIfExists, writeTextFile } from "../../utils/fs.js"
import type { AgentInstallState, InstallOptions, InstallResult, UninstallResult } from "../adapters/types.js"
import { stringifyWebhookRef } from "../webhook-ref.js"
import { commandExists } from "../../utils/shell.js"

const configPath = join(homedir(), ".codex", "config.toml")
const BLOCK_START = "# brrr agent integration start"
const BLOCK_END = "# brrr agent integration end"

export async function readCodexInstallState(): Promise<AgentInstallState> {
  const [configText, present] = await Promise.all([
    readTextFileIfExists(configPath),
    detectCodexPresence()
  ])

  const block = extractManagedBlock(configText ?? "")
  return {
    agent: "codex",
    present,
    installed: block !== null,
    configPath,
    webhookRef: block ? extractWebhookFromCodexBlock(block) : undefined,
    idleSeconds: block ? extractIdleSecondsFromCodexBlock(block) : undefined,
    supportedEvents: ["finished"]
  }
}

export async function installCodex(options: InstallOptions): Promise<InstallResult> {
  const currentText = (await readTextFileIfExists(configPath)) ?? ""
  const wasInstalled = extractManagedBlock(currentText) !== null
  const currentBlock = extractManagedBlock(currentText)
  const preservedNotify = currentBlock ? extractOriginalNotifyFromCodexBlock(currentBlock) : undefined
  const textWithoutBlock = removeManagedBlock(currentText)
  const existingNotify = extractNotifyAssignment(textWithoutBlock)
  const originalNotify = existingNotify?.args ?? preservedNotify
  const cleanedText = existingNotify ? removeNotifyAssignment(textWithoutBlock, existingNotify) : textWithoutBlock

  const nextBlock = buildCodexManagedBlock(options.webhook, options.idleSeconds, originalNotify)
  const nextText = upsertManagedBlock(cleanedText, nextBlock)
  const backupPath = await maybeCreateBackup(configPath)
  await writeTextFile(configPath, nextText)
  return {
    changed: normalizeText(currentText) !== normalizeText(nextText) || wasInstalled,
    backupPath,
    message: wasInstalled ? "reinstalled" : "installed"
  }
}

export async function uninstallCodex(): Promise<UninstallResult> {
  const currentText = (await readTextFileIfExists(configPath)) ?? ""
  const block = extractManagedBlock(currentText)
  const originalNotify = block ? extractOriginalNotifyFromCodexBlock(block) : undefined
  const textWithoutBlock = removeManagedBlock(currentText)
  const nextText = originalNotify
    ? upsertTopLevelNotify(textWithoutBlock, originalNotify)
    : textWithoutBlock
  if (normalizeText(currentText) === normalizeText(nextText)) {
    return { changed: false, message: "not installed" }
  }

  const backupPath = await maybeCreateBackup(configPath)
  await writeTextFile(configPath, nextText)
  return { changed: true, backupPath, message: "uninstalled" }
}

export function buildCodexManagedBlock(
  webhook: InstallOptions["webhook"],
  idleSeconds?: number,
  originalNotify?: string[]
): string {
  const notifyArgs = [
    "brrr",
    "agent",
    "dispatch",
    "--agent",
    "codex",
    "--event",
    "finished",
    "--webhook",
    stringifyWebhookRef(webhook),
    ...(idleSeconds === undefined ? [] : ["--idle-seconds", String(idleSeconds)]),
    "--payload-json"
  ]

  return [
    BLOCK_START,
    ...(originalNotify ? [`# brrr original notify json: ${JSON.stringify(originalNotify)}`] : []),
    `notify = [${notifyArgs.map(toTomlString).join(", ")}]`,
    BLOCK_END
  ].join("\n")
}

export function getCodexConfigPath(): string {
  return configPath
}

export function extractWebhookFromCodexBlock(block: string): string | undefined {
  const arrayMatch = block.match(/"--webhook",\s*"([^"]*?)"/)
  if (arrayMatch) return arrayMatch[1]

  const escapedMatch = block.match(/--webhook\s+\\"([^"]*?)\\"/)
  if (escapedMatch) return escapedMatch[1]

  const rawMatch = block.match(/--webhook\s+"([^"]*?)"/)
  return rawMatch?.[1]
}

function extractIdleSecondsFromCodexBlock(block: string): number | undefined {
  const arrayMatch = block.match(/"--idle-seconds",\s*"(\d+)"/)
  if (arrayMatch) return Number(arrayMatch[1])

  const rawMatch = block.match(/--idle-seconds\s+"(\d+)"/)
  return rawMatch ? Number(rawMatch[1]) : undefined
}

function extractOriginalNotifyFromCodexBlock(block: string): string[] | undefined {
  const match = block.match(/^# brrr original notify json: (.+)$/m)
  if (!match) return undefined
  try {
    const parsed = JSON.parse(match[1]) as unknown
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

function upsertManagedBlock(currentText: string, nextBlock: string): string {
  const existing = extractManagedBlock(currentText)
  if (existing) {
    return upsertManagedBlock(removeManagedBlock(currentText), nextBlock)
  }

  const trimmed = currentText.trimEnd()
  if (!trimmed) return `${nextBlock}\n`

  const firstTableMatch = trimmed.match(/^\s*\[/m)
  if (!firstTableMatch || firstTableMatch.index === undefined) {
    return `${trimmed}\n\n${nextBlock}\n`
  }

  const index = firstTableMatch.index
  const prefix = trimmed.slice(0, index).trimEnd()
  const suffix = trimmed.slice(index).replace(/^\n+/, "")

  const parts = [
    prefix,
    nextBlock,
    suffix
  ].filter((part) => part.length > 0)

  return `${parts.join("\n\n")}\n`
}

function removeManagedBlock(text: string): string {
  const existing = extractManagedBlock(text)
  if (!existing) return text
  return `${text.replace(existing, "").trimEnd()}\n`.replace(/^\s+$/g, "")
}

function upsertTopLevelNotify(currentText: string, notifyArgs: string[]): string {
  const notifyLine = `notify = [${notifyArgs.map(toTomlString).join(", ")}]`
  const trimmed = currentText.trimEnd()
  if (!trimmed) return `${notifyLine}\n`

  const firstTableMatch = trimmed.match(/^\s*\[/m)
  if (!firstTableMatch || firstTableMatch.index === undefined) {
    return `${trimmed}\n\n${notifyLine}\n`
  }

  const index = firstTableMatch.index
  const prefix = trimmed.slice(0, index).trimEnd()
  const suffix = trimmed.slice(index).replace(/^\n+/, "")
  const parts = [prefix, notifyLine, suffix].filter((part) => part.length > 0)
  return `${parts.join("\n\n")}\n`
}

function extractManagedBlock(text: string): string | null {
  const start = text.indexOf(BLOCK_START)
  if (start === -1) return null
  const end = text.indexOf(BLOCK_END, start)
  if (end === -1) return null
  const afterEnd = end + BLOCK_END.length
  const trailingNewline = text.slice(afterEnd).startsWith("\n") ? 1 : 0
  return text.slice(start, afterEnd + trailingNewline)
}

async function detectCodexPresence(): Promise<boolean> {
  const config = await readTextFileIfExists(configPath)
  if (config !== null) return true
  return commandExists("codex")
}

async function maybeCreateBackup(path: string): Promise<string | undefined> {
  const content = await readTextFileIfExists(path)
  if (content === null) return undefined
  return createBackup(path)
}

function escapeDoubleQuoted(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")
}

function extractNotifyAssignment(text: string): { start: number, end: number, args: string[] } | null {
  const match = text.match(/^\s*notify\s*=\s*\[/m)
  if (!match || match.index === undefined) return null

  const start = match.index
  const openBracketIndex = start + match[0].lastIndexOf("[")
  let index = openBracketIndex + 1
  let inString = false
  let escaping = false

  for (; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaping) {
        escaping = false
        continue
      }
      if (char === "\\") {
        escaping = true
        continue
      }
      if (char === "\"") {
        inString = false
      }
      continue
    }

    if (char === "\"") {
      inString = true
      continue
    }

    if (char === "]") {
      const end = includeTrailingNewline(text, index + 1)
      const assignment = text.slice(start, index + 1)
      const args = parseNotifyArgs(assignment)
      return args ? { start, end, args } : null
    }
  }

  return null
}

function parseNotifyArgs(assignment: string): string[] | null {
  const start = assignment.indexOf("[")
  const end = assignment.lastIndexOf("]")
  if (start === -1 || end === -1 || end <= start) return null

  const arrayLiteral = assignment.slice(start, end + 1)
  try {
    const parsed = JSON.parse(arrayLiteral) as unknown
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function removeNotifyAssignment(
  text: string,
  assignment: { start: number, end: number, args: string[] }
): string {
  return `${text.slice(0, assignment.start)}${text.slice(assignment.end)}`.trimEnd() + "\n"
}

function includeTrailingNewline(text: string, index: number): number {
  return text[index] === "\n" ? index + 1 : index
}

function normalizeText(value: string): string {
  return value.replace(/\s+$/, "")
}

function toTomlString(value: string): string {
  return `"${escapeDoubleQuoted(value)}"`
}

export function buildCodexFinishedPayload(cwd?: string, lastAssistantMessage?: string): { title: string; subtitle?: string; message: string } {
  const projectName = cwd ? basename(cwd) : undefined
  return {
    title: "Codex finished",
    message: lastAssistantMessage?.trim() || (projectName
      ? `Codex finished working in '${projectName}'.`
      : "Codex finished a turn.")
  }
}
