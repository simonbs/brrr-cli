import type { AgentAdapter } from "../../agent/adapters/types.js"
import { formatStatuses, readStatuses } from "../../agent/status.js"

export async function statusCommand(adapters: AgentAdapter[]): Promise<void> {
  const statuses = await readStatuses(adapters)
  console.log(formatStatuses(statuses))
}
