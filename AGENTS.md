# AGENTS.md — google-calendar (Vicinae extension)

This is a Vicinae extension: a Raycast API-compatible launcher extension
written in TypeScript + React against `@vicinae/api`. The `package.json`
doubles as the extension manifest (`$schema`, `commands[]` with
`mode: "view"`, `preferences[]`).

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
  (`http://127.0.0.1:<port>/callback`), implemented by hand.
- Fallback path: the user pastes a refresh token into the `refreshToken`
  preference to skip the browser flow.
- Never use Vicinae's built-in `OAuth.PKCEClient` for Google: its only
  redirect URIs are raycast.com / `raycast://` / `com.raycast:/`, which
  Google does not accept for this flow.

## Workflow rules

- All work goes on feature branches (`feat/...`, `fix/...`, `docs/...`)
  and lands via pull request. Never commit directly to `main`.
- Pure logic lives in `src/lib/` and `src/auth/` and must be unit-tested
  with `node:test` via `tsx`. Keep UI thin; keep date parsing, request
  building, and token handling testable without the Vicinae runtime.
- Secrets and tokens (client secrets, refresh/access tokens) must never be
  committed or logged. `.env*` files are gitignored — keep it that way.
