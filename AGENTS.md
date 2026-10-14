# AGENTS.md — google-calendar (Vicinae extension)

This is a Vicinae extension: a Raycast API-compatible launcher extension
written in TypeScript + React against `@vicinae/api`. The `package.json`
doubles as the extension manifest (`$schema`, `commands[]` with
`mode: "view"`, `preferences[]`).

Four commands are implemented and covered by unit tests (`npm test`):
`list-events`, `list-calendars`, `create-event`, `create-quick-event`.

## Requirements

- Node >= 20.

## Commands

- `npm run dev` — hot-reload against a running Vicinae instance
  (requires Vicinae running; `vici develop` under the hood).
- `npm run build` — production build via `vici build`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — unit tests via `tsx --test tests/**/*.test.ts`
  (`node:test` runner).

## Auth design (do not change without discussion)

- Users authenticate with their OWN Google Cloud OAuth "Desktop app" client.
- Primary path: PKCE flow with a loopback redirect
  (`http://127.0.0.1:<port>/callback`), implemented by hand. Desktop-app
  clients need no redirect-URI registration; the ephemeral loopback port is
  allowed by Google.
- Fallback path: the user pastes a refresh token into the `refreshToken`
  preference to skip the browser flow. Tokens must be minted for the user's
  own client (see `scripts/get-refresh-token.mjs`); Playground/`gcloud`
  tokens belong to a different client ID and fail with `invalid_grant`.
- Requested scopes only: `calendar.events`, `calendar.readonly`,
  `openid`, `email`, `profile`. No Contacts/People.
- Testing-mode consent screens require the user as a listed test user;
  testing-mode refresh tokens expire after ~7 days.
- Never use Vicinae's built-in `OAuth.PKCEClient` for Google: its only
  redirect URIs are raycast.com / `raycast://` / `com.raycast:/`, which
  Google does not accept for this flow.

## Scope notes

- `addSignature` applies to the Create Event form only; `quickAdd` accepts
  no description, so quick add cannot append it.
- MVP has no edit/delete, no attendee response actions, no recurrence
  creation, no Contacts/People, no AI tools, no Workspace admin.
- Event listing uses `singleEvents=true` expansion for recurring events.

## Workflow rules

- All work goes on feature branches (`feat/...`, `fix/...`, `docs/...`)
  and lands via pull request. Never commit directly to `main`.
- Pure logic lives in `src/lib/` and `src/auth/` and must be unit-tested
  with `node:test` via `tsx`. Keep UI thin; keep date parsing, request
  building, and token handling testable without the Vicinae runtime.
- Secrets and tokens (client secrets, refresh/access tokens) must never be
  committed or logged. `.env*` files are gitignored — keep it that way.
