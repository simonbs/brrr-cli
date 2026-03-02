import type { AgentAdapter } from "../../agent/adapters/types.js"
import { parseWebhookRef } from "../../agent/webhook-ref.js"
import { formatAgentOperationResults } from "../../utils/output.js"

export async function installCommand(
  adapters: AgentAdapter[],
  target: string,
  webhook: string,
  idleSeconds?: number
): Promise<void> {
  const selectedAdapters = selectAdapters(adapters, target)
  const webhookRef = parseWebhookRef(webhook)
  const rows: Array<{ agent: string, status: string, backupPath?: string }> = []

  for (const adapter of selectedAdapters) {
    const result = await adapter.install({ webhook: webhookRef, idleSeconds })
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
