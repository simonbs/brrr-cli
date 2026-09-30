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
const STOP_MARKER = "brrr:codex:stop:v1"
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
  const [hooksConfig, present] = await Promise.all([loadHooksConfig(), detectCodexPresence()])
  const stopCommand = findHookCommand(hooksConfig, "Stop", STOP_MARKER)
  const approvalCommand = findHookCommand(hooksConfig, "PermissionRequest", PERMISSION_REQUEST_MARKER)
  return {
    agent: "codex",
    present,
    installed: !!stopCommand && !!approvalCommand,
    configPath: getCodexHooksPath(),
    webhookRef: extractWebhookArg(stopCommand ?? approvalCommand),
    idleSeconds: extractIdleSecondsArg(stopCommand ?? approvalCommand),
    supportedEvents: ["finished", "needs-approval"]
  }
}

export async function installCodex(options: InstallOptions): Promise<InstallResult> {
  const currentConfig = await loadHooksConfig()
  const configPath = getCodexConfigPath()
  const currentText = (await readTextFileIfExists(configPath)) ?? ""
  const block = extractManagedBlock(currentText)
  const nextText = removeLegacyNotify(currentText)
  const configChanged = currentText !== nextText
  const expectedHooks = buildExpectedHooks(options)
  const hooksChanged = !hasExpectedHooks(currentConfig, expectedHooks)
  const wasInstalled = block !== null || hasManagedHooks(currentConfig)

  if (!configChanged && !hooksChanged) {
    return { changed: false, message: "already configured" }
  }

  let backupPath: string | undefined
  if (hooksChanged) {
    const nextConfig = structuredClone(currentConfig)
    removeManagedHooks(nextConfig)
    nextConfig.hooks ??= {}
    for (const [event, hook] of Object.entries(expectedHooks)) {
      nextConfig.hooks[event] ??= []
      nextConfig.hooks[event].push({ hooks: [hook] })
    }
    backupPath = await maybeCreateBackup(getCodexHooksPath())
    await writeTextFile(getCodexHooksPath(), `${serializeHooksConfig(nextConfig)}\n`)
  }
  if (configChanged) {
    const configBackupPath = await maybeCreateBackup(configPath)
    await writeTextFile(configPath, nextText)
    backupPath = configBackupPath ?? backupPath
  }
  return { changed: true, backupPath, message: wasInstalled ? "reinstalled" : "installed" }
}

export async function uninstallCodex(): Promise<UninstallResult> {
  const currentConfig = await loadHooksConfig()
  const configPath = getCodexConfigPath()
  const currentText = (await readTextFileIfExists(configPath)) ?? ""
  const nextText = removeLegacyNotify(currentText)
  const configChanged = currentText !== nextText
  const hooksChanged = hasManagedHooks(currentConfig)
  if (!configChanged && !hooksChanged) {
    return { changed: false, message: "not installed" }
  }

  let backupPath: string | undefined
  if (hooksChanged) {
    const nextConfig = structuredClone(currentConfig)
    removeManagedHooks(nextConfig)
    backupPath = await maybeCreateBackup(getCodexHooksPath())
    await writeTextFile(getCodexHooksPath(), `${serializeHooksConfig(nextConfig)}\n`)
  }
  if (configChanged) {
    const configBackupPath = await maybeCreateBackup(configPath)
    await writeTextFile(configPath, nextText)
    backupPath = configBackupPath ?? backupPath
  }
  return { changed: true, backupPath, message: "uninstalled" }
}

function removeLegacyNotify(text: string): string {
  const block = extractManagedBlock(text)
  if (!block) return text
  const originalNotify = extractOriginalNotifyFromCodexBlock(block)
  const cleaned = removeManagedBlock(text)
  // Preserve a newer user-configured notify if one exists outside our block.
  const topLevelText = cleaned.split(/^\s*\[/m, 1)[0]
  return originalNotify && !/^\s*notify\s*=/m.test(topLevelText)
    ? upsertTopLevelNotify(cleaned, originalNotify)
    : cleaned
}

export function getCodexConfigPath(): string {
  return join(getCodexHome(), configFileName)
}

export function getCodexHooksPath(): string {
  return join(getCodexHome(), hooksFileName)
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

export function buildCodexHookCommand(
  event: "finished" | "needs-approval",
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
  const config = parsed as CodexHooksConfig
  if (config.hooks !== undefined && !isHooksMap(config.hooks)) {
    throw new Error(`Invalid Codex hooks configuration at ${hooksPath}.`)
  }
  return config
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isHooksMap(value: unknown): boolean {
  if (!isRecord(value)) return false
  return Object.values(value).every(entries => Array.isArray(entries) && entries.every(entry => {
    if (!isRecord(entry)) return false
    if (entry.matcher !== undefined && typeof entry.matcher !== "string") return false
    if (entry.hooks === undefined) return true
    return Array.isArray(entry.hooks) && entry.hooks.every(hook =>
      isRecord(hook) && (hook.command === undefined || typeof hook.command === "string"))
  }))
}

function buildExpectedHooks(options: InstallOptions): Record<string, CodexHookEntry> {
  const buildHook = (event: "finished" | "needs-approval", marker: string, statusMessage: string): CodexHookEntry => ({
    type: "command",
    command: buildCodexHookCommand(event, options.webhook, marker, options.idleSeconds),
    async: true,
    timeout: 5,
    statusMessage
  })
  return {
    Stop: buildHook("finished", STOP_MARKER, "Sending brrr finished notification"),
    PermissionRequest: buildHook("needs-approval", PERMISSION_REQUEST_MARKER, "Sending brrr approval notification")
  }
}

function isManagedHook(hook: CodexHookEntry): boolean {
  return typeof hook.command === "string"
    && /# brrr:codex:(stop|permissionrequest):v\d+$/.test(hook.command)
}

function hasManagedHooks(config: CodexHooksConfig): boolean {
  return Object.values(config.hooks ?? {}).some(entries =>
    entries.some(entry => entry.hooks?.some(isManagedHook)))
}

function hasExpectedHooks(config: CodexHooksConfig, expected: Record<string, CodexHookEntry>): boolean {
  const managed = Object.entries(config.hooks ?? {}).flatMap(([event, entries]) =>
    entries.flatMap(entry => (entry.hooks ?? []).filter(isManagedHook).map(hook => ({ event, entry, hook }))))
  return managed.length === Object.keys(expected).length && Object.entries(expected).every(([event, hook]) => {
    const matches = managed.filter(item => item.event === event && !item.entry.matcher)
    if (matches.length !== 1) return false
    const actual = matches[0].hook
    return Object.keys(actual).length === Object.keys(hook).length
      && Object.entries(hook).every(([key, value]) => (actual as Record<string, unknown>)[key] === value)
  })
}

function removeManagedHooks(config: CodexHooksConfig): void {
  for (const [event, entries] of Object.entries(config.hooks ?? {})) {
    const remaining = entries.flatMap(entry => {
      const hooks = entry.hooks ?? []
      const filtered = hooks.filter(hook => !isManagedHook(hook))
      if (filtered.length === hooks.length) return [entry]
      return filtered.length ? [{ ...entry, hooks: filtered }] : []
    })
    if (remaining.length) config.hooks![event] = remaining
    else delete config.hooks![event]
  }
  if (config.hooks && Object.keys(config.hooks).length === 0) delete config.hooks
}

function findHookCommand(config: CodexHooksConfig, event: string, marker: string): string | undefined {
  for (const entry of config.hooks?.[event] ?? []) {
    if (entry.matcher) continue
    for (const hook of entry.hooks ?? []) {
      if (hook.type === "command" && hook.command?.endsWith(`# ${marker}`)) return hook.command
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
