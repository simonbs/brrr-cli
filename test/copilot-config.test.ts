import { afterEach, describe, expect, test, vi } from "vitest"
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  buildCopilotCommand,
  buildCopilotErrorPayload,
  buildCopilotFinishedPayload
} from "../src/agent/config/copilot-config.js"
import { parseWebhookRef } from "../src/agent/webhook-ref.js"

const originalCwd = process.cwd()
const originalPath = process.env.PATH

afterEach(() => {
  process.chdir(originalCwd)
  if (originalPath === undefined) {
    delete process.env.PATH
  } else {
    process.env.PATH = originalPath
  }
})

describe("copilot config generation", () => {
  test("generates finished hook command", () => {
    const command = buildCopilotCommand("finished", parseWebhookRef("https://api.brrr.now/v1/br_test"), "marker")
    expect(command).toContain("command -v brrr >/dev/null 2>&1 || exit 0;")
    expect(command).toContain("brrr agent dispatch")
    expect(command).toContain("agent dispatch")
    expect(command).toContain("--agent copilot")
    expect(command).toContain("--event finished")
    expect(command).toContain("--webhook 'https://api.brrr.now/v1/br_test'")
    expect(command).toContain("# marker")
  })

  test("includes idle threshold when configured", () => {
    const command = buildCopilotCommand("error", parseWebhookRef("https://api.brrr.now/v1/br_test"), "marker", 300)
    expect(command).toContain("--idle-seconds 300")
  })

  test("preserves env refs at runtime", () => {
    const command = buildCopilotCommand("finished", parseWebhookRef("$BRRR_WEBHOOK_URL"), "marker")
    expect(command).toContain("--webhook '$BRRR_WEBHOOK_URL'")
  })

  test("builds default notification text", () => {
    expect(buildCopilotFinishedPayload("/tmp/project")).toEqual({
      title: "Copilot finished",
      message: "Copilot finished working in 'project'."
    })
    expect(buildCopilotErrorPayload("/tmp/project", "Boom")).toEqual({
      title: "Copilot error",
      message: "Boom"
    })
  })

  test("installs hooks into repo hook config without dropping comments", async () => {
    const repo = await mkdtemp(join(tmpdir(), "brrr-copilot-repo-"))
    process.chdir(repo)
    vi.resetModules()

    const configPath = join(repo, ".github", "hooks", "brrr-copilot.json")
    await mkdir(join(repo, ".github", "hooks"), { recursive: true })
    await writeFile(configPath, [
      "{",
      '  "version": 1,',
      "  // keep this comment",
      '  "metadata": "keep"',
      "}",
      ""
    ].join("\n"), "utf8")

    const { installCopilot, getCopilotConfigPath } = await import("../src/agent/config/copilot-config.js")
    await installCopilot({ webhook: parseWebhookRef("https://api.brrr.now/v1/br_test") })
    const config = await readFile(getCopilotConfigPath(), "utf8")

    expect(config).toContain("// keep this comment")
    expect(config).toContain('"version": 1')
    expect(config).toContain('"agentStop"')
    expect(config).toContain('"errorOccurred"')
    expect(config).toContain('"metadata": "keep"')
  })

  test("uses the current working directory for the Copilot hooks file", async () => {
    const repo = await mkdtemp(join(tmpdir(), "brrr-copilot-repo-"))
    process.chdir(repo)
    vi.resetModules()

    const { installCopilot, getCopilotConfigPath } = await import("../src/agent/config/copilot-config.js")
    await installCopilot({ webhook: parseWebhookRef("https://api.brrr.now/v1/br_test") })

    expect(getCopilotConfigPath()).toMatch(/\.github\/hooks\/brrr-copilot\.json$/)
    expect(await readFile(getCopilotConfigPath(), "utf8")).toContain('"hooks"')
  })

  test("skips install when Copilot is not installed and no hook file exists yet", async () => {
    const repo = await mkdtemp(join(tmpdir(), "brrr-copilot-repo-"))
    process.chdir(repo)
    process.env.PATH = ""
    vi.resetModules()

    const { installCopilot, getCopilotConfigPath } = await import("../src/agent/config/copilot-config.js")
    const result = await installCopilot({ webhook: parseWebhookRef("https://api.brrr.now/v1/br_test") })

    expect(result).toEqual({
      changed: false,
      message: "skipped (not installed)"
    })
    await expect(access(getCopilotConfigPath())).rejects.toMatchObject({ code: "ENOENT" })
  })
})
