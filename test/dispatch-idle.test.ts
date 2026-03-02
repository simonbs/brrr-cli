import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("../src/agent/idle.js", () => ({
  shouldSkipNotificationForIdleThreshold: vi.fn()
}))

describe("dispatch idle gating", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  test("skips webhook delivery when idle threshold is not met", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const idleModule = await import("../src/agent/idle.js")
    vi.mocked(idleModule.shouldSkipNotificationForIdleThreshold).mockResolvedValue(true)

    const { dispatchCommand } = await import("../src/commands/agent/dispatch.js")
    await dispatchCommand({
      agent: "codex",
      event: "finished",
      webhook: "https://api.brr.now/v1/br_test",
      idleSeconds: 300,
      payloadJson: JSON.stringify({
        cwd: "/tmp/project",
        "last-assistant-message": "Done"
      })
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
