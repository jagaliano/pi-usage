# feat(usage): hide `/provider:usage` commands for unconfigured providers

pi-usage registers a `/provider:usage` command for every supported provider, so
the command list shows `/grok:usage`, `/zai:usage`, `/minimax:usage`, … even
with no credential for them. Pi has no way to hide a registered command —
`RegisteredCommand` is only `{ name, sourceInfo, description?,
getArgumentCompletions?, handler }` — so the fix is to not register them.

The dashboard already hides unconfigured providers (`filterDashboardSnapshots`
drops `config` / `not_applicable` results), which is why `/usage` looked clean
while the command list did not.

## What changed

- New `isProviderConfigured()` in `src/lib/provider-availability.ts`. Offline
  check for any of: a provider env var, an `auth.json` entry, or a
  provider-specific config file (`~/.codex/auth.json`, the OpenCode CLI
  `auth.json`). No network calls, so it is safe at extension load.- `registerUsageCommands()` skips providers that aren't configured.
- New `hideUnconfiguredProviders` setting, **on by default**, with a
  `/usage:settings` entry and a key in `usage.json`.

For a typical setup (credentials for anthropic, openai-codex, openrouter and
opencode-go) that is 11 commands down to 4.

## Notes

- Env var names come from pi-ai's `env-api-keys.js`, not guesswork: Anthropic
  is `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_OAUTH_TOKEN`,
  Copilot is `COPILOT_GITHUB_TOKEN`, and so on.
- A variable only counts if it actually authenticates that provider.
  `OPENAI_API_KEY` belongs to the `openai` provider and is deliberately *not*
  accepted for `openai-codex`, which is OAuth-only — otherwise `/codex:usage`
  would stay visible and fail.
- Command names don't always match the provider id (`xai` → `/grok:usage`,
  `openai-codex` → `/codex:usage`), so the tests assert via
  `getProviderCommandInfo()` rather than string-building names.
- Registration happens at extension load, so logging into a new provider needs
  `/reload` (or a restart) before its command appears. The settings screen
  already says this.
- `registerUsageCommands()` accepts optional `{ hideUnconfigured, isConfigured }`
  overrides so tests exercise the gating without touching the real filesystem.

## Verification

```
npm run check     # tsc --noEmit  -> 0 errors
npx vitest --run  # 16 files / 154 tests passed
```

## Review

Independent review by `openai-codex/gpt-6.1-sol`: no blockers, one major and one
minor, both fixed.

- **Major** — `ANTHROPIC_OAUTH_TOKEN` was missing, so an OAuth-only Anthropic
  setup would have had `/anthropic:usage` hidden. Added, with a test.
- **Minor** — the settings list annotated every behaviour switch `(not loaded)`
  because the annotation only consulted registered sub-extensions. It now skips
  non-loadable switches, with a regression test.

The same pass showed the original list was too broad in the other direction
(`OPENAI_API_KEY`, `MOONSHOT_API_KEY`, `MINIMAX_CN_API_KEY`), which would keep
broken commands visible; those were removed.

## Checklist

- [x] Tests added or updated for behavioural changes
- [x] `CHANGELOG.md` updated (under `## [Unreleased]`)
- [x] No secrets, tokens, or credentials in the diff
- [x] Commit follows the existing style (`type: subject`)
