import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GoogleApiError } from "../src/api/calendar.js";
import { formatGoogleApiError } from "../src/lib/api-errors.js";

const ENABLE_URL =
  "https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=941200000001";

function accessNotConfiguredBody(url: string | null = ENABLE_URL): unknown {
  return {
    error: {
      code: 403,
      message:
        "Google Calendar API has not been used in project 941200000001 before or it is disabled.",
      errors: [
        {
          message:
            "Google Calendar API has not been used in project 941200000001 before or it is disabled.",
          domain: "usageLimits",
          reason: "accessNotConfigured",
        },
      ],
      status: "PERMISSION_DENIED",
      ...(url === null
        ? {}
        : {
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.Help",
                links: [{ description: "Google developers console API activation", url }],
              },
            ],
          }),
    },
  };
}

describe("formatGoogleApiError", () => {
  it("maps 403 accessNotConfigured to the enable-API guidance with the URL from the error body", () => {
    const err = new GoogleApiError({
      status: 403,
      message: `Google API error 403: Google Calendar API has not been used in project 941200000001 before or it is disabled. Enable it by visiting ${ENABLE_URL} then retry.`,
      reason: "accessNotConfigured",
      body: accessNotConfiguredBody(),
    });
    const out = formatGoogleApiError(err);
    assert.match(out, /Enable the Google Calendar API|not enabled/i);
    assert.ok(out.includes(ENABLE_URL), "must include the enable URL from the body links");
    assert.match(out, /1–2 minutes/);
    assert.match(out, /no re-sign-in/i);
  });

  it("matches accessNotConfigured by message text even without a reason", () => {
    const err = new GoogleApiError({
      status: 403,
      message: `Google API error 403: Access Not Configured. Calendar API has not been used in project X before or it is disabled.`,
    });
    assert.match(formatGoogleApiError(err), /not enabled/i);
  });

  it("falls back to a constructed library URL when the body has no URL", () => {
    const err = new GoogleApiError({
      status: 403,
      message: "Google API error 403: Calendar API is disabled.",
      reason: "accessNotConfigured",
      body: accessNotConfiguredBody(null),
    });
    const out = formatGoogleApiError(err);
    assert.ok(
      out.includes("https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"),
      "must fall back to the constructed library URL",
    );
  });

  it("maps 403 insufficientPermissions to sign-out/sign-in guidance", () => {
    const err = new GoogleApiError({
      status: 403,
      message:
        "Google API error 403: Request had insufficient authentication scopes.",
      reason: "insufficientPermissions",
    });
    const out = formatGoogleApiError(err);
    assert.match(out, /Sign out and sign in again/);
    assert.match(out, /different.*client|scope set/i);
  });

  it("maps 401 to session-expired guidance mentioning the silent refresh", () => {
    const err = new GoogleApiError({ status: 401, message: "Google API error 401: Invalid Credentials" });
    const out = formatGoogleApiError(err);
    assert.match(out, /session expired/i);
    assert.match(out, /sign in again/i);
    assert.match(out, /refresh/i);
  });

  it("maps 404 notFound to the calendar-ID/defaultCalendarId guidance", () => {
    const err = new GoogleApiError({
      status: 404,
      message: "Google API error 404: Not Found",
      reason: "notFound",
    });
    const out = formatGoogleApiError(err);
    assert.match(out, /not found|does not exist/i);
    assert.match(out, /defaultCalendarId/);
  });

  it("maps 429 and rate-limit reasons to retry guidance", () => {
    for (const reason of ["rateLimitExceeded", "userRateLimitExceeded"]) {
      const out = formatGoogleApiError(
        new GoogleApiError({ status: 429, message: "Google API error 429: Too many requests", reason }),
      );
      assert.match(out, /retry/i);
    }
    const byMessage = formatGoogleApiError(
      new GoogleApiError({ status: 429, message: "Google API error 429: Rate Limit Exceeded" }),
    );
    assert.match(byMessage, /retry/i);
  });

  it("maps 5xx to transient-error retry guidance", () => {
    const out = formatGoogleApiError(
      new GoogleApiError({ status: 503, message: "Google API error 503: Backend Error" }),
    );
    assert.match(out, /transient/i);
    assert.match(out, /retry/i);
  });

  it("passes unrecognised Google errors through with the raw message", () => {
    const err = new GoogleApiError({ status: 400, message: "Google API error 400: Something odd happened" });
    assert.ok(formatGoogleApiError(err).includes("Something odd happened"));
  });

  it("passes non-Google errors through", () => {
    assert.equal(formatGoogleApiError(new Error("network down")), "network down");
    assert.equal(formatGoogleApiError("plain string"), "plain string");
  });

  it("never echoes a token or client secret", () => {
    const token = "1//0g5uper-secret-token-value";
    const secret = "GOCSPX-fake-client-secret-value";
    const out = formatGoogleApiError(
      new GoogleApiError({ status: 500, message: `Google API error 500: boom ${token} ${secret}` }),
    );
    assert.ok(!out.includes(token), "must not contain the token");
    assert.ok(!out.includes(secret), "must not contain the secret");
  });
});
