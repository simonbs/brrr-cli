import type { AgentAdapter, InstallOptions, ManualEvent } from "./types.js"
import {
  buildCodexFinishedPayload,
  installCodex,
  readCodexInstallState,
  uninstallCodex
} from "../config/codex-config.js"
export class CodexAdapter implements AgentAdapter {
  readonly id = "codex" as const
  readonly displayName = "OpenAI Codex"

  readInstallState() {
    return readCodexInstallState()
  }

  install(options: InstallOptions) {
    return installCodex(options)
  }

  uninstall() {
    return uninstallCodex()
  }

  buildManualDefaults(event: ManualEvent) {
    if (event === "error") {
      return {
        title: "Codex error",
        message: "Codex hit an error."
      }
    }
    return buildCodexFinishedPayload()
  }
}
