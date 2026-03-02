import { basename, join } from "node:path"
import { homedir } from "node:os"
import { createBackup } from "./backup.js"
import { readTextFileIfExists, writeTextFile } from "../../utils/fs.js"
import type { AgentInstallState, InstallOptions, InstallResult, UninstallResult } from "../adapters/types.js"
import { stringifyWebhookRef } from "../webhook-ref.js"
import { commandExists } from "../../utils/shell.js"
import { getCliInvocationArgs } from "../../utils/cli.js"

const configPath = join(homedir(), ".claude", "settings.json")
const STOP_MARKER = "brrr:claude:stop:v1"
const PERMISSION_MARKER = "brrr:claude:notification:permission_prompt:v1"
const ASK_USER_QUESTION_MARKER = "brrr:claude:pretooluse:askuserquestion:v1"

interface ClaudeHookEntry {
  type?: string
  command?: string
  async?: boolean
  timeout?: number
}

interface ClaudeMatcherEntry {
  matcher?: string
  hooks?: ClaudeHookEntry[]
}

interface ClaudeSettings {
  hooks?: Record<string, ClaudeMatcherEntry[]>
  [key: string]: unknown
}

export async function readClaudeInstallState(): Promise<AgentInstallState> {
  const [config, present] = await Promise.all([
    loadSettings(),
    detectClaudePresence()
  ])

  const stopCommand = findHookCommand(config, "Stop", undefined, STOP_MARKER)
  const permissionCommand = findHookCommand(config, "Notification", "permission_prompt", PERMISSION_MARKER)
  const askUserQuestionCommand = findHookCommand(config, "PreToolUse", "AskUserQuestion", ASK_USER_QUESTION_MARKER)
  const installed = !!stopCommand && !!permissionCommand && !!askUserQuestionCommand

  return {
    agent: "claude",
    present,
    installed,
    configPath,
    webhookRef: installed ? extractWebhookArg(stopCommand) ?? extractWebhookArg(permissionCommand) : undefined,
    idleSeconds: installed ? extractIdleSecondsArg(stopCommand) ?? extractIdleSecondsArg(permissionCommand) : undefined,
    supportedEvents: ["finished", "needs-approval"]
  }
}

export async function installClaude(options: InstallOptions): Promise<InstallResult> {
  const settings = await loadSettings()
  const wasInstalled = hasManagedClaudeHooks(settings)
  const nextSettings = structuredClone(settings)
  nextSettings.hooks ??= {}

  upsertEventHook(
    nextSettings,
    "Stop",
    undefined,
    STOP_MARKER,
    buildClaudeCommand("finished", options.webhook, STOP_MARKER, options.idleSeconds)
  )
  upsertEventHook(
    nextSettings,
    "Notification",
    "permission_prompt",
    PERMISSION_MARKER,
    buildClaudeCommand("needs-approval", options.webhook, PERMISSION_MARKER, options.idleSeconds)
  )
  upsertEventHook(
    nextSettings,
    "PreToolUse",
    "AskUserQuestion",
    ASK_USER_QUESTION_MARKER,
    buildClaudeCommand("needs-approval", options.webhook, ASK_USER_QUESTION_MARKER, options.idleSeconds)
  )

  const currentText = serializeSettings(settings)
  const nextText = serializeSettings(nextSettings)
  const backupPath = await maybeCreateBackup(configPath)
  await writeTextFile(configPath, `${nextText}\n`)
  return {
    changed: currentText !== nextText || wasInstalled,
    backupPath,
    message: wasInstalled ? "reinstalled" : "installed"
  }
}

export async function uninstallClaude(): Promise<UninstallResult> {
  const settings = await loadSettings()
  const nextSettings = structuredClone(settings)

  removeEventHook(nextSettings, "Stop", undefined, STOP_MARKER)
  removeEventHook(nextSettings, "Notification", "permission_prompt", PERMISSION_MARKER)
  removeEventHook(nextSettings, "PreToolUse", "AskUserQuestion", ASK_USER_QUESTION_MARKER)

  const currentText = serializeSettings(settings)
  const nextText = serializeSettings(nextSettings)
  if (currentText === nextText) {
    return { changed: false, message: "not installed" }
  }

  const backupPath = await maybeCreateBackup(configPath)
  await writeTextFile(configPath, `${nextText}\n`)
  return { changed: true, backupPath, message: "uninstalled" }
}

export function buildClaudeCommand(
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
    "claude",
    "--event",
    event,
    "--webhook",
    webhookValue,
    ...(idleSeconds === undefined ? [] : ["--idle-seconds", String(idleSeconds)])
  ].join(" ")} # ${marker}`
}

export function getClaudeConfigPath(): string {
  return configPath
}

async function detectClaudePresence(): Promise<boolean> {
  const config = await readTextFileIfExists(configPath)
  if (config !== null) return true
  return commandExists("claude")
}

async function loadSettings(): Promise<ClaudeSettings> {
  const text = await readTextFileIfExists(configPath)
  if (!text) return {}

  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid Claude settings at ${configPath}.`)
  }

  return parsed as ClaudeSettings
}

function upsertEventHook(
  settings: ClaudeSettings,
  eventName: string,
  matcher: string | undefined,
  marker: string,
  command: string
): void {
  const eventEntries = settings.hooks?.[eventName] ?? []
  const targetEntry = matcher === undefined
    ? ensureDefaultMatcherEntry(eventEntries)
    : ensureMatcherEntry(eventEntries, matcher)

  targetEntry.hooks ??= []
  const hookIndex = targetEntry.hooks.findIndex((entry) => entry.command?.includes(marker))
  const nextHook: ClaudeHookEntry = {
    type: "command",
    command,
    async: true,
    timeout: 5
  }

  if (hookIndex >= 0) {
    targetEntry.hooks[hookIndex] = nextHook
  } else {
    targetEntry.hooks.push(nextHook)
  }

  settings.hooks ??= {}
  settings.hooks[eventName] = eventEntries
}

function removeEventHook(
  settings: ClaudeSettings,
  eventName: string,
  matcher: string | undefined,
  marker: string
): void {
  const eventEntries = settings.hooks?.[eventName]
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
    delete settings.hooks?.[eventName]
  } else {
    settings.hooks ??= {}
    settings.hooks[eventName] = filteredEntries
  }

  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks
  }
}

function ensureDefaultMatcherEntry(entries: ClaudeMatcherEntry[]): ClaudeMatcherEntry {
  const existing = entries.find((entry) => !entry.matcher)
  if (existing) return existing

  const entry: ClaudeMatcherEntry = { hooks: [] }
  entries.push(entry)
  return entry
}

function ensureMatcherEntry(entries: ClaudeMatcherEntry[], matcher: string): ClaudeMatcherEntry {
  const existing = entries.find((entry) => entry.matcher === matcher)
  if (existing) return existing

  const entry: ClaudeMatcherEntry = { matcher, hooks: [] }
  entries.push(entry)
  return entry
}

function findHookCommand(
  settings: ClaudeSettings,
  eventName: string,
  matcher: string | undefined,
  marker: string
): string | undefined {
  const entries = settings.hooks?.[eventName] ?? []
  for (const entry of entries) {
    const isTarget = matcher === undefined ? !entry.matcher : entry.matcher === matcher
    if (!isTarget) continue
    for (const hook of entry.hooks ?? []) {
      if (hook.command?.includes(marker)) return hook.command
    }
  }

  return undefined
}

function hasManagedClaudeHooks(settings: ClaudeSettings): boolean {
  return [
    findHookCommand(settings, "Stop", undefined, STOP_MARKER),
    findHookCommand(settings, "Notification", "permission_prompt", PERMISSION_MARKER),
    findHookCommand(settings, "PreToolUse", "AskUserQuestion", ASK_USER_QUESTION_MARKER)
  ].some(Boolean)
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

function serializeSettings(settings: ClaudeSettings): string {
  return JSON.stringify(settings, null, 2)
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

async function maybeCreateBackup(path: string): Promise<string | undefined> {
  const content = await readTextFileIfExists(path)
  if (content === null) return undefined
  return createBackup(path)
}

export function buildClaudeFinishedPayload(cwd?: string, summary?: string): { title: string; subtitle?: string; message: string } {
  const projectName = cwd ? basename(cwd) : undefined
  return {
    title: "Claude finished",
    message: summary?.trim() || (projectName
      ? `Claude finished working in '${projectName}'.`
      : "Claude finished working.")
  }
}

export function buildClaudeApprovalPayload(cwd?: string, message?: string): { title: string; subtitle?: string; message: string } {
  const projectName = cwd ? basename(cwd) : undefined
  return {
    title: "Claude needs approval",
    message: message?.trim() || (projectName
      ? `Claude is waiting for your input in '${projectName}'.`
      : "Claude is waiting for your input.")
  }
}
