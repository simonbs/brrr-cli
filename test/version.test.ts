import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { getCliVersion } from "../src/utils/version.js"

describe("getCliVersion", () => {
  test("resolves the package version above the built cli entrypoint", async () => {
    const packageRoot = await mkdtemp(join(tmpdir(), "brrr-version-test-"))
    const cliDirectory = join(packageRoot, "dist", "src")

    await mkdir(cliDirectory, { recursive: true })
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ version: "1.2.3" }), "utf8")
    await writeFile(join(cliDirectory, "cli.js"), "", "utf8")

    expect(getCliVersion(join(cliDirectory, "cli.js"))).toBe("1.2.3")
  })

  test("throws when no package.json with a version can be found", async () => {
    const packageRoot = await mkdtemp(join(tmpdir(), "brrr-version-missing-"))
    const cliDirectory = join(packageRoot, "dist", "src")

    await mkdir(cliDirectory, { recursive: true })
    await writeFile(join(cliDirectory, "cli.js"), "", "utf8")

    expect(() => getCliVersion(join(cliDirectory, "cli.js"))).toThrow(
      "Unable to resolve the current brrr CLI version."
    )
  })
})
