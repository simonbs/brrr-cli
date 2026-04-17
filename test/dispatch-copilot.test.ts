import { describe, expect, test, vi } from "vitest"
import { dispatchCommand } from "../src/commands/agent/dispatch.js"

describe("copilot dispatch", () => {
  test("sends a finished notification for completed sessions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true })
    })
    vi.stubGlobal("fetch", fetchMock)

    const stdinChunks = [JSON.stringify({
      cwd: "/tmp/brrr-cli",
      reason: "complete"
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
        agent: "copilot",
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
    expect(body.title).toBe("Copilot finished")
    expect(body.message).toBe("Copilot finished working in 'brrr-cli'.")
  })

  test("skips non-complete session end notifications", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const stdinChunks = [JSON.stringify({
      cwd: "/tmp/brrr-cli",
      reason: "user_exit"
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
        agent: "copilot",
        event: "finished",
        webhook: "https://api.brrr.now/v1/br_test"
      })
    } finally {
      Object.defineProperty(process, "stdin", {
        value: originalStdin,
        configurable: true
      })
    }

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("sends an error notification with the Copilot error message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true })
    })
    vi.stubGlobal("fetch", fetchMock)

    const stdinChunks = [JSON.stringify({
      cwd: "/tmp/brrr-cli",
      error: {
        message: "Network timeout"
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
        agent: "copilot",
        event: "error",
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
    expect(body.title).toBe("Copilot error")
    expect(body.message).toBe("Network timeout")
  })
})
