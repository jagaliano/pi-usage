# feat(commandcode): add a Command Code quota provider

`pi-commandcode-provider` already reads Command Code account usage, but its
`/commandcode-quota` command prints plain text. This brings the same data into
pi-usage, so it shows up in the `/usage` dashboard with the bars, severity
colours, pace line, and quota warnings every other provider gets.

Same endpoints and window semantics as `pi-commandcode-provider`, so the two
stay consistent.

## What it adds

- Client for `https://api.commandcode.ai` — `GET /alpha/whoami`,
  `/alpha/billing/credits`, `/alpha/billing/subscriptions`, `/alpha/usage/summary`
  with `Authorization: Bearer <key>`. Credits/subscription/summary are
  best-effort, so a partially configured account still reports what it can.
  15s overall deadline. Error text is redacted before it is truncated or shown.
- Key resolution: stored `pi /login` credential → `COMMAND_CODE_API_KEY` /
  `COMMANDCODE_API_KEY` → `~/.commandcode/auth.json` → `~/.omp/agent/auth.json`.
  Handles both `{type:"api",key}` and `{type:"oauth",access}` shapes, rejects
  host-provided env-var placeholders, and doesn't let a malformed first file
  hide a valid later one.
- `parseCommandCodeUsage()` maps the account data to `QuotaWindow[]`.
- `/commandcode:usage`, provider label, cache TTL, `PROVIDER_FETCHERS` entry.
- New `QuotaWindow.isBalance`, so a balance window renders `$X remaining`
  instead of a `$X / $X` ratio.

## Windows

| Window | Source | Duration | Pace |
|---|---|---|---|
| `5h Rolling` | `windowLimits.fiveHour`, used/cap credits | 5h | none |
| `Weekly` | `windowLimits.weekly` | 7d | `1/7` |
| `Monthly Budget` | `summary.totalCost` vs `remainingCredits + totalCost` | 30d | `1` |

Reset times come from `resetAt` (epoch seconds, ms, or ISO) and the billing
period end. At or over cap → `limited`, which escalates to critical like every
other provider. A `cap` of `0` with recorded usage is reported as exhausted
rather than dropped. With no usage summary, the provider reports a
tracking-only `Credits Remaining` balance — including a known zero — instead of
inventing a consumed amount.

## Verification

```
npm run check     # tsc --noEmit  -> 0 errors
npx vitest --run  # 15 files / 180 tests passed
```

Coverage is the unit and fetch-level suites with mocked responses; no live
Command Code account call was recorded.

## Notes

- The client and its key resolution live in two new modules
  (`commandcode.ts`, `commandcode-config.ts`), matching the existing
  `opencode-go.ts` / `opencode-go-config.ts` pair. If you'd rather keep the
  provider set in `fetch.ts` / `providers.ts`, say so and I'll fold them in.
- Branch is cut from `main` and contains only this change.
- Nothing else in the provider set changes.

## Checklist

- [x] Tests added or updated for behavioural changes
- [x] `CHANGELOG.md` updated (under `## [Unreleased]`)
- [x] No secrets, tokens, or credentials in the diff
- [x] Commit follows the existing style (`type: subject`)
