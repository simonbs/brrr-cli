import { existsSync, readFileSync } from "node:fs"
import { dirname, join, parse, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export function getCliVersion(scriptPath = process.argv[1], moduleUrl = import.meta.url): string {
  const entryPath = scriptPath ? resolve(scriptPath) : fileURLToPath(moduleUrl)

  for (const directory of candidateDirectories(dirname(entryPath))) {
    const packageJsonPath = join(directory, "package.json")
    if (!existsSync(packageJsonPath)) {
      continue
    }

    const rawPackageJson = readFileSync(packageJsonPath, "utf8")
    const parsedPackageJson = JSON.parse(rawPackageJson) as { version?: unknown }
    if (typeof parsedPackageJson.version === "string" && parsedPackageJson.version.length > 0) {
      return parsedPackageJson.version
    }
  }

  throw new Error("Unable to resolve the current brrr CLI version.")
}

function candidateDirectories(startDirectory: string): string[] {
  const directories: string[] = []
  let currentDirectory = startDirectory
  const rootDirectory = parse(startDirectory).root

  while (true) {
    directories.push(currentDirectory)
    if (currentDirectory === rootDirectory) {
      return directories
    }

    currentDirectory = dirname(currentDirectory)
  }
}
