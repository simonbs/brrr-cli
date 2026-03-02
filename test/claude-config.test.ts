import { describe, expect, test } from "vitest"
import {
  buildClaudeApprovalPayload,
  buildClaudeCommand,
  buildClaudeFinishedPayload
} from "../src/agent/config/claude-settings.js"
import { parseWebhookRef } from "../src/agent/webhook-ref.js"

describe("claude config generation", () => {
  test("generates finished hook command", () => {
    const command = buildClaudeCommand("finished", parseWebhookRef("https://api.brr.now/v1/br_test"), "marker")
    expect(command).toContain("agent dispatch")
    expect(command).toContain("--event finished")
    expect(command).toContain("--webhook 'https://api.brr.now/v1/br_test'")
    expect(command).toContain("# marker")
  })

  test("includes idle threshold when configured", () => {
    const command = buildClaudeCommand("finished", parseWebhookRef("https://api.brr.now/v1/br_test"), "marker", 300)
    expect(command).toContain("--idle-seconds 300")
  })

  test("preserves env refs at runtime", () => {
    const command = buildClaudeCommand("needs-approval", parseWebhookRef("$BRRR_WEBHOOK_URL"), "marker")
    expect(command).toContain("--webhook '$BRRR_WEBHOOK_URL'")
  })

  test("keeps ownership marker internal to the shell command", () => {
    const command = buildClaudeCommand("needs-approval", parseWebhookRef("https://api.brr.now/v1/br_test"), "brrr:marker")
    expect(command).not.toContain("--marker")
    expect(command).toContain("# brrr:marker")
  })

  test("builds default notification text", () => {
    expect(buildClaudeFinishedPayload("/tmp/project", "Done")).toEqual({
      title: "Claude finished",
      message: "Done"
    })
    expect(buildClaudeApprovalPayload("/tmp/project")).toEqual({
      title: "Claude needs approval",
      message: "Claude is waiting for your input in 'project'."
    })
  })
})
