import type { WebhookRef } from "../webhook-ref.js"
import type { SendPayload } from "../transport/payload.js"

export type SupportedAgent = "claude" | "codex" | "copilot"
export type InstalledEvent = "finished" | "needs-approval" | "error"
export type ManualEvent = "finished" | "needs-approval" | "error"

export interface AgentInstallState {
  agent: SupportedAgent
  present: boolean
  installed: boolean
  configPath: string
  webhookRef?: string
  idleSeconds?: number
  supportedEvents: InstalledEvent[]
}

export interface InstallOptions {
  webhook: WebhookRef
  idleSeconds?: number
}

export interface InstallResult {
  changed: boolean
  backupPath?: string
  message: string
}

export interface UninstallResult {
  changed: boolean
  backupPath?: string
  message: string
}

export interface AgentAdapter {
  id: SupportedAgent
  displayName: string
  readInstallState(): Promise<AgentInstallState>
  install(options: InstallOptions): Promise<InstallResult>
  uninstall(): Promise<UninstallResult>
  buildManualDefaults(event: ManualEvent): SendPayload
}
