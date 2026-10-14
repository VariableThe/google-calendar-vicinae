import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatBrowserAuthError,
  formatRefreshTokenError,
  shouldAutoAttemptRefreshToken,
} from "../src/lib/auth-errors.js";

describe("shouldAutoAttemptRefreshToken", () => {
  it("attempts once when a preference token is present", () => {
    assert.equal(shouldAutoAttemptRefreshToken("ya29.fake", false), true);
  });

  it("never re-attempts once attempted", () => {
    assert.equal(shouldAutoAttemptRefreshToken("ya29.fake", true), false);
  });

  it("does not attempt without a preference token", () => {
    assert.equal(shouldAutoAttemptRefreshToken(undefined, false), false);
    assert.equal(shouldAutoAttemptRefreshToken("", false), false);
  });
});

describe("formatRefreshTokenError", () => {
  it("explains invalid_grant in plain wording", () => {
    const out = formatRefreshTokenError(
      new Error("Could not authenticate with that refresh token: Google token request failed (HTTP 400): invalid_grant"),
    );
    assert.match(out, /Google rejected the refresh token/);
    assert.match(out, /different OAuth client/);
    assert.match(out, /Testing mode/);
  });

  it("maps a missing client ID to the preferences fix", () => {
    const err = new Error("Google OAuth Client ID is not set.");
    err.name = "MissingClientIdError";
    assert.match(formatRefreshTokenError(err), /Client ID is missing/);
  });

  it("passes other errors through unchanged", () => {
    assert.equal(formatRefreshTokenError(new Error("network down")), "network down");
    assert.equal(formatRefreshTokenError("plain string"), "plain string");
  });

  it("never echoes the token value", () => {
    const token = "1//0g5uper-secret-token-value";
    const out = formatRefreshTokenError(new Error(`invalid_grant for ${token}`));
    assert.ok(!out.includes(token), "formatted message must not contain the token");
  });

  it("never echoes a client secret", () => {
    const secret = "GOCSPX-fake-client-secret-value";
    const out = formatRefreshTokenError(new Error(`invalid_client: secret ${secret} rejected`));
    assert.ok(!out.includes(secret), "formatted message must not contain the secret");
  });
});

describe("formatBrowserAuthError", () => {
  it("explains access_denied with the test-user, Internal-type, and admin-block causes", () => {
    const out = formatBrowserAuthError(
      new Error("Google authorization failed: access_denied: Access blocked"),
    );
    assert.match(out, /access_denied/);
    assert.match(out, /test user/i);
    assert.match(out, /Google Auth Platform → Audience → Test users/);
    assert.match(out, /OAuth consent screen/);
    assert.match(out, /Internal/);
    assert.match(out, /admin/i);
    // Raw detail is preserved.
    assert.match(out, /Access blocked/);
  });

  it("explains redirect_uri_mismatch as a Desktop-app client-type problem", () => {
    const out = formatBrowserAuthError(new Error("redirect_uri_mismatch: bad redirect"));
    assert.match(out, /Desktop app/);
    assert.match(out, /not Web application/);
  });

  it("explains invalid_client as a wrong client ID or missing secret", () => {
    const out = formatBrowserAuthError(new Error("invalid_client: Unauthorized"));
    assert.match(out, /Client ID/);
    assert.match(out, /client secret/i);
  });

  it("keeps the invalid_grant guidance", () => {
    const out = formatBrowserAuthError(new Error("invalid_grant: Token has been expired or revoked"));
    assert.match(out, /different OAuth client/);
  });

  it("maps MissingClientIdError to the preferences fix", () => {
    const err = new Error("Google OAuth Client ID is not set.");
    err.name = "MissingClientIdError";
    assert.match(formatBrowserAuthError(err), /Client ID is missing/);
  });

  it("passes unknown codes through unchanged", () => {
    assert.equal(formatBrowserAuthError(new Error("network down")), "network down");
  });

  it("never echoes a token or client secret", () => {
    const token = "1//0g5uper-secret-token-value";
    const secret = "GOCSPX-fake-client-secret-value";
    const out = formatBrowserAuthError(
      new Error(`access_denied for token ${token} secret ${secret}`),
    );
    assert.ok(!out.includes(token), "must not contain the token");
    assert.ok(!out.includes(secret), "must not contain the secret");
  });
});
