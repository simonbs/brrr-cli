import type { AgentAdapter, InstallOptions, ManualEvent } from "./types.js"
import {
  buildClaudeApprovalPayload,
  buildClaudeErrorPayload,
  buildClaudeFinishedPayload,
  installClaude,
  readClaudeInstallState,
  uninstallClaude
} from "../config/claude-settings.js"
export class ClaudeAdapter implements AgentAdapter {
  readonly id = "claude" as const
  readonly displayName = "Claude Code"

  readInstallState() {
    return readClaudeInstallState()
  }

  install(options: InstallOptions) {
    return installClaude(options)
  }

  uninstall() {
    return uninstallClaude()
  }

  buildManualDefaults(event: ManualEvent) {
    if (event === "needs-approval") return buildClaudeApprovalPayload()
    if (event === "error") {
      return buildClaudeErrorPayload()
    }
    return buildClaudeFinishedPayload()
  }
}
