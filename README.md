<div align="center">
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
  <a href="#-usage">🧭 Usage</a>
</div>

<hr />

## ✨ Why?
`brrr agent` installs webhook notifications for supported AI agent CLIs on macOS.

The goal is simple: when Claude or Codex finishes, needs approval, or needs your input, send a push through your `brrr` webhook without making you hand-edit agent config.

It is opinionated in a few ways:

- native agent config stays the source of truth
- installs are idempotent
- unrelated user config is preserved
- webhook delivery stays non-blocking for the agent

## 🚀 Getting Started

Install with Homebrew:

```sh
brew tap simonbs/brrr-cli https://github.com/simonbs/brrr-cli.git
brew install brrr
```

Or build and link the local CLI:

```sh
npm install
npm run build
npm link
```

Then install agent integrations with your webhook:

```sh
brrr agent install all --webhook 'https://api.brr.now/v1/br_your_webhook_id'
```

That is the easiest way to get started.

For a longer-lived setup, use an env var instead:

```sh
export BRRR_WEBHOOK_URL='https://api.brr.now/v1/br_your_webhook_id'
brrr agent install all --webhook '$BRRR_WEBHOOK_URL'
```

If you only want pushes when you are away from the machine, add an idle threshold:

```sh
brrr agent install all \
  --webhook 'https://api.brr.now/v1/br_your_webhook_id' \
  --idle-seconds 300
```

## 🧭 Usage

### Commands

| Command | Purpose |
|---|---|
| `brrr agent install <claude\|codex\|all> --webhook <value> [--idle-seconds <seconds>]` | Install or reinstall brrr-managed hooks using a `https://api.brr.now/v1/br_*` webhook. |
| `brrr agent uninstall <claude\|codex\|all>` | Remove only brrr-managed hooks. |
| `brrr agent status` | Show which agents are present, installed, and where config lives. |

### Examples

```sh
$ brrr agent install claude --webhook '$BRRR_WEBHOOK_URL'

$ brrr agent install codex --webhook 'https://api.brr.now/v1/br_your_webhook_id'

$ brrr agent install all --webhook '$BRRR_WEBHOOK_URL' --idle-seconds 300

$ brrr agent status
Agent     Present Installed Idle    Config
claude    yes     yes       300s    ~/.claude/settings.json
codex     yes     yes       300s    ~/.codex/config.toml

$ brrr agent uninstall codex
```

### Supported Agents

| Agent | Events | Config touched | Notes |
|---|---|---|---|
| Claude Code | `finished`, `needs-approval` | `~/.claude/settings.json` | Uses `Stop`, `Notification(permission_prompt)`, and `PreToolUse(AskUserQuestion)`. |
| OpenAI Codex | `finished` | `~/.codex/config.toml` | Uses Codex `notify`. Current Codex notify support does not expose approval-specific hooks. |

### Webhook Values

`--webhook` accepts the following forms:

| Value | Example |
|---|---|
| brrr webhook URL | `https://api.brr.now/v1/br_your_webhook_id` |
| Env var reference | `$BRRR_WEBHOOK_URL` |
| Braced env var reference | `${BRRR_WEBHOOK_URL}` |

Recommended usage:

| Approach | When to use it |
|---|---|
| Hardcoded URL | Fastest way to get started and verify everything works |
| Env var | Best practice for a persistent local setup |

Env-var webhook references are resolved when the installed hook runs, not during install. Resolved values must also match `https://api.brr.now/v1/br_*`.

Use single quotes when installing with an env var reference so your shell does not expand it too early:

```sh
brrr agent install all --webhook '$BRRR_WEBHOOK_URL'
```

If you want the variable available in future shell sessions, add it to your shell config, for example:

```sh
export BRRR_WEBHOOK_URL='https://api.brr.now/v1/br_your_webhook_id'
```

### Idle Notifications

`--idle-seconds` is optional.

When set, `brrr` checks macOS HID idle time and only sends if the machine has been idle for at least that many seconds. From the user’s perspective, that means no keyboard or mouse activity for that duration.

## 📝 Notes

| Topic | Detail |
|---|---|
| Platform | macOS only |
| Config safety | `brrr` edits only brrr-owned entries and creates backups before changes |
| Delivery | webhook sends use a short timeout and do not block agent workflows |
| Click-through | installed integrations do not set `open_url` in this first pass |
