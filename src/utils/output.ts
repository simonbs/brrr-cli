import { homedir } from "node:os"

export function formatHomeRelativePath(path: string): string {
  const home = homedir()
  if (path === home) return "~"
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`
  return path
}
