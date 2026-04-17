import { unlink } from "node:fs/promises"
import { basename, join } from "node:path"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { readTextFileIfExists, writeTextFile } from "../../utils/fs.js"
import type { AgentInstallState, InstallOptions, InstallResult, UninstallResult } from "../adapters/types.js"
import { stringifyWebhookRef } from "../webhook-ref.js"
import { commandExists } from "../../utils/shell.js"

const AGENT_STOP_MARKER = "brrr:copilot:agent-stop:v1"
const LEGACY_SESSION_END_MARKER = "brrr:copilot:session-end:v1"
const ERROR_MARKER = "brrr:copilot:error-occurred:v1"

interface CopilotHookEntry {
  type?: string
  bash?: string
  timeoutSec?: number
  comment?: string
  [key: string]: unknown
}

interface CopilotConfig {
  version?: number
  hooks?: Record<string, CopilotHookEntry[]>
  [key: string]: unknown
}

type CopilotHookName = "agentStop" | "errorOccurred" | "sessionEnd"

export async function readCopilotInstallState(): Promise<AgentInstallState> {
  const [configText, present] = await Promise.all([
    readTextFileIfExists(getCopilotConfigPath()),
    detectCopilotPresence()
  ])

  const config = parseCopilotConfig(configText)
  const agentStopHook = findManagedHook(config, "agentStop", AGENT_STOP_MARKER)
  const errorHook = findManagedHook(config, "errorOccurred", ERROR_MARKER)
  const installed = !!agentStopHook && !!errorHook

  return {
    agent: "copilot",
    present,
    installed,
    configPath: getCopilotConfigPath(),
    webhookRef: installed ? extractWebhookArg(agentStopHook?.bash) ?? extractWebhookArg(errorHook?.bash) : undefined,
    idleSeconds: installed ? extractIdleSecondsArg(agentStopHook?.bash) ?? extractIdleSecondsArg(errorHook?.bash) : undefined,
    supportedEvents: ["finished", "error"]
  }
}

export async function installCopilot(options: InstallOptions): Promise<InstallResult> {
  const configPath = getCopilotConfigPath()
  const existingText = await readTextFileIfExists(configPath)
  if (existingText === null && !(await detectCopilotPresence())) {
    return {
      changed: false,
      message: "skipped (not installed)"
    }
  }

  const currentText = normalizeConfigText(existingText)
  const currentConfig = parseCopilotConfig(currentText)
  const wasInstalled = hasManagedCopilotHooks(currentConfig)

  let nextText = updateJsoncPath(currentText, ["version"], 1)
  nextText = removeManagedHook(nextText, "sessionEnd", LEGACY_SESSION_END_MARKER)
  nextText = upsertManagedHook(
    nextText,
    "agentStop",
    buildCopilotHook("finished", options.webhook, AGENT_STOP_MARKER, options.idleSeconds)
  )
  nextText = upsertManagedHook(
    nextText,
    "errorOccurred",
    buildCopilotHook("error", options.webhook, ERROR_MARKER, options.idleSeconds)
  )

  await writeTextFile(configPath, ensureTrailingNewline(nextText))
  return {
    changed: normalizeText(currentText) !== normalizeText(nextText) || wasInstalled,
    message: wasInstalled ? "reinstalled" : "installed"
  }
}

export async function uninstallCopilot(): Promise<UninstallResult> {
  const configPath = getCopilotConfigPath()
  const currentText = normalizeConfigText(await readTextFileIfExists(configPath))

  let nextText = removeManagedHook(currentText, "agentStop", AGENT_STOP_MARKER)
  nextText = removeManagedHook(nextText, "sessionEnd", LEGACY_SESSION_END_MARKER)
  nextText = removeManagedHook(nextText, "errorOccurred", ERROR_MARKER)

  if (normalizeText(currentText) === normalizeText(nextText)) {
    return { changed: false, message: "not installed" }
  }

  const nextConfig = parseCopilotConfig(nextText)
  if (canDeleteConfigFile(nextConfig)) {
    await unlinkIfExists(configPath)
  } else {
    await writeTextFile(configPath, ensureTrailingNewline(nextText))
  }
  return { changed: true, message: "uninstalled" }
}

export function buildCopilotCommand(
  event: "finished" | "error",
  webhook: InstallOptions["webhook"],
  marker: string,
  idleSeconds?: number
): string {
  const webhookValue = shellQuote(stringifyWebhookRef(webhook))
  return `${[
    "command -v brrr >/dev/null 2>&1 || exit 0;",
    [
      "brrr",
    "agent",
    "dispatch",
    "--agent",
    "copilot",
    "--event",
    event,
    "--webhook",
    webhookValue,
    ...(idleSeconds === undefined ? [] : ["--idle-seconds", String(idleSeconds)])
    ].join(" ")
  ].join(" ")} # ${marker}`
}

export function getCopilotConfigPath(): string {
  return join(process.cwd(), ".github", "hooks", "brrr-copilot.json")
}

export function buildCopilotFinishedPayload(cwd?: string): { title: string, subtitle?: string, message: string } {
  const projectName = cwd ? basename(cwd) : undefined
  return {
    title: "Copilot finished",
    message: projectName
      ? `Copilot finished working in '${projectName}'.`
      : "Copilot finished working."
  }
}

export function buildCopilotErrorPayload(cwd?: string, errorMessage?: string): { title: string, subtitle?: string, message: string } {
  const projectName = cwd ? basename(cwd) : undefined
  return {
    title: "Copilot error",
    message: errorMessage?.trim() || (projectName
      ? `Copilot hit an error in '${projectName}'.`
      : "Copilot hit an error.")
  }
}

async function detectCopilotPresence(): Promise<boolean> {
  return commandExists("copilot")
}

function parseCopilotConfig(text: string | null): CopilotConfig {
  if (!text?.trim()) return {}

  const errors: ParseError[] = []
  const parsed = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false
  })

  if (errors.length > 0 || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid Copilot config at ${getCopilotConfigPath()}.`)
  }

  const config = parsed as CopilotConfig
  if (config.version !== undefined && config.version !== 1) {
    throw new Error(`Invalid Copilot hooks configuration at ${getCopilotConfigPath()}.`)
  }
  if (config.hooks !== undefined && (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks))) {
    throw new Error(`Invalid Copilot hooks configuration at ${getCopilotConfigPath()}.`)
  }

  return config
}

function buildCopilotHook(
  event: "finished" | "error",
  webhook: InstallOptions["webhook"],
  marker: string,
  idleSeconds?: number
): CopilotHookEntry {
  return {
    type: "command",
    bash: buildCopilotCommand(event, webhook, marker, idleSeconds),
    timeoutSec: 5,
    comment: marker
  }
}

function upsertManagedHook(text: string, hookName: CopilotHookName, hook: CopilotHookEntry): string {
  const config = parseCopilotConfig(text)
  const currentHooks = getHookEntries(config, hookName)
  const nextHooks = currentHooks.filter((entry) => !isManagedHook(entry, hook.comment ?? ""))
  nextHooks.push(hook)
  return updateJsoncPath(text, ["hooks", hookName], nextHooks)
}

function removeManagedHook(text: string, hookName: CopilotHookName, marker: string): string {
  const config = parseCopilotConfig(text)
  if (config.hooks?.[hookName] === undefined) {
    return text
  }

  const currentHooks = getHookEntries(config, hookName)
  const nextHooks = currentHooks.filter((entry) => !isManagedHook(entry, marker))
  let nextText = nextHooks.length > 0
    ? updateJsoncPath(text, ["hooks", hookName], nextHooks)
    : updateJsoncPath(text, ["hooks", hookName], undefined)

  const nextConfig = parseCopilotConfig(nextText)
  const hooks = nextConfig.hooks ?? {}
  if (Object.keys(hooks).length === 0) {
    nextText = updateJsoncPath(nextText, ["hooks"], undefined)
  }

  return nextText
}

function findManagedHook(config: CopilotConfig, hookName: CopilotHookName, marker: string): CopilotHookEntry | undefined {
  return getHookEntries(config, hookName).find((entry) => isManagedHook(entry, marker))
}

function hasManagedCopilotHooks(config: CopilotConfig): boolean {
  return !!findManagedHook(config, "agentStop", AGENT_STOP_MARKER)
    || !!findManagedHook(config, "sessionEnd", LEGACY_SESSION_END_MARKER)
    || !!findManagedHook(config, "errorOccurred", ERROR_MARKER)
}

function getHookEntries(config: CopilotConfig, hookName: CopilotHookName): CopilotHookEntry[] {
  const hookValue = config.hooks?.[hookName]
  if (hookValue === undefined) return []
  if (!Array.isArray(hookValue)) {
    throw new Error(`Invalid Copilot hooks configuration at ${getCopilotConfigPath()}.`)
  }
  return hookValue
}

function isManagedHook(entry: CopilotHookEntry, marker: string): boolean {
  return entry.comment === marker || entry.bash?.includes(marker) === true
}

function updateJsoncPath(text: string, path: (string | number)[], value: unknown): string {
  const edits = modify(text, path, value, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
      eol: "\n"
    },
    isArrayInsertion: false
  })
  return applyEdits(text, edits)
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

function normalizeConfigText(text: string | null): string {
  return text?.trim() ? text : "{}\n"
}

function normalizeText(value: string): string {
  return value.replace(/\s+$/, "")
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`
}

function canDeleteConfigFile(config: CopilotConfig): boolean {
  const hooks = config.hooks ?? {}
  if (Object.keys(hooks).length > 0) return false

  return Object.keys(config).every((key) => key === "version" || key === "hooks")
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
}
