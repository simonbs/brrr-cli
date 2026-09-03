import { describe, expect, test } from "vitest"
import {
  buildCodexApprovalPayload,
  buildCodexFinishedPayload,
  buildCodexHookCommand,
  buildCodexManagedBlock,
  extractWebhookFromCodexBlock
} from "../src/agent/config/codex-config.js"
import { parseWebhookRef } from "../src/agent/webhook-ref.js"
import { getAgentIconUrl } from "../src/agent/icons.js"
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, vi } from "vitest"

const originalHome = process.env.HOME
const originalCodexHome = process.env.CODEX_HOME

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }

  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME
  } else {
    process.env.CODEX_HOME = originalCodexHome
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

  test("generates permission request hook command", () => {
    const command = buildCodexHookCommand(
      "needs-approval",
      parseWebhookRef("https://api.brrr.now/v1/br_test"),
      "marker",
      300
    )

    expect(command).toContain("agent dispatch")
    expect(command).toContain("--agent codex")
    expect(command).toContain("--event needs-approval")
    expect(command).toContain("--webhook 'https://api.brrr.now/v1/br_test'")
    expect(command).toContain("--idle-seconds 300")
    expect(command).toContain("# marker")
  })

  test("builds default notification text", () => {
    expect(buildCodexFinishedPayload("/tmp/project", "Done")).toEqual({
      title: "Codex finished",
      message: "Done",
      icon_url: getAgentIconUrl("codex")
    })
    expect(buildCodexApprovalPayload("/tmp/project")).toEqual({
      title: "Codex needs approval",
      message: "Codex is waiting for approval in 'project'.",
      icon_url: getAgentIconUrl("codex")
    })
  })

  test("skips title-only Codex assistant JSON", () => {
    expect(buildCodexFinishedPayload("/tmp/project", "{\"title\":\"Fix duplicate shared text\"}")).toBeUndefined()
  })

  test("keeps Codex assistant messages that only look like JSON", () => {
    expect(buildCodexFinishedPayload("/tmp/project", "{\"summary\":\"Done\"}")).toEqual({
      title: "Codex finished",
      message: "{\"summary\":\"Done\"}",
      icon_url: getAgentIconUrl("codex")
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

  test("uses CODEX_HOME for config and hooks", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "brrr-codex-home-"))
    process.env.CODEX_HOME = codexHome
    vi.resetModules()

    const { installCodex, getCodexConfigPath, getCodexHooksPath } = await import("../src/agent/config/codex-config.js")
    await installCodex({ webhook: parseWebhookRef("https://api.brrr.now/v1/br_test") })

    expect(getCodexConfigPath()).toBe(join(codexHome, "config.toml"))
    expect(getCodexHooksPath()).toBe(join(codexHome, "hooks.json"))
    expect(await readFile(getCodexConfigPath(), "utf8")).toContain("notify = [")
    expect(await readFile(getCodexHooksPath(), "utf8")).toContain("\"PermissionRequest\"")
  })

  test("installs and uninstalls permission request hook without dropping existing hooks", async () => {
    const home = await mkdtemp(join(tmpdir(), "brrr-codex-home-"))
    process.env.HOME = home
    vi.resetModules()

    const configDir = join(home, ".codex")
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, "hooks.json"), JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "echo existing" }]
          }
        ]
      }
    }, null, 2), "utf8")

    const { installCodex, uninstallCodex, getCodexHooksPath } = await import("../src/agent/config/codex-config.js")
    await installCodex({ webhook: parseWebhookRef("https://api.brrr.now/v1/br_test"), idleSeconds: 20 })
    const installedHooks = await readFile(getCodexHooksPath(), "utf8")

    expect(installedHooks).toContain("\"PreToolUse\"")
    expect(installedHooks).toContain("\"echo existing\"")
    expect(installedHooks).toContain("\"PermissionRequest\"")
    expect(installedHooks).toContain("brrr:codex:permissionrequest:v1")

    await uninstallCodex()
    const restoredHooks = await readFile(getCodexHooksPath(), "utf8")

    expect(restoredHooks).toContain("\"PreToolUse\"")
    expect(restoredHooks).toContain("\"echo existing\"")
    expect(restoredHooks).not.toContain("\"PermissionRequest\"")
    expect(restoredHooks).not.toContain("brrr:codex:permissionrequest:v1")
  })

  test("uninstalls hook-only partial installs without creating config.toml", async () => {
    const home = await mkdtemp(join(tmpdir(), "brrr-codex-home-"))
    process.env.HOME = home
    vi.resetModules()

    const configDir = join(home, ".codex")
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, "hooks.json"), JSON.stringify({
      hooks: {
        PermissionRequest: [
          {
            hooks: [
              {
                type: "command",
                command: "brrr agent dispatch --agent codex --event needs-approval --webhook https://api.brrr.now/v1/br_test # brrr:codex:permissionrequest:v1"
              }
            ]
          }
        ]
      }
    }, null, 2), "utf8")

    const { uninstallCodex, getCodexConfigPath, getCodexHooksPath } = await import("../src/agent/config/codex-config.js")
    await uninstallCodex()
    const restoredHooks = await readFile(getCodexHooksPath(), "utf8")

    await expect(stat(getCodexConfigPath())).rejects.toMatchObject({ code: "ENOENT" })
    expect(restoredHooks).toBe("{}\n")
  })
})
