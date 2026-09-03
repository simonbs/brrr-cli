import { describe, expect, test, vi } from "vitest"
import { dispatchCommand } from "../src/commands/agent/dispatch.js"

async function dispatchClaudeWithStdin(event: "finished" | "needs-approval" | "error", payload: unknown): Promise<void> {
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
      agent: "claude",
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

describe("claude dispatch", () => {
  test("uses Claude last_assistant_message for finished notifications", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true })
    })
    vi.stubGlobal("fetch", fetchMock)

    await dispatchClaudeWithStdin("finished", {
      cwd: "/tmp/brrr-cli",
      last_assistant_message: "I finished the implementation and updated the tests.",
      stop_hook_active: false
    })

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

    await dispatchClaudeWithStdin("needs-approval", {
      cwd: "/tmp/project",
      tool_name: "AskUserQuestion",
      tool_input: {
        question: "Which database should I use?"
      }
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(body.title).toBe("Claude needs approval")
    expect(body.message).toContain("Which database should I use?")
  })

  test("maps current AskUserQuestion questions array to a useful attention message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true })
    })
    vi.stubGlobal("fetch", fetchMock)

    await dispatchClaudeWithStdin("needs-approval", {
      cwd: "/tmp/project",
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [
          {
            question: "Which framework should I use?",
            header: "Framework",
            options: []
          }
        ]
      }
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(body.title).toBe("Claude needs approval")
    expect(body.message).toContain("Which framework should I use?")
  })

  test("sends an immediate permission request notification", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true })
    })
    vi.stubGlobal("fetch", fetchMock)

    await dispatchClaudeWithStdin("needs-approval", {
      session_id: "session-permission",
      cwd: "/tmp/project",
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: {
        command: "npm test"
      }
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(body.title).toBe("Claude needs approval")
    expect(body.message).toBe("Claude needs approval to use Bash: npm test")
  })

  test("skips delayed permission notification after immediate permission request was sent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true })
    })
    vi.stubGlobal("fetch", fetchMock)

    await dispatchClaudeWithStdin("needs-approval", {
      session_id: "session-dedupe",
      cwd: "/tmp/project",
      hook_event_name: "PermissionRequest",
      tool_name: "Bash"
    })
    await dispatchClaudeWithStdin("needs-approval", {
      session_id: "session-dedupe",
      cwd: "/tmp/project",
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
      message: "Claude needs your permission"
    })

    expect(fetchMock).toHaveBeenCalledOnce()
  })

  test("sends elicitation notifications", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true })
    })
    vi.stubGlobal("fetch", fetchMock)

    await dispatchClaudeWithStdin("needs-approval", {
      cwd: "/tmp/project",
      hook_event_name: "Notification",
      notification_type: "elicitation_url_dialog",
      message: "Please authenticate"
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(body.title).toBe("Claude needs approval")
    expect(body.message).toBe("Please authenticate")
  })

  test("sends StopFailure error notifications", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true })
    })
    vi.stubGlobal("fetch", fetchMock)

    await dispatchClaudeWithStdin("error", {
      cwd: "/tmp/project",
      hook_event_name: "StopFailure",
      error: "rate_limit",
      error_details: "429 Too Many Requests"
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(body.title).toBe("Claude error")
    expect(body.message).toBe("429 Too Many Requests")
  })
})
