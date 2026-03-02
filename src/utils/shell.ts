import { access } from "node:fs/promises"
import { constants } from "node:fs"
import { delimiter, join } from "node:path"

export async function commandExists(command: string, envPath: string | undefined = process.env.PATH): Promise<boolean> {
  if (!envPath) return false

  for (const basePath of envPath.split(delimiter)) {
    if (!basePath) continue
    const candidate = join(basePath, command)
    try {
      await access(candidate, constants.X_OK)
      return true
    } catch {
      // Continue.
    }
  }

  return false
}
