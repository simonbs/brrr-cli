import { describe, expect, test, vi } from "vitest"
import { dispatchCommand } from "../src/commands/agent/dispatch.js"

describe("claude dispatch", () => {
  test("uses Claude last_assistant_message for finished notifications", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true })
    })
    vi.stubGlobal("fetch", fetchMock)

    const stdinChunks = [JSON.stringify({
      cwd: "/tmp/brrr-cli",
      last_assistant_message: "I finished the implementation and updated the tests.",
      stop_hook_active: false
    })]
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
        agent: "claude",
        event: "finished",
        webhook: "https://api.brrr.now/v1/br_test"
      })
    } finally {
      Object.defineProperty(process, "stdin", {
        value: originalStdin,
        configurable: true
      })
    }

    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(body.title).toBe("Claude finished")
    expect(body.message).toBe("I finished the implementation and updated the tests.")
    expect(body.subtitle).toBeUndefined()
  })

  test("maps AskUserQuestion payload to a useful attention message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true })
    })
    vi.stubGlobal("fetch", fetchMock)

    const stdinChunks = [JSON.stringify({
      cwd: "/tmp/project",
      tool_name: "AskUserQuestion",
      tool_input: {
        question: "Which database should I use?"
      }
    })]
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
        agent: "claude",
        event: "needs-approval",
        webhook: "https://api.brrr.now/v1/br_test"
      })
    } finally {
      Object.defineProperty(process, "stdin", {
        value: originalStdin,
        configurable: true
      })
    }

    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(body.title).toBe("Claude needs approval")
    expect(body.message).toContain("Which database should I use?")
  })
})
