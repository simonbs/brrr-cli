import { basename, join } from "node:path"
import { homedir } from "node:os"
import { createBackup } from "./backup.js"
import { readTextFileIfExists, writeTextFile } from "../../utils/fs.js"
import type { AgentInstallState, InstallOptions, InstallResult, UninstallResult } from "../adapters/types.js"
import { stringifyWebhookRef } from "../webhook-ref.js"
import { commandExists } from "../../utils/shell.js"
import { getCliInvocationArgs } from "../../utils/cli.js"
import { getAgentIconUrl } from "../icons.js"
import type { SendPayload } from "../transport/payload.js"

const configFileName = "config.toml"
const hooksFileName = "hooks.json"
const BLOCK_START = "# brrr agent integration start"
const BLOCK_END = "# brrr agent integration end"
const PERMISSION_REQUEST_MARKER = "brrr:codex:permissionrequest:v1"

interface CodexHookEntry {
  type?: string
  command?: string
  async?: boolean
  timeout?: number
  statusMessage?: string
}

interface CodexMatcherEntry {
  matcher?: string
  hooks?: CodexHookEntry[]
}

interface CodexHooksConfig {
  hooks?: Record<string, CodexMatcherEntry[]>
  [key: string]: unknown
}

export async function readCodexInstallState(): Promise<AgentInstallState> {
  const configPath = getCodexConfigPath()
  const [configText, present] = await Promise.all([
    readTextFileIfExists(configPath),
    detectCodexPresence()
  ])

  const block = extractManagedBlock(configText ?? "")
  const hooksConfig = await loadHooksConfig()
  const permissionRequestCommand = findHookCommand(
    hooksConfig,
    "PermissionRequest",
    undefined,
    PERMISSION_REQUEST_MARKER
  )
  const installed = block !== null || !!permissionRequestCommand
  return {
    agent: "codex",
    present,
    installed,
    configPath,
    webhookRef: installed
      ? extractWebhookFromCodexBlock(block ?? "") ?? extractWebhookArg(permissionRequestCommand)
      : undefined,
    idleSeconds: installed
      ? extractIdleSecondsFromCodexBlock(block ?? "") ?? extractIdleSecondsArg(permissionRequestCommand)
      : undefined,
    supportedEvents: ["finished", "needs-approval"]
  }
}

export async function installCodex(options: InstallOptions): Promise<InstallResult> {
  const configPath = getCodexConfigPath()
  const currentText = (await readTextFileIfExists(configPath)) ?? ""
  const currentHooksConfig = await loadHooksConfig()
  const wasInstalled = extractManagedBlock(currentText) !== null
    || !!findHookCommand(currentHooksConfig, "PermissionRequest", undefined, PERMISSION_REQUEST_MARKER)
  const currentBlock = extractManagedBlock(currentText)
  const preservedNotify = currentBlock ? extractOriginalNotifyFromCodexBlock(currentBlock) : undefined
  const textWithoutBlock = removeManagedBlock(currentText)
  const existingNotify = extractNotifyAssignment(textWithoutBlock)
  const originalNotify = existingNotify?.args ?? preservedNotify
  const cleanedText = existingNotify ? removeNotifyAssignment(textWithoutBlock, existingNotify) : textWithoutBlock

  const nextBlock = buildCodexManagedBlock(options.webhook, options.idleSeconds, originalNotify)
  const nextText = upsertManagedBlock(cleanedText, nextBlock)
  const hooksResult = await installCodexPermissionRequestHook(options)
  const backupPath = await maybeCreateBackup(configPath) ?? hooksResult.backupPath
  await writeTextFile(configPath, nextText)
  return {
    changed: normalizeText(currentText) !== normalizeText(nextText) || wasInstalled || hooksResult.changed,
    backupPath,
    message: wasInstalled ? "reinstalled" : "installed"
  }
}

export async function uninstallCodex(): Promise<UninstallResult> {
  const configPath = getCodexConfigPath()
  const currentText = (await readTextFileIfExists(configPath)) ?? ""
  const block = extractManagedBlock(currentText)
  const originalNotify = block ? extractOriginalNotifyFromCodexBlock(block) : undefined
  const textWithoutBlock = removeManagedBlock(currentText)
  const nextText = originalNotify
    ? upsertTopLevelNotify(textWithoutBlock, originalNotify)
    : textWithoutBlock
  const hooksResult = await uninstallCodexPermissionRequestHook()
  const configChanged = normalizeText(currentText) !== normalizeText(nextText)
  if (!configChanged && !hooksResult.changed) {
    return { changed: false, message: "not installed" }
  }

  const backupPath = configChanged
    ? await maybeCreateBackup(configPath) ?? hooksResult.backupPath
    : hooksResult.backupPath
  if (configChanged) {
    await writeTextFile(configPath, nextText)
  }
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
  return join(getCodexHome(), configFileName)
}

export function getCodexHooksPath(): string {
  return join(getCodexHome(), hooksFileName)
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

async function installCodexPermissionRequestHook(options: InstallOptions): Promise<{ changed: boolean, backupPath?: string }> {
  const hooksPath = getCodexHooksPath()
  const currentConfig = await loadHooksConfig()
  const nextConfig = structuredClone(currentConfig)

  upsertEventHook(
    nextConfig,
    "PermissionRequest",
    undefined,
    PERMISSION_REQUEST_MARKER,
    buildCodexHookCommand("needs-approval", options.webhook, PERMISSION_REQUEST_MARKER, options.idleSeconds)
  )

  const currentText = serializeHooksConfig(currentConfig)
  const nextText = serializeHooksConfig(nextConfig)
  if (currentText === nextText) {
    return { changed: false }
  }

  const backupPath = await maybeCreateBackup(hooksPath)
  await writeTextFile(hooksPath, `${nextText}\n`)
  return { changed: true, backupPath }
}

async function uninstallCodexPermissionRequestHook(): Promise<{ changed: boolean, backupPath?: string }> {
  const hooksPath = getCodexHooksPath()
  const currentConfig = await loadHooksConfig()
  const nextConfig = structuredClone(currentConfig)

  removeEventHook(nextConfig, "PermissionRequest", undefined, PERMISSION_REQUEST_MARKER)

  const currentText = serializeHooksConfig(currentConfig)
  const nextText = serializeHooksConfig(nextConfig)
  if (currentText === nextText) {
    return { changed: false }
  }

  const backupPath = await maybeCreateBackup(hooksPath)
  await writeTextFile(hooksPath, `${nextText}\n`)
  return { changed: true, backupPath }
}

export function buildCodexHookCommand(
  event: "needs-approval",
  webhook: InstallOptions["webhook"],
  marker: string,
  idleSeconds?: number
): string {
  const webhookValue = shellQuote(stringifyWebhookRef(webhook))
  return `${[
    ...getCliInvocationArgs().map(shellQuote),
    "agent",
    "dispatch",
    "--agent",
    "codex",
    "--event",
    event,
    "--webhook",
    webhookValue,
    ...(idleSeconds === undefined ? [] : ["--idle-seconds", String(idleSeconds)])
  ].join(" ")} # ${marker}`
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
  const config = await readTextFileIfExists(getCodexConfigPath())
  if (config !== null) return true
  const hooks = await readTextFileIfExists(getCodexHooksPath())
  if (hooks !== null) return true
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

async function loadHooksConfig(): Promise<CodexHooksConfig> {
  const hooksPath = getCodexHooksPath()
  const text = await readTextFileIfExists(hooksPath)
  if (!text) return {}

  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error(`Invalid Codex hooks configuration at ${hooksPath}.`) }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Invalid Codex hooks configuration at ${hooksPath}.`)
  return parsed as CodexHooksConfig
}

function upsertEventHook(
  config: CodexHooksConfig,
  eventName: string,
  matcher: string | undefined,
  marker: string,
  command: string
): void {
  const eventEntries = config.hooks?.[eventName] ?? []
  const targetEntry = matcher === undefined
    ? ensureDefaultMatcherEntry(eventEntries)
    : ensureMatcherEntry(eventEntries, matcher)

  targetEntry.hooks ??= []
  const hookIndex = targetEntry.hooks.findIndex((entry) => entry.command?.includes(marker))
  const nextHook: CodexHookEntry = {
    type: "command",
    command,
    async: true,
    timeout: 5,
    statusMessage: "Sending brrr approval notification"
  }

  if (hookIndex >= 0) {
    targetEntry.hooks[hookIndex] = nextHook
  } else {
    targetEntry.hooks.push(nextHook)
  }

  config.hooks ??= {}
  config.hooks[eventName] = eventEntries
}

function removeEventHook(
  config: CodexHooksConfig,
  eventName: string,
  matcher: string | undefined,
  marker: string
): void {
  const eventEntries = config.hooks?.[eventName]
  if (!eventEntries) return

  const filteredEntries = eventEntries.flatMap((entry) => {
    const matches = matcher === undefined
      ? !entry.matcher
      : entry.matcher === matcher

    if (!matches) return [entry]

    const hooks = (entry.hooks ?? []).filter((hook) => !hook.command?.includes(marker))
    if (hooks.length === 0) return []
    return [{ ...entry, hooks }]
  })

  if (filteredEntries.length === 0) {
    delete config.hooks?.[eventName]
  } else {
    config.hooks ??= {}
    config.hooks[eventName] = filteredEntries
  }

  if (config.hooks && Object.keys(config.hooks).length === 0) {
    delete config.hooks
  }
}

function ensureDefaultMatcherEntry(entries: CodexMatcherEntry[]): CodexMatcherEntry {
  const existing = entries.find((entry) => !entry.matcher)
  if (existing) return existing

  const entry: CodexMatcherEntry = { hooks: [] }
  entries.push(entry)
  return entry
}

function ensureMatcherEntry(entries: CodexMatcherEntry[], matcher: string): CodexMatcherEntry {
  const existing = entries.find((entry) => entry.matcher === matcher)
  if (existing) return existing

  const entry: CodexMatcherEntry = { matcher, hooks: [] }
  entries.push(entry)
  return entry
}

function findHookCommand(
  config: CodexHooksConfig,
  eventName: string,
  matcher: string | undefined,
  marker: string
): string | undefined {
  const entries = config.hooks?.[eventName] ?? []
  for (const entry of entries) {
    const isTarget = matcher === undefined ? !entry.matcher : entry.matcher === matcher
    if (!isTarget) continue
    for (const hook of entry.hooks ?? []) {
      if (hook.command?.includes(marker)) return hook.command
    }
  }
}

function extractWebhookArg(command: string | undefined): string | undefined {
  if (!command) return undefined
  const match = command.match(/--webhook\s+('([^']*)'|"([^"]*)"|(\S+))/)
  return match?.[2] ?? match?.[3] ?? match?.[4]
}

function extractIdleSecondsArg(command: string | undefined): number | undefined {
  if (!command) return undefined
  const match = command.match(/--idle-seconds\s+(\d+)/)
  if (!match) return undefined

  const parsed = Number(match[1])
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function serializeHooksConfig(config: CodexHooksConfig): string {
  return JSON.stringify(config, null, 2)
}

function getCodexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex")
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export function buildCodexFinishedPayload(cwd?: string): SendPayload
export function buildCodexFinishedPayload(
  cwd: string | undefined,
  lastAssistantMessage: string | null | undefined
): SendPayload | undefined
export function buildCodexFinishedPayload(
  cwd?: string,
  lastAssistantMessage?: string | null
): SendPayload | undefined {
  if (shouldSkipCodexFinishedMessage(lastAssistantMessage)) {
    return undefined
  }

  const projectName = cwd ? basename(cwd) : undefined
  return {
    title: "Codex finished",
    message: lastAssistantMessage?.trim() || (projectName
      ? `Codex finished working in '${projectName}'.`
      : "Codex finished a turn."),
    icon_url: getAgentIconUrl("codex")
  }
}

function shouldSkipCodexFinishedMessage(message?: string | null): boolean {
  const trimmed = message?.trim()
  if (!trimmed || !trimmed.startsWith("{")) return false

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false
    }

    const keys = Object.keys(parsed)
    return keys.length === 1 && typeof (parsed as Record<string, unknown>).title === "string"
  } catch {
    return false
  }
}

export function buildCodexApprovalPayload(cwd?: string, message?: string): SendPayload {
  const projectName = cwd ? basename(cwd) : undefined
  return {
    title: "Codex needs approval",
    message: message?.trim() || (projectName
      ? `Codex is waiting for approval in '${projectName}'.`
      : "Codex is waiting for approval."),
    icon_url: getAgentIconUrl("codex")
  }
}
