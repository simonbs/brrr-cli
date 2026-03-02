import { realpathSync } from "node:fs"
import { resolve } from "node:path"

export function getCliInvocationArgs(): string[] {
  const scriptPath = process.argv[1]
  if (!scriptPath) {
    throw new Error("Unable to resolve the current brrr CLI path.")
  }

  return [process.execPath, realpathSync(resolve(scriptPath))]
}
