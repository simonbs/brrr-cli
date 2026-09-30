import { describe, expect, test } from "vitest"
import {
  buildCodexApprovalPayload,
  buildCodexFinishedPayload,
  buildCodexHookCommand,
  installCodex, uninstallCodex, readCodexInstallState, getCodexConfigPath, getCodexHooksPath
} from "../src/agent/config/codex-config.js"
import { parseWebhookRef } from "../src/agent/webhook-ref.js"
import { getAgentIconUrl } from "../src/agent/icons.js"
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises"
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

  async function setup() {
    const home = await mkdtemp(join(tmpdir(), "brrr-codex-home-"))
    process.env.CODEX_HOME = home
    return home
  }

  const options = { webhook: parseWebhookRef("https://api.brrr.now/v1/br_test"), idleSeconds: 20 }
  const legacyBlock = [
    "# brrr agent integration start",
    '# brrr original notify json: ["/Users/test/notify","turn-ended"]',
    'notify = ["brrr", "agent", "dispatch", "--agent", "codex", "--event", "finished", "--webhook", "https://api.brrr.now/v1/br_test", "--payload-json"]',
    "# brrr agent integration end"
  ].join("\n")

  test("installs both hooks using CODEX_HOME without creating TOML", async () => {
    const home = await setup()
    await installCodex(options)
    expect(getCodexHooksPath()).toBe(join(home, "hooks.json"))
    await expect(stat(getCodexConfigPath())).rejects.toMatchObject({ code: "ENOENT" })
    const config = JSON.parse(await readFile(getCodexHooksPath(), "utf8"))
    expect(config.hooks.Stop[0].hooks[0]).toMatchObject({ type: "command", async: true, timeout: 5 })
    expect(config.hooks.Stop[0].hooks[0].command).toContain("--event finished")
    expect(config.hooks.PermissionRequest[0].hooks[0].command).toContain("--event needs-approval")
    expect(await readCodexInstallState()).toMatchObject({ installed: true, configPath: getCodexHooksPath(), idleSeconds: 20, webhookRef: "https://api.brrr.now/v1/br_test" })
  })

  test("leaves existing TOML and notify byte-for-byte unchanged", async () => {
    await setup()
    const text = 'model = "gpt-5.4"\nnotify = ["custom"]\n\n[mcp_servers.test]\nenabled = true\n'
    await writeFile(getCodexConfigPath(), text)
    await installCodex(options)
    await uninstallCodex()
    expect(await readFile(getCodexConfigPath(), "utf8")).toBe(text)
  })

  test("skips matching hooks regardless of formatting or property order without backups or writes", async () => {
    const home = await setup()
    await installCodex(options)
    const config = JSON.parse(await readFile(getCodexHooksPath(), "utf8"))
    config.hooks.Stop[0].hooks[0] = Object.fromEntries(Object.entries(config.hooks.Stop[0].hooks[0]).reverse())
    const text = JSON.stringify(config)
    await writeFile(getCodexHooksPath(), text)
    const before = await stat(getCodexHooksPath())
    expect(await installCodex(options)).toEqual({ changed: false, message: "already configured" })
    expect(await readFile(getCodexHooksPath(), "utf8")).toBe(text)
    expect((await stat(getCodexHooksPath())).mtimeMs).toBe(before.mtimeMs)
    expect(await readdir(home)).toEqual(["hooks.json"])
  })

  test("repairs missing, outdated, altered, and duplicate hooks while preserving unrelated data", async () => {
    await setup()
    await installCodex(options)
    const config = JSON.parse(await readFile(getCodexHooksPath(), "utf8"))
    config.description = "My hooks"
    const oldStop = config.hooks.Stop[0].hooks[0]
    oldStop.command = oldStop.command.replace("stop:v1", "stop:v0")
    oldStop.async = false
    config.hooks.Stop.push({ matcher: "unexpected", hooks: [oldStop, { type: "command", command: "echo custom", extra: true }] })
    delete config.hooks.PermissionRequest
    await writeFile(getCodexHooksPath(), JSON.stringify(config))
    expect((await readCodexInstallState()).installed).toBe(false)
    const result = await installCodex({ ...options, idleSeconds: 300, webhook: parseWebhookRef("${BRRR_WEBHOOK_URL}") })
    expect(result).toMatchObject({ changed: true, message: "reinstalled" })
    expect(result.backupPath).toContain("hooks.json.brrr-backup-")
    const repaired = JSON.parse(await readFile(getCodexHooksPath(), "utf8"))
    expect(repaired.description).toBe("My hooks")
    expect(repaired.hooks.Stop[0]).toEqual({ matcher: "unexpected", hooks: [{ type: "command", command: "echo custom", extra: true }] })
    expect(JSON.stringify(repaired)).not.toContain("stop:v0")
    expect(repaired.hooks.Stop[1].hooks[0].command).toContain("--idle-seconds 300")
    expect((await readCodexInstallState()).webhookRef).toBe("${BRRR_WEBHOOK_URL}")
    expect((await installCodex({ ...options, idleSeconds: 300, webhook: parseWebhookRef("${BRRR_WEBHOOK_URL}") })).changed).toBe(false)
    await uninstallCodex()
    expect(JSON.parse(await readFile(getCodexHooksPath(), "utf8"))).toEqual({ description: "My hooks", hooks: { Stop: [repaired.hooks.Stop[0]] } })
  })

  test.each(["install", "uninstall"])("%s cleans legacy TOML and restores saved notify before tables", async operation => {
    await setup()
    await writeFile(getCodexConfigPath(), `model = "gpt-5.4"\n\n${legacyBlock}\n\n[mcp_servers.test]\nenabled = true\n`)
    const result = operation === "install" ? await installCodex(options) : await uninstallCodex()
    expect(result.changed).toBe(true)
    expect(await readFile(result.backupPath!, "utf8")).toContain(legacyBlock)
    const restored = await readFile(getCodexConfigPath(), "utf8")
    expect(restored).not.toContain("brrr agent integration")
    expect(restored.indexOf('notify = ["/Users/test/notify", "turn-ended"]')).toBeLessThan(restored.indexOf("[mcp_servers.test]"))
    if (operation === "install") expect((await installCodex(options)).changed).toBe(false)
  })

  test("migrates legacy notify without a saved command and preserves a newer notify", async () => {
    await setup()
    await writeFile(getCodexConfigPath(), legacyBlock.replace(/^# brrr original notify json: .*\n/m, "") + "\n")
    await installCodex(options)
    expect(await readFile(getCodexConfigPath(), "utf8")).toBe("")
    await writeFile(getCodexConfigPath(), `notify = ['new-command']\n${legacyBlock}\n`)
    await installCodex(options)
    expect(await readFile(getCodexConfigPath(), "utf8")).toBe("notify = ['new-command']\n")
  })

  const legacyArgs = ["brrr", "agent", "dispatch", "--agent", "codex", "--event", "finished", "--webhook", "$BRRR_WEBHOOK_URL", "--idle-seconds", "20", "--payload-json"]
  const computerUseArgs = ["/Users/simonbs/.codex/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient", "turn-ended"]
  const notifyLine = (args: string[]) => `notify = ${JSON.stringify(args)}\n`

  test.each(["install", "uninstall"])("%s removes the reported nested brrr notify and preserves Computer Use", async operation => {
    await setup()
    const current = notifyLine([...computerUseArgs, "--previous-notify", JSON.stringify(legacyArgs)])
    const suffix = '# Keep this comment\n[mcp_servers.test]\nenabled = true\n'
    await writeFile(getCodexConfigPath(), current + suffix)
    // Exercise TOML cleanup even when the JSON hooks are already current.
    if (operation === "install") await installCodex(options)
    await writeFile(getCodexConfigPath(), current + suffix)
    const hooksBefore = operation === "install" ? await stat(getCodexHooksPath()) : undefined
    const result = operation === "install" ? await installCodex(options) : await uninstallCodex()
    expect(result.changed).toBe(true)
    expect(await readFile(result.backupPath!, "utf8")).toBe(current + suffix)
    expect(await readFile(getCodexConfigPath(), "utf8")).toBe(`notify = [${computerUseArgs.map(arg => JSON.stringify(arg)).join(", ")}]\n${suffix}`)
    if (operation === "install") {
      expect((await stat(getCodexHooksPath())).mtimeMs).toBe(hooksBefore!.mtimeMs)
      expect((await installCodex(options)).changed).toBe(false)
    } else expect((await uninstallCodex()).changed).toBe(false)
  })

  test("preserves Computer Use when its wrapper is inside brrr's original marked block", async () => {
    await setup()
    const wrapper = notifyLine([...computerUseArgs, "--previous-notify", JSON.stringify(legacyArgs)]).trimEnd()
    await writeFile(getCodexConfigPath(), legacyBlock.replace(/^notify = .*$/m, wrapper) + "\n")
    await installCodex(options)
    const restored = (await import("smol-toml")).parse(await readFile(getCodexConfigPath(), "utf8")).notify as string[]
    expect(restored).toEqual([...computerUseArgs, "--previous-notify", JSON.stringify(["/Users/test/notify", "turn-ended"])])
  })

  test("cleans multiple wrapper layers and restores brrr's own previous notifier", async () => {
    await setup()
    const original = ["/usr/local/bin/custom-notifier", "--argument", "keep me"]
    const chainedBrrr = [...legacyArgs, "--previous-notify", JSON.stringify(original)]
    const inner = ["inner-wrapper", "--previous-notify", JSON.stringify(chainedBrrr)]
    const outer = [...computerUseArgs, "--previous-notify", JSON.stringify(inner)]
    await writeFile(getCodexConfigPath(), notifyLine(outer))
    await installCodex(options)
    const restored = (await import("smol-toml")).parse(await readFile(getCodexConfigPath(), "utf8")).notify as string[]
    expect(restored.slice(0, 2)).toEqual(computerUseArgs)
    expect(JSON.parse(restored[3])).toEqual(["inner-wrapper", "--previous-notify", JSON.stringify(original)])
    expect((await installCodex(options)).changed).toBe(false)
  })

  test("cleans unmarked direct brrr notifications and restores any chained custom notifier", async () => {
    await setup()
    await writeFile(getCodexConfigPath(), notifyLine(legacyArgs))
    await installCodex(options)
    expect(await readFile(getCodexConfigPath(), "utf8")).not.toContain("notify")
    const original = ["custom-notifier", "turn-ended"]
    await writeFile(getCodexConfigPath(), notifyLine([...legacyArgs, "--previous-notify", JSON.stringify(original)]))
    await installCodex(options)
    expect(await readFile(getCodexConfigPath(), "utf8")).toBe('notify = ["custom-notifier", "turn-ended"]\n')
  })

  test("supports multiline TOML arrays with literal strings, comments, and trailing commas", async () => {
    await setup()
    const text = `notify = [\n  '${computerUseArgs[0]}', # ] should be ignored\n  'turn-ended',\n  '--previous-notify',\n  '${JSON.stringify(legacyArgs)}',\n] # preserve this comment\nmodel = "test"\n`
    await writeFile(getCodexConfigPath(), text)
    await installCodex(options)
    const cleaned = await readFile(getCodexConfigPath(), "utf8")
    expect(cleaned).toContain('# preserve this comment\nmodel = "test"\n')
    expect((await import("smol-toml")).parse(cleaned).notify).toEqual(computerUseArgs)
  })

  test.each([
    [...computerUseArgs, "--previous-notify", JSON.stringify(["other", "--message", "brrr"])],
    [...computerUseArgs, "--previous-notify", "invalid JSON"],
    [...computerUseArgs, "--previous-notify", JSON.stringify({ command: "brrr" })],
    ["brrr", "agent", "dispatch", "--agent", "claude", "--event", "finished"],
    ["brrr", "send", "--message", "hello"]
  ])("leaves unrelated or malformed notify chains untouched: %j", async (...args) => {
    await setup()
    const text = notifyLine(args as string[])
    await writeFile(getCodexConfigPath(), text)
    await installCodex(options)
    expect(await readFile(getCodexConfigPath(), "utf8")).toBe(text)
  })

  test("ignores notify assignments in multiline strings and nested TOML tables", async () => {
    await setup()
    const fake = notifyLine(legacyArgs)
    const text = `instructions = """\n${fake}"""\n[mcp_servers.test]\n${fake}`
    await writeFile(getCodexConfigPath(), text)
    await installCodex(options)
    expect(await readFile(getCodexConfigPath(), "utf8")).toBe(text)
  })

  test.each(['{', '[]', '{"hooks":[]}', '{"hooks":{"Stop":{}}}', '{"hooks":{"Stop":[{"hooks":[null]}]}}'])("rejects invalid JSON shape without modifying either file: %s", async text => {
    const home = await setup()
    await writeFile(getCodexHooksPath(), text)
    await writeFile(getCodexConfigPath(), legacyBlock)
    await expect(installCodex(options)).rejects.toThrow("Invalid Codex hooks configuration")
    await expect(uninstallCodex()).rejects.toThrow("Invalid Codex hooks configuration")
    expect(await readFile(getCodexHooksPath(), "utf8")).toBe(text)
    expect(await readFile(getCodexConfigPath(), "utf8")).toBe(legacyBlock)
    expect((await readdir(home)).sort()).toEqual(["config.toml", "hooks.json"])
  })

  test("uninstalls JSON hooks without creating TOML and skips a second uninstall", async () => {
    await setup()
    await installCodex(options)
    await uninstallCodex()
    expect(await readFile(getCodexHooksPath(), "utf8")).toBe("{}\n")
    await expect(stat(getCodexConfigPath())).rejects.toMatchObject({ code: "ENOENT" })
    expect(await uninstallCodex()).toEqual({ changed: false, message: "not installed" })
    expect((await readCodexInstallState()).installed).toBe(false)
  })
})
