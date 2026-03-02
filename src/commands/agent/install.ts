import type { AgentAdapter } from "../../agent/adapters/types.js"
import { parseWebhookRef } from "../../agent/webhook-ref.js"
import { formatHomeRelativePath } from "../../utils/output.js"

export async function installCommand(
  adapters: AgentAdapter[],
  target: string,
  webhook: string,
  idleSeconds?: number
): Promise<void> {
  const selectedAdapters = selectAdapters(adapters, target)
  const webhookRef = parseWebhookRef(webhook)

  for (const adapter of selectedAdapters) {
    const result = await adapter.install({ webhook: webhookRef, idleSeconds })
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
