import { describe, expect, test } from "vitest"
import { formatStatuses } from "../src/agent/status.js"
import { homedir } from "node:os"

describe("status output", () => {
  test("renders concise table", () => {
    const output = formatStatuses([{
      agent: "claude",
      present: true,
      installed: true,
      configPath: `${homedir()}/.claude/settings.json`,
      webhookRef: "$BRRR_WEBHOOK_URL",
      idleSeconds: 300,
      supportedEvents: ["finished", "needs-approval"]
    }])

    expect(output).toContain("claude")
    expect(output).toContain("300s")
    expect(output).toContain("~/.claude/settings.json")
    expect(output).not.toContain("$BRRR_WEBHOOK_URL")
  })
})
