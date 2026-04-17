import type { AgentAdapter, InstallOptions, ManualEvent } from "./types.js"
import {
  buildCopilotErrorPayload,
  buildCopilotFinishedPayload,
  installCopilot,
  readCopilotInstallState,
  uninstallCopilot
} from "../config/copilot-config.js"

export class CopilotAdapter implements AgentAdapter {
  readonly id = "copilot" as const
  readonly displayName = "GitHub Copilot"

  readInstallState() {
    return readCopilotInstallState()
  }

  install(options: InstallOptions) {
    return installCopilot(options)
  }

  uninstall() {
    return uninstallCopilot()
  }

  buildManualDefaults(event: ManualEvent) {
    if (event === "error") return buildCopilotErrorPayload()
    return buildCopilotFinishedPayload()
  }
}
