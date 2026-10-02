# fix(opencode-go): use the official usage API instead of scraping the dashboard

The OpenCode Go provider scrapes `https://opencode.ai/workspace/<workspaceId>/go`
and pulls usage out of SolidJS SSR hydration HTML with regexes. That already
broke once when the dashboard stopped server-rendering those windows, and it
breaks again the next time the markup or the auth flow changes. It also needs a
browser `auth` cookie, which the now-OAuth console no longer hands out reliably.

This switches to the real endpoint:

```
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <OpenCode Go API key>

{"usage":{"rolling":{...},"weekly":{...},"monthly":{...}}}
```

No HTML, no cookie, no workspace id.

## Changes

- `src/providers/opencode-go.ts` — API client. Bearer request, `resetsAt` →
  reset time, percent clamped to `0..100`, non-`ok` `status` → `limited`
  (escalates to critical like every other provider), actionable 401/403 errors.
- `src/providers/opencode-go-config.ts` — resolves an API key instead of a
  workspace/cookie pair. Read/parse errors are generic: this reads the OpenCode
  CLI `auth.json`, which also holds other providers' credentials.
- `src/providers/fetch.ts` — `fetchOpenCodeGoQuotas` resolves the key, then
  calls the API.
- `src/providers/providers.ts` — `parseOpenCodeGoUsage` propagates
  `limited`/`nextLabel`.
- Tests, `README.md`, `CHANGELOG.md`.

## Key resolution

1. stored `pi /login opencode-go` credential
2. `OPENCODE_GO_API_KEY`
3. `OPENCODE_API_KEY` (the one Pi's own opencode-go provider uses)
4. `apiKey` in `~/.config/opencode/opencode-quota/opencode-go.json`, or the
   OpenCode CLI `~/.local/share/opencode/auth.json`

Step 1 reads the stored credential directly. Pi's resolved lookup already
resolves `OPENCODE_API_KEY`, so going through it would let that generic variable
beat `OPENCODE_GO_API_KEY` — and pick a Zen-scoped key for the Go endpoint.

## Breaking change

`OPENCODE_GO_WORKSPACE_ID` / `OPENCODE_GO_AUTH_COOKIE` and the
`workspaceId`/`authCookie` config are gone. Existing configs get a message
pointing at the API key. If you already use OpenCode Go through Pi, the
credential is already in `auth.json` — nothing to do.

## Verification

```
npm run check     # tsc --noEmit  -> 0 errors
npx vitest --run  # 15 files / 171 tests passed
```

Live, through the extension's own `fetchOpenCodeGoQuotas`:

```
5h Rolling  3%   resets 2026-10-02T09:32:12Z
Weekly     17%   resets 2026-10-05T00:00:00Z
Monthly    47%   resets 2026-10-16T13:49:43Z
```

Also verified with no stored credential and no env var, falling through to the
OpenCode CLI `auth.json`.

## Notes

- Targets `@earendil-works/pi-coding-agent`. MiniMax support untouched.
  Upstream `b7ccf38` (Anthropic rate-limit work) intentionally not included.
- Review fixes: stored-credential precedence, config-error redaction, docs
  ordering.

## Checklist

- [x] Tests added or updated for behavioural changes
- [x] `CHANGELOG.md` updated (under `## [Unreleased]`)
- [x] No secrets, tokens, or credentials in the diff
- [x] Commit follows the existing style (`type: subject`)
