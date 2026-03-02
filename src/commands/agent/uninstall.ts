import type { AgentAdapter } from "../../agent/adapters/types.js"
import { formatAgentOperationResults } from "../../utils/output.js"

export async function uninstallCommand(
  adapters: AgentAdapter[],
  target: string
): Promise<void> {
  const selectedAdapters = selectAdapters(adapters, target)
  const rows: Array<{ agent: string, status: string, backupPath?: string }> = []
  for (const adapter of selectedAdapters) {
    const result = await adapter.uninstall()
    rows.push({ agent: adapter.id, status: result.message, backupPath: result.backupPath })
  }

  console.log(formatAgentOperationResults(rows))
}

function selectAdapters(adapters: AgentAdapter[], target: string): AgentAdapter[] {
  if (target === "all") return adapters
  const adapter = adapters.find((candidate) => candidate.id === target)
  if (!adapter) throw new Error(`Unsupported agent: ${target}`)
  return [adapter]
}
