import { readFile, writeFile } from "node:fs/promises"

export async function createBackup(path: string): Promise<string> {
  const timestamp = new Date().toISOString().replaceAll(":", "-")
  const backupPath = `${path}.brrr-backup-${timestamp}`
  const content = await readFile(path, "utf8")
  await writeFile(backupPath, content, "utf8")
  return backupPath
}
