import { describe, expect, test } from "vitest"
import { homedir } from "node:os"
import { formatHomeRelativePath } from "../src/utils/output.js"

describe("output helpers", () => {
  test("formats home-relative paths", () => {
    expect(formatHomeRelativePath(`${homedir()}/.claude/settings.json`)).toBe("~/.claude/settings.json")
    expect(formatHomeRelativePath("/tmp/settings.json")).toBe("/tmp/settings.json")
  })
})
