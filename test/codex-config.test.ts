import { describe, expect, test } from "vitest"
import {
  buildCodexFinishedPayload,
  buildCodexManagedBlock,
  extractWebhookFromCodexBlock
} from "../src/agent/config/codex-config.js"
import { parseWebhookRef } from "../src/agent/webhook-ref.js"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, vi } from "vitest"

const originalHome = process.env.HOME

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
})

describe("codex config generation", () => {
  test("generates managed block", () => {
    const block = buildCodexManagedBlock(parseWebhookRef("https://api.brrr.now/v1/br_test"))
    expect(block).toContain("# brrr agent integration start")
    expect(block).toContain("notify = [")
    expect(block).toContain("\"brrr\"")
    expect(block).toContain("\"agent\"")
    expect(block).toContain("\"--payload-json\"")
    expect(extractWebhookFromCodexBlock(block)).toBe("https://api.brrr.now/v1/br_test")
  })

  test("includes idle threshold when configured", () => {
    const block = buildCodexManagedBlock(parseWebhookRef("https://api.brrr.now/v1/br_test"), 300)
    expect(block).toContain("\"--idle-seconds\", \"300\"")
  })

  test("stores original notify in a comment", () => {
    const block = buildCodexManagedBlock(
      parseWebhookRef("https://api.brrr.now/v1/br_test"),
      300,
      ["/Applications/Test.app/Contents/MacOS/test", "turn-ended"]
    )

    expect(block).toContain("# brrr original notify json:")
    expect(block).not.toContain("\"--previous-notify\"")
  })

  test("preserves env refs", () => {
    const block = buildCodexManagedBlock(parseWebhookRef("${BRRR_WEBHOOK_URL}"))
    expect(extractWebhookFromCodexBlock(block)).toBe("${BRRR_WEBHOOK_URL}")
  })

  test("builds default notification text", () => {
    expect(buildCodexFinishedPayload("/tmp/project", "Done")).toEqual({
      title: "Codex finished",
      message: "Done"
    })
  })

  test("installs notify at top level before existing tables", async () => {
    const home = await mkdtemp(join(tmpdir(), "brrr-codex-home-"))
    process.env.HOME = home
    vi.resetModules()

    const configDir = join(home, ".codex")
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, "config.toml"), [
      'model = "gpt-5.3-codex"',
      "",
      "[mcp_servers.figma]",
      'url = "https://mcp.figma.com/mcp"',
      "enabled = false",
      ""
    ].join("\n"), "utf8")

    const { installCodex, getCodexConfigPath } = await import("../src/agent/config/codex-config.js")
    await installCodex({ webhook: parseWebhookRef("https://api.brrr.now/v1/br_test") })
    const config = await readFile(getCodexConfigPath(), "utf8")

    expect(config).toMatch(/# brrr agent integration start\nnotify = \[.*"--webhook".*\]\n# brrr agent integration end\n\n\[mcp_servers\.figma\]/s)
  })

  test("replaces existing notify, saves it in a comment, and restores it on uninstall", async () => {
    const home = await mkdtemp(join(tmpdir(), "brrr-codex-home-"))
    process.env.HOME = home
    vi.resetModules()

    const configDir = join(home, ".codex")
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, "config.toml"), [
      'model = "gpt-5.4"',
      'notify = ["/Users/test/notify", "turn-ended"]',
      ""
    ].join("\n"), "utf8")

    const { installCodex, uninstallCodex, getCodexConfigPath } = await import("../src/agent/config/codex-config.js")
    await installCodex({ webhook: parseWebhookRef("https://api.brrr.now/v1/br_test"), idleSeconds: 20 })
    const installedConfig = await readFile(getCodexConfigPath(), "utf8")

    expect(installedConfig).toContain("# brrr original notify json: [\"/Users/test/notify\",\"turn-ended\"]")
    expect(installedConfig).toContain("\"brrr\", \"agent\", \"dispatch\"")
    expect(installedConfig).not.toContain("\"--previous-notify\"")
    expect(installedConfig).not.toContain('notify = ["/Users/test/notify", "turn-ended"]')

    await uninstallCodex()
    const restoredConfig = await readFile(getCodexConfigPath(), "utf8")

    expect(restoredConfig).toContain('notify = ["/Users/test/notify", "turn-ended"]')
    expect(restoredConfig).not.toContain("# brrr agent integration start")
  })
})
