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
  `auth.json`). No network calls, so it is safe at extension load.
- `registerUsageCommands()` skips providers that aren't configured.
- New `hideUnconfiguredProviders` setting, **on by default**, with a
  `/usage:settings` entry and a key in `usage.json`.

For a typical setup (credentials for anthropic, openai-codex, openrouter and
opencode-go) that is 11 commands down to 4.

## Notes

- Detection errs toward inclusion on purpose: a false positive only leaves a
  command visible, while a false negative would hide one you can actually use.
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
npx vitest --run  # 15 files / 152 tests passed
```

## Checklist

- [x] Tests added or updated for behavioural changes
- [x] `CHANGELOG.md` updated (under `## [Unreleased]`)
- [x] No secrets, tokens, or credentials in the diff
- [x] Commit follows the existing style (`type: subject`)
