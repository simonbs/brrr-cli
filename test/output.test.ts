import { describe, expect, test } from "vitest"
import { homedir } from "node:os"
import {
  formatHomeRelativePath,
  formatAgentOperationResults
} from "../src/utils/output.js"

describe("output helpers", () => {
  test("formats home-relative paths", () => {
    expect(formatHomeRelativePath(`${homedir()}/.claude/settings.json`)).toBe("~/.claude/settings.json")
    expect(formatHomeRelativePath("/tmp/settings.json")).toBe("/tmp/settings.json")
  })

  test("formats agent operation results as a table", () => {
    const output = formatAgentOperationResults([
      {
        agent: "claude",
        status: "reinstalled",
        backupPath: `${homedir()}/.claude/settings.json.backup`
      },
      {
        agent: "codex",
        status: "installed"
      }
    ])

    expect(output).toContain("Agent")
    expect(output).toContain("Status")
    expect(output).toContain("Backup")
    expect(output).toContain("claude")
    expect(output).toContain("reinstalled")
    expect(output).toContain("~/.claude/settings.json.backup")
    expect(output).toContain("codex")
    expect(output).toContain("installed")
    expect(output).toContain(" -")
  })
})
