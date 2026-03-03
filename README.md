<div align="center">
  <img width="700" src="/screenshot.png" />
  <h3><strong>brrr-cli</strong> — notifications for agent CLIs using <a href="https://brrr.now" target="_blank">brrr.now</a></h3>
  <p>Easy peasy installation of Claude Code and Codex hooks to send push notifications.</p>
</div>

<hr />

<div align="center">
  <pre>
 █████                                  
░░███                                   
 ░███████  ████████  ████████  ████████ 
 ░███░░███░░███░░███░░███░░███░░███░░███
 ░███ ░███ ░███ ░░░  ░███ ░░░  ░███ ░░░ 
 ░███ ░███ ░███      ░███      ░███     
 ████████  █████     █████     █████    
░░░░░░░░  ░░░░░     ░░░░░     ░░░░░     
  </pre>
</div>

<div align="center">
  <a href="#-why">✨ Why?</a>&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="#-getting-started">🚀 Getting Started</a>&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="#-supported-agents">🤖 Supported Agents</a>&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="#-usage">🧭 Usage</a>
</div>

<hr />

## ✨ Why?
`brrr` installs webhook notifications for supported AI agent CLIs on macOS.

The goal is simple: when Claude or Codex finishes, needs approval, or needs your input, send a push through your <a href="https://brrr.now" target="_blank">brrr</a> webhook.

It uses <a href="https://code.claude.com/docs/en/hooks" target="_blank">Claude's hooks</a> and <a href="https://developers.openai.com/codex/config-reference/" target="_blank">Codex' notify</a> to detect the agent is done. The CLI automatically modifies `~/.claude/settings.json` and `~/.codex/config.toml` to setup the hooks and commands.

## 🚀 Getting Started

Install with Homebrew:

```sh
brew tap simonbs/brrr-cli https://github.com/simonbs/brrr-cli.git
brew install brrr
```

Then install agent integrations with your webhook:

```sh
brrr agent install all \
    --webhook 'https://api.brrr.now/v1/br_your_webhook_id' \
    --idle-seconds 300
```

You can find your webhook in the <a href="https://brrr.now" target="_blank">brrr</a> app.

It's considered best-practice to put your webhook URL in `~/.zshrc` or similar and have it injected into the command when it's invoked.

```sh
brrr agent install all --webhook '$BRRR_WEBHOOK_URL' --idle-seconds 300
```

## 🤖 Supported Agents

| Agent       | Auto-Install | Config                    | Hooks                                                                         |
|-------------|:------------:|---------------------------|-------------------------------------------------------------------------------|
| Claude Code | ✅           | `~/.claude/settings.json` | `Stop`, `Notification(permission_prompt)`, and `PreToolUse(AskUserQuestion)`. |
| Codex       | ✅           | `~/.codex/config.toml`    | `notify`                                                                      |

## 🧭 Usage

| Command | Purpose |
|---|---|
| `brrr agent install <claude\|codex\|all> --webhook <value> --idle-seconds <seconds>` | Install or reinstall hooks using a `https://api.brrr.now/v1/br_*` webhook. |
| `brrr agent uninstall <claude\|codex\|all>` | Remove only brrr-managed hooks. |
| `brrr agent status` | Show which agents are present, installed, and where config lives. |

### Install Hooks

Use `brrr agent install` to install or reinstall hooks for one agent or all supported agents.

```sh
brrr agent install <claude|codex|all> --webhook <value> --idle-seconds <seconds>
```

`--webhook` accepts the following forms:

| Value | Example |
|---|---|
| brrr webhook URL | `https://api.brrr.now/v1/br_your_webhook_id` |
| Environment variable | `$BRRR_WEBHOOK_URL` or `${BRRR_WEBHOOK_URL}` |

Recommended usage:

| Approach | When to use it |
|---|---|
| Hardcoded URL | Fastest way to get started and verify everything works |
| Environment variable | Best practice for a persistent local setup |

Environment variables are resolved when the installed hook runs, not during install. Resolved values must also match `https://api.brrr.now/v1/br_*`.

Use single quotes when installing with an environment variable so your shell does not expand it too early:

```sh
brrr agent install all --webhook '$BRRR_WEBHOOK_URL' --idle-seconds 300
```

If you want the variable available in future shell sessions, add it to your shell config, for example:

```sh
export BRRR_WEBHOOK_URL='https://api.brrr.now/v1/br_your_webhook_id'
```

#### Only Notify When Idle

`--idle-seconds` is required.

We recommend starting with `300`, which is a good default if you mainly want pushes when you step away from the machine.

Use `0` to send the notification immediately with no idle wait. Any value above `0` means `brrr` only sends the notification when the machine has been idle for at least that many seconds. In this case "idle" means no keyboard or mouse activity for that duration.

`--idle-seconds` must be a non-negative integer.

### Check Installation Status

Use `brrr agent status` to see which supported agents are present, whether `brrr` has installed hooks for them, and which config files are being used.

```sh
brrr agent status
```

Example output:

```text
Agent     Present Installed Idle    Config
claude    yes     yes       300s    ~/.claude/settings.json
codex     yes     yes       300s    ~/.codex/config.toml
```

### Remove Hooks

Use `brrr agent uninstall` to remove only the hooks managed by `brrr`.

```sh
brrr agent uninstall <claude|codex|all>
```

### Examples

```sh
$ brrr agent install claude --webhook '$BRRR_WEBHOOK_URL' --idle-seconds 300

$ brrr agent install codex --webhook 'https://api.brrr.now/v1/br_your_webhook_id' --idle-seconds 300

$ brrr agent install all --webhook '$BRRR_WEBHOOK_URL' --idle-seconds 300

$ brrr agent status
Agent     Present Installed Idle    Config
claude    yes     yes       300s    ~/.claude/settings.json
codex     yes     yes       300s    ~/.codex/config.toml

$ brrr agent uninstall codex
```
