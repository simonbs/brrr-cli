import { describe, expect, test } from "vitest"
import { formatStatuses } from "../src/agent/status.js"

describe("status output", () => {
  test("renders concise table", () => {
    const output = formatStatuses([{
      agent: "claude",
      present: true,
      installed: true,
      configPath: "/Users/test/.claude/settings.json",
      webhookRef: "$BRRR_WEBHOOK_URL",
      idleSeconds: 300,
      supportedEvents: ["finished", "needs-approval"]
    }, {
      agent: "copilot",
      present: true,
      installed: true,
      configPath: "/repo/.github/hooks/brrr-copilot.json",
      webhookRef: "$BRRR_WEBHOOK_URL",
      idleSeconds: 300,
      supportedEvents: ["finished", "error"]
    }])

    expect(output).toContain("claude")
    expect(output).toContain("copilot")
    expect(output).toContain("300s")
    expect(output).toContain("/Users/test/.claude/settings.json")
    expect(output).toContain("/repo/.github/hooks/brrr-copilot.json")
    expect(output).not.toContain("$BRRR_WEBHOOK_URL")
  })
})
