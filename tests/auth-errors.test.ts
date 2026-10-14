import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
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
});
