# @kaishin/pi-usage

Pi extension that surfaces per-provider token-usage and quota status in the footer, plus a `/usage` command and dashboard. Restores the full provider set and TUI from upstream `pi-quotas` and adds MiniMax support via PR [#41](https://github.com/latentminds-ai/pi-quotas/pull/41).

## Supported providers

Anthropic, OpenAI Codex, GitHub Copilot, OpenRouter, Synthetic, Grok, Z.ai, OpenCode Go, Kimi Code, Ollama Cloud, MiniMax, and Command Code.

## Install

```bash
pi install npm:@kaishin/pi-usage
# or from source
pi install /path/to/pi-usage
```

After install, register credentials once per provider, e.g.:

```bash
pi /login minimax
# paste MINIMAX_API_KEY (or set MINIMAX_API_KEY env var)
```

OpenCode Go quotas come from the official `https://opencode.ai/zen/go/v1/usage` endpoint and read the API key from `OPENCODE_GO_API_KEY`, then `pi /login opencode-go` (`auth.json`), then `OPENCODE_API_KEY` (the shared variable Pi's own opencode-go provider authenticates with), then a `apiKey` field in `~/.config/opencode/opencode-quota/opencode-go.json` or the OpenCode CLI `~/.local/share/opencode/auth.json`. The old `workspaceId`/`authCookie` dashboard scraping is no longer supported.

Command Code usage comes from the Command Code API (`https://api.commandcode.ai`) and reads the API key from `pi /login` (select Command Code), then `COMMAND_CODE_API_KEY` / `COMMANDCODE_API_KEY`, then `~/.commandcode/auth.json` or `~/.omp/agent/auth.json`.

Restart or `/reload` to load the extension.

## Commands

| Command | Description |
|---|---|
| `/usage` | Combined dashboard for all configured providers |
| `/anthropic:usage` | Anthropic usage only |
| `/codex:usage` | OpenAI Codex usage only |
| `/github:usage` | GitHub Copilot usage only |
| `/openrouter:usage` | OpenRouter usage only |
| `/synthetic:usage` | Synthetic usage only |
| `/grok:usage` | Grok usage only |
| `/zai:usage` | Z.ai usage only |
| `/opencode-go:usage` | OpenCode Go usage only |
| `/kimi:usage` | Kimi Code usage only |
| `/ollama:usage` | Ollama Cloud usage only |
| `/minimax:usage` | MiniMax usage only |
| `/commandcode:usage` | Command Code usage only |
| `/tokens` | Cross-session token/cost usage |
| `/usage:settings` | Toggle features on or off |

## Features

### Dashboard

`/usage` opens a bordered TUI view showing all configured providers side by side with progress bars, used/remaining counts, and reset times. Hourly and weekly bars include a `|` at the current elapsed time so you can tell if usage is ahead of or behind pace. Press `r` to refresh, `q` or `Esc` to close.

### Footer status

When the active model is from a supported provider, the Pi footer shows real-time quota headroom refreshed every 60 seconds and on each turn. Use the **Usage status placement** setting to keep it in the shared footer row (`statusBar`) or render it on a dedicated line above/below the editor, which avoids collisions with other extensions in the status row.

### Quota warnings

Automatic warning notifications when usage or the current pace risks exhausting a quota before reset. Severity increases are reported immediately; unchanged risks repeat at most once per hour.

### Settings

`/usage:settings` toggles:

- Combined `/usage` command
- Per-provider `/...:usage` commands
- Footer usage status
- Usage status placement — shared footer bar (default) or a dedicated line above/below the editor
- Token usage status and `/tokens`
- Quota warning notifications
- Defer to Synthetic — hide the Synthetic footer when `pi-synthetic` is also showing usage
- Hide unconfigured providers — only register `/provider:usage` commands for providers that have credentials (on by default)

Settings are saved to `~/.pi/agent/extensions/usage.json` (global) or `.pi/usage.json` (per-project). Run `/reload` after changing command visibility.

## Test

```bash
npm install
npm run check   # tsc --noEmit
npm test        # vitest run
```

## Origin

Restored from the upstream [@latentminds/pi-quotas](https://github.com/latentminds-ai/pi-quotas) PR [#41](https://github.com/latentminds-ai/pi-quotas/pull/41), renamed to `/usage` and `usage.json`, and retargeted to the current `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` API.

## License

MIT
