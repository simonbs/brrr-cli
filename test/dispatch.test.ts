import { describe, expect, test, vi } from "vitest"
import { dispatchCommand } from "../src/commands/agent/dispatch.js"

describe("dispatch", () => {
  test("codex hook failures do not throw on transport failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(dispatchCommand({
      agent: "codex",
      event: "finished",
      webhook: "https://api.brr.now/v1/br_test",
      payloadJson: JSON.stringify({
        cwd: "/tmp/project",
        "last-assistant-message": "Done"
      })
    })).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalled()
  })
})
