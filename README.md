<p align="center">
    <img src="./assets/icon.png" width="128" height="128" alt="Google Calendar Logo" />
</p>

# Google Calendar Vicinae Extension

A [Vicinae](https://github.com/vicinaehq/vicinae) extension for
[Google Calendar](https://calendar.google.com/), letting you browse
calendars, list upcoming events, and create events directly from your Linux
launcher.

Status: four commands implemented (`list-events`, `list-calendars`,
`create-event`, `create-quick-event`), typechecked (`npm run typecheck`),
unit-tested (50+ tests via `npm test`), built cleanly (`npm run build`).

## Features

- **List Events** (`list-events`) — upcoming events across visible
  calendars for the next N days (configurable 1/3/7/14/30), with optional
  location display and an open action that can join the attached meeting.
  De-duplicates the same occurrence seen on several calendars (same
  `iCalUID` + start + summary), keeping the user's default calendar copy.
- **List Calendars** (`list-calendars`) — browse calendars, set the
  default, hide/show calendars from List Events.
- **Create Event** (`create-event`) — explicit title, time, calendar,
  attendees, colour, reminders, optional Google Meet link.
- **Create Quick Event** (`create-quick-event`) — natural-language text
  (e.g. "Lunch tomorrow at noon") via Google's `quickAdd` endpoint, with a
  local chrono-node preview.

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
   **test user**. Apps with publishing status "Testing" only work for
   listed test users, and their refresh tokens expire after ~7 days —
   re-sign-in is then required.
4. Create an OAuth client (APIs & Services > Credentials > Create
   Credentials > OAuth client ID) of type **"Desktop app"**. A Desktop-app
   client needs **no redirect-URI registration**: Google allows the
   loopback redirect on `http://127.0.0.1` with an ephemeral port, which is
   what the extension uses (`http://127.0.0.1:<port>/callback`).
5. Copy the **Client ID** (and secret, if one is issued) into the extension
   preferences (`googleClientId`, `googleClientSecret`).
6. The extension requests only `calendar.events`,
   `calendar.readonly`, `openid`, `email`, `profile`. No Contacts/People
   scopes are requested.

## Authentication

Two paths, both using your own Desktop-app client:

- **Browser (PKCE) flow** — the extension opens Google's consent page in
  your browser and listens on a loopback redirect
  (`http://127.0.0.1:<port>/callback`) to complete the code exchange.
  Nothing is pasted by hand.
- **Paste-refresh-token flow** — mint a refresh token for your own
  Desktop-app client with `scripts/get-refresh-token.mjs` (run
  `node scripts/get-refresh-token.mjs --help`) and paste it into the
  `refreshToken` preference. On the next launch the extension exchanges it
  for a session with no browser interaction; the unauthenticated view also
  offers "Use Refresh Token from Preferences" to retry the exchange, with
  failures shown in a toast.

  Warning: tokens minted for a different client ID — e.g. via the OAuth
  Playground or `gcloud` — do not match your configured Client ID and the
  exchange fails with `invalid_grant`. Always mint with the same Client
  ID/secret stored in the extension preferences.

Note: Vicinae's built-in `OAuth.PKCEClient` is intentionally not used —
its redirect URIs (raycast.com / `raycast://` / `com.raycast:/`) are not
usable with Google's Desktop-app client type.

## Preferences

- `googleClientId`, `googleClientSecret`, `refreshToken`,
  `defaultCalendarId`, `defaultEventDuration`, `sendInvitations`,
  `addSignature` (extension-level); `daysToShow`, `showLocation`,
  `openCommandJoinsMeeting` (`list-events`-level).
- `addSignature` appends "Created with Vicinae" to the description and
  applies to the **Create Event form only**: the Calendar `quickAdd`
  endpoint accepts no description parameter, so quick add cannot carry the
  signature. Intentional, not a bug.

## Limitations

- No edit/delete of events, no attendee response (accept/decline) actions,
  no recurrence creation.
- No Google Contacts / People API integration (no attendee lookup).
- No AI tools or Raycast AI integration.
- No Google Workspace admin features (no domain-wide delegation, no room
  or resource management).
- Recurring-event listing relies on `singleEvents=true` server-side
  expansion (no separate recurring-master merge).
- Single-account only; no multi-account switching.

## License

MIT.
