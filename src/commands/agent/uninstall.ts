import type { AgentAdapter } from "../../agent/adapters/types.js"
import { formatHomeRelativePath } from "../../utils/output.js"

export async function uninstallCommand(
  adapters: AgentAdapter[],
  target: string
): Promise<void> {
  const selectedAdapters = selectAdapters(adapters, target)
  for (const adapter of selectedAdapters) {
    const result = await adapter.uninstall()
    const backupSuffix = result.backupPath
      ? ` (backup created at ${formatHomeRelativePath(result.backupPath)})`
      : ""
    console.log(`${adapter.id}: ${result.message}${backupSuffix}`)
  }
}

function selectAdapters(adapters: AgentAdapter[], target: string): AgentAdapter[] {
  if (target === "all") return adapters
  const adapter = adapters.find((candidate) => candidate.id === target)
  if (!adapter) throw new Error(`Unsupported agent: ${target}`)
  return [adapter]
}
