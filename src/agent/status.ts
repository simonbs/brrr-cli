import type { AgentAdapter, AgentInstallState } from "./adapters/types.js"
import { formatHomeRelativePath } from "../utils/output.js"

export async function readStatuses(adapters: AgentAdapter[]): Promise<AgentInstallState[]> {
  return Promise.all(adapters.map((adapter) => adapter.readInstallState()))
}

export function formatStatuses(states: AgentInstallState[]): string {
  const lines = ["Agent     Present Installed Idle    Config"]
  for (const state of states) {
    lines.push([
      pad(state.agent, 9),
      pad(state.present ? "yes" : "no", 7),
      pad(state.installed ? "yes" : "no", 9),
      pad(formatIdleThreshold(state.idleSeconds), 7),
      formatHomeRelativePath(state.configPath)
    ].join(" "))
  }

  return lines.join("\n")
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value.padEnd(width, " ")
}

function formatIdleThreshold(value: number | undefined): string {
  return value === undefined ? "-" : `${value}s`
}
