import { homedir } from "node:os"

export function formatHomeRelativePath(path: string): string {
  const home = homedir()
  if (path === home) return "~"
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`
  return path
}

export function formatAgentOperationResults(
  rows: Array<{ agent: string, status: string, backupPath?: string }>
): string {
  const lines = ["Agent     Status            Backup"]
  for (const row of rows) {
    lines.push([
      pad(row.agent, 9),
      pad(row.status, 17),
      row.backupPath ? formatHomeRelativePath(row.backupPath) : "-"
    ].join(" "))
  }

  return lines.join("\n")
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value.padEnd(width, " ")
}
