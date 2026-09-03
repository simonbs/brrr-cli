import { describe, expect, test, vi } from "vitest"
import { dispatchCommand } from "../src/commands/agent/dispatch.js"

async function dispatchCodexWithStdin(event: "needs-approval", payload: unknown): Promise<void> {
  const stdinChunks = [JSON.stringify(payload)]
  const originalStdin = process.stdin
  const stdin = Object.assign(stdinChunks, {
    async *[Symbol.asyncIterator]() {
      for (const chunk of stdinChunks) yield chunk
    }
  })
  Object.defineProperty(process, "stdin", {
    value: stdin,
    configurable: true
  })

  try {
    await dispatchCommand({
      agent: "codex",
      event,
      webhook: "https://api.brrr.now/v1/br_test"
    })
  } finally {
    Object.defineProperty(process, "stdin", {
      value: originalStdin,
      configurable: true
    })
  }
}

describe("dispatch", () => {
  test("codex hook failures do not throw on transport failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(dispatchCommand({
      agent: "codex",
      event: "finished",
      webhook: "https://api.brrr.now/v1/br_test",
      payloadJson: JSON.stringify({
        cwd: "/tmp/project",
        "last-assistant-message": "Done"
      })
    })).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalled()
  })

  test("skips title-only Codex assistant JSON", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await dispatchCommand({
      agent: "codex",
      event: "finished",
      webhook: "https://api.brrr.now/v1/br_test",
      payloadJson: JSON.stringify({
        cwd: "/tmp/project",
        "last-assistant-message": "{\"title\":\"Fix duplicate shared text\"}"
      })
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("sends Codex permission request notifications", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true })
    })
    vi.stubGlobal("fetch", fetchMock)

    await dispatchCodexWithStdin("needs-approval", {
      cwd: "/tmp/project",
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: {
        description: "Run tests",
        command: "npm test"
      }
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(body.title).toBe("Codex needs approval")
    expect(body.message).toBe("Codex needs approval to use Bash: Run tests")
  })
})
