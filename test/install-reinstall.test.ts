import { afterEach, describe, expect, test, vi } from "vitest"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseWebhookRef } from "../src/agent/webhook-ref.js"

const originalHome = process.env.HOME

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
})

describe("install command behavior", () => {
  test("claude install reinstalls when brrr hooks already exist", async () => {
    const home = await mkdtemp(join(tmpdir(), "brrr-claude-home-"))
    process.env.HOME = home
    vi.resetModules()

    const { installClaude, getClaudeConfigPath } = await import("../src/agent/config/claude-settings.js")

    const first = await installClaude({ webhook: parseWebhookRef("https://api.brr.now/v1/br_test") })
    const second = await installClaude({ webhook: parseWebhookRef("https://api.brr.now/v1/br_test") })

    expect(first.message).toBe("installed")
    expect(first.backupPath).toBeUndefined()
    expect(second.message).toBe("reinstalled")
    expect(second.changed).toBe(true)
    expect(second.backupPath).toContain(".brrr-backup-")
    expect(await readFile(getClaudeConfigPath(), "utf8")).toContain("\"Stop\"")
  })

  test("codex install reinstalls when brrr notify already exists", async () => {
    const home = await mkdtemp(join(tmpdir(), "brrr-codex-home-"))
    process.env.HOME = home
    vi.resetModules()

    const { installCodex, getCodexConfigPath } = await import("../src/agent/config/codex-config.js")

    const first = await installCodex({ webhook: parseWebhookRef("https://api.brr.now/v1/br_test") })
    const second = await installCodex({ webhook: parseWebhookRef("https://api.brr.now/v1/br_test") })

    expect(first.message).toBe("installed")
    expect(first.backupPath).toBeUndefined()
    expect(second.message).toBe("reinstalled")
    expect(second.changed).toBe(true)
    expect(second.backupPath).toContain(".brrr-backup-")
    expect(await readFile(getCodexConfigPath(), "utf8")).toContain("notify = [")
  })
})
