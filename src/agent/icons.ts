export type IconAgent = "claude" | "codex" | "copilot"

// Sent as the brrr webhook `icon_url` so a push shows the icon of the agent that
// triggered it. brrr renders it in place of the app icon on iPhone and iPad, and
// hides the subtitle when it is set, so payload builders leave `subtitle` unset.
const iconUrls: Record<IconAgent, string> = {
  claude: "https://avatars.githubusercontent.com/u/81847?v=4",
  codex: "https://avatars.githubusercontent.com/u/267193182?v=4",
  copilot: "https://avatars.githubusercontent.com/u/178330254?v=4"
}

export function getAgentIconUrl(agent: IconAgent): string {
  return iconUrls[agent]
}
