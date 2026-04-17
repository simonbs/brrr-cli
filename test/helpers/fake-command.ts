import { chmod, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"

export async function addFakeCommandToPath(command: string): Promise<void> {
  const binDir = await mkdtemp(join(tmpdir(), "brrr-test-bin-"))
  const commandPath = join(binDir, command)

  await writeFile(commandPath, "#!/bin/sh\nexit 0\n", "utf8")
  await chmod(commandPath, 0o755)

  process.env.PATH = process.env.PATH
    ? `${binDir}${delimiter}${process.env.PATH}`
    : binDir
}
