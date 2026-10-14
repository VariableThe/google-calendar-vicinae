<p align="center">
    <img src="./assets/icon.png" width="128" height="128" alt="Google Calendar Logo" />
</p>

# Google Calendar Vicinae Extension

A [Vicinae](https://github.com/vicinaehq/vicinae) extension for
[Google Calendar](https://calendar.google.com/), letting you browse
calendars, list upcoming events, and create events directly from your Linux
launcher.

> Status: initial scaffold (v0.1.0). The manifest, preferences, and command
> entries below describe the intended MVP scope; command implementations
> land in follow-up PRs and are not all verified working yet.

## Features (intended MVP scope)

- **List Events** (`list-events`) — show upcoming events across your
  calendars for the next N days (configurable 1/3/7/14/30), with optional
  location display and an open action that can join the attached meeting.
- **List Calendars** (`list-calendars`) — browse the calendars in your
  Google account.
- **Create Event** (`create-event`) — create an event with an explicit
  title, time, and calendar.
- **Create Quick Event** (`create-quick-event`) — create an event from
  natural-language text (e.g. "Lunch tomorrow at noon").

## Install / Build / Dev

Prerequisites: Node.js >= 20 and npm.

```bash
npm install
npm run typecheck
npm test
```

To run against a live Vicinae instance with hot reloading:

```bash
npm run dev
```

To build a production package:

```bash
npm run build
```

The compiled output is installed under
`~/.local/share/vicinae/extensions/google-calendar`.

## Setup: Google Cloud OAuth client

The extension uses **your own** Google Cloud OAuth client — there is no
shared client secret shipped with the extension.

1. Create a project in the
   [Google Cloud console](https://console.cloud.google.com/).
2. Enable the **Google Calendar API** for that project
   (APIs & Services > Library).
3. Configure the **OAuth consent screen** (APIs & Services > OAuth consent
   screen): choose External, fill in the app name, and add yourself as a
   **test user**.
4. Create an OAuth client (APIs & Services > Credentials > Create
   Credentials > OAuth client ID) of type **"Desktop app"**.
5. Copy the **Client ID** (and secret, if one is issued) into the extension
   preferences (`googleClientId`, `googleClientSecret`).

## Authentication

Two paths, both using your own Desktop-app client:

- **Browser (PKCE) flow** — the extension opens Google's consent page in
  your browser and listens on a loopback redirect
  (`http://127.0.0.1:<port>/callback`) to complete the code exchange.
  Nothing is pasted by hand.
- **Paste-refresh-token flow** — if the browser flow is unavailable, obtain
  a refresh token yourself (e.g. via the OAuth playground or `gcloud`) and
  paste it into the `refreshToken` preference to authenticate without a
  browser round-trip.

Note: Vicinae's built-in `OAuth.PKCEClient` is intentionally not used —
its redirect URIs (raycast.com / `raycast://` / `com.raycast:/`) are not
usable with Google's Desktop-app client type.

## Limitations

- No AI tools or Raycast AI integration.
- No Google Contacts / People API integration (no attendee lookup).
- No Google Workspace admin features (no domain-wide delegation, no room
  or resource management).
- Single-account only; no multi-account switching in the MVP scope.

## License

MIT.
