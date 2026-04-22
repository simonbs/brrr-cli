#!/usr/bin/env node

import { Command } from "commander"
import { ClaudeAdapter } from "./agent/adapters/claude.js"
import { CodexAdapter } from "./agent/adapters/codex.js"
import { CopilotAdapter } from "./agent/adapters/copilot.js"
import { installCommand } from "./commands/agent/install.js"
import { uninstallCommand } from "./commands/agent/uninstall.js"
import { statusCommand } from "./commands/agent/status.js"
import { dispatchCommand } from "./commands/agent/dispatch.js"
import { VERSION } from "./generated/version.js"

const adapters = [new ClaudeAdapter(), new CodexAdapter(), new CopilotAdapter()]
const program = new Command()
const banner = [
  " █████                                  ",
  "░░███                                   ",
  " ░███████  ████████  ████████  ████████ ",
  " ░███░░███░░███░░███░░███░░███░░███░░███",
  " ░███ ░███ ░███ ░░░  ░███ ░░░  ░███ ░░░ ",
  " ░███ ░███ ░███      ░███      ░███     ",
  " ████████  █████     █████     █████    ",
  "░░░░░░░░  ░░░░░     ░░░░░     ░░░░░     "
].join("\n")
const helpBanner = colorizeHelpText(`${banner}\n\n`)

program
  .name("brrr")
  .description("Agent notifications for brrr")
  .version(VERSION)
  .addHelpText("beforeAll", helpBanner)

const agent = program.command("agent").description("Manage AI agent webhook integrations")

agent
  .command("install")
  .argument("<agent>", "claude, codex, copilot, or all")
  .requiredOption("--webhook <value>", "brrr webhook URL or env reference")
  .requiredOption("--idle-seconds <seconds>", "Only send when macOS has been idle for at least this many seconds", parseIdleSeconds)
  .action(async (target: string, options: { webhook: string, idleSeconds: number }) => {
    await installCommand(adapters, target, options.webhook, options.idleSeconds)
  })

agent
  .command("uninstall")
  .argument("<agent>", "claude, codex, copilot, or all")
  .action(async (target: string) => {
    await uninstallCommand(adapters, target)
  })

agent
  .command("status")
  .action(async () => {
    await statusCommand(adapters)
  })

agent
  .command("dispatch", { hidden: true })
  .requiredOption("--agent <agent>", "claude, codex, or copilot")
  .requiredOption("--event <event>", "Adapter event")
  .requiredOption("--webhook <value>", "brrr webhook URL or env reference")
  .option("--idle-seconds <seconds>", "Only send when macOS has been idle for at least this many seconds", parseIdleSeconds)
  .option("--payload-json <payload>", "Codex notify payload JSON")
  .action(async (options: {
    agent: "claude" | "codex" | "copilot"
    event: "finished" | "needs-approval" | "error"
    webhook: string
    idleSeconds?: number
    payloadJson?: string
  }) => {
    await dispatchCommand({
      agent: options.agent,
      event: options.event,
      webhook: options.webhook,
      idleSeconds: options.idleSeconds,
      payloadJson: options.payloadJson
    })
  })

program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})

function parseIdleSeconds(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("--idle-seconds must be a non-negative integer.")
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("--idle-seconds must be a non-negative integer.")
  }

  return parsed
}

function colorizeHelpText(value: string): string {
  if (!process.stdout.isTTY || process.env.NO_COLOR) {
    return value
  }

  return `\u001b[38;2;108;92;231m${value}\u001b[0m`
}
