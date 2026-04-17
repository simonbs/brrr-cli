import { afterEach, describe, expect, test, vi } from "vitest"
import { dispatchCommand } from "../src/commands/agent/dispatch.js"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

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

  test("uses a Copilot summary-like field when agentStop includes one", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true })
    })
    vi.stubGlobal("fetch", fetchMock)

    const stdinChunks = [JSON.stringify({
      cwd: "/tmp/brrr-cli",
      reason: "complete",
      message: "Implemented the fix and updated the tests."
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
    expect(body.message).toBe("Implemented the fix and updated the tests.")
  })

  test("uses the transcript file when agentStop only includes metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true })
    })
    vi.stubGlobal("fetch", fetchMock)

    const transcriptDir = await mkdtemp(join(tmpdir(), "brrr-copilot-transcript-"))
    const transcriptPath = join(transcriptDir, "events.jsonl")
    await writeFile(transcriptPath, [
      JSON.stringify({ type: "user.message", data: { content: "tell a joke" } }),
      JSON.stringify({ type: "assistant.message", data: { content: "Why did the developer go broke?\n\nBecause they used up all their cache." } })
    ].join("\n"), "utf8")

    const stdinChunks = [JSON.stringify({
      timestamp: 1776422153950,
      cwd: "/tmp/brrr-cli",
      sessionId: "session-1",
      transcriptPath,
      stopReason: "end_turn"
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
    expect(body.message).toBe("Why did the developer go broke?\n\nBecause they used up all their cache.")
  })

  test("ignores an incomplete trailing transcript line and still finds the assistant message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true })
    })
    vi.stubGlobal("fetch", fetchMock)

    const transcriptDir = await mkdtemp(join(tmpdir(), "brrr-copilot-transcript-"))
    const transcriptPath = join(transcriptDir, "events.jsonl")
    await writeFile(transcriptPath, [
      JSON.stringify({ type: "assistant.message", data: { content: "Ship it." } }),
      "{\"type\":\"hook.start\""
    ].join("\n"), "utf8")

    const stdinChunks = [JSON.stringify({
      cwd: "/tmp/brrr-cli",
      transcriptPath,
      stopReason: "end_turn"
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
    expect(body.message).toBe("Ship it.")
  })

  test("skips non-end-turn agentStop notifications", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const stdinChunks = [JSON.stringify({
      cwd: "/tmp/brrr-cli",
      stopReason: "user_exit"
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
