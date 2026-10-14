import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createCodeChallengeS256, createCodeVerifier, createState } from "../src/auth/pkce";
import { buildAuthorizationUrl, waitForAuthorizationCode } from "../src/auth/loopback";
import {
  clearTokens,
  isExpired,
  loadTokens,
  setTokenStoreForTesting,
  type StoredTokens,
} from "../src/auth/tokens";
import {
  GOOGLE_SCOPES,
  NotAuthenticatedError,
  authenticateWithRefreshToken,
  getAccessToken,
  setFetchImplementationForTesting,
  setPreferencesForTesting,
} from "../src/auth/google-oauth";

function memoryStore() {
  const map = new Map<string, string>();
  return {
    getItem: async (key: string) => map.get(key),
    setItem: async (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: async (key: string) => {
      map.delete(key);
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  setTokenStoreForTesting(memoryStore());
  setPreferencesForTesting({ googleClientId: "test-client-id.apps.googleusercontent.com" });
  setFetchImplementationForTesting(null);
});

describe("pkce", () => {
  it("matches the RFC 7636 S256 test vector", () => {
    assert.equal(
      createCodeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("default verifier is 43 chars from the unreserved charset", () => {
    const verifier = createCodeVerifier();
    assert.equal(verifier.length, 43);
    assert.match(verifier, /^[A-Za-z0-9\-._~]+$/);
  });

  it("verifier stays within 43-128 chars across sizes", () => {
    for (const bytes of [32, 48, 64, 96]) {
      const v = createCodeVerifier(bytes);
      assert.ok(v.length >= 43 && v.length <= 128, `length ${v.length} for ${bytes} bytes`);
      assert.match(v, /^[A-Za-z0-9\-._~]+$/);
    }
  });

  it("two verifiers differ", () => {
    assert.notEqual(createCodeVerifier(), createCodeVerifier());
  });

  it("two states are unique non-empty strings", () => {
    const a = createState();
    const b = createState();
    assert.ok(a.length > 0 && b.length > 0);
    assert.notEqual(a, b);
  });
});

describe("isExpired", () => {
  const base: StoredTokens = { accessToken: "x", expiresAt: 0 };

  it("fresh token is not expired", () => {
    assert.equal(isExpired({ ...base, expiresAt: Date.now() + 3_600_000 }), false);
  });

  it("past token is expired", () => {
    assert.equal(isExpired({ ...base, expiresAt: Date.now() - 3_600_000 }), true);
  });

  it("token expiring in 30s is expired under the default 60s skew", () => {
    assert.equal(isExpired({ ...base, expiresAt: Date.now() + 30_000 }), true);
  });

  it("token expiring in 61s is not expired under the default 60s skew", () => {
    assert.equal(isExpired({ ...base, expiresAt: Date.now() + 61_000 }), false);
  });

  it("custom skew of 0 only expires at/past expiresAt", () => {
    assert.equal(isExpired({ ...base, expiresAt: Date.now() + 30_000 }, 0), false);
    assert.equal(isExpired({ ...base, expiresAt: Date.now() - 1 }, 0), true);
  });
});

describe("buildAuthorizationUrl", () => {
  it("contains all required parameters with correctly encoded scopes", () => {
    const url = buildAuthorizationUrl({
      clientId: "cid.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:8765/callback",
      codeChallenge: "challenge123",
      state: "state-abc",
      scopes: GOOGLE_SCOPES,
    });
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(parsed.searchParams.get("client_id"), "cid.apps.googleusercontent.com");
    assert.equal(parsed.searchParams.get("redirect_uri"), "http://127.0.0.1:8765/callback");
    assert.equal(parsed.searchParams.get("response_type"), "code");
    assert.equal(parsed.searchParams.get("code_challenge"), "challenge123");
    assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
    assert.equal(parsed.searchParams.get("state"), "state-abc");
    // Space-joined and URL-encoded: raw query must not contain a literal space or plus-joined scopes.
    assert.ok(!url.includes(" "));
    const scope = parsed.searchParams.get("scope");
    assert.ok(scope);
    assert.deepEqual(scope.split(" "), GOOGLE_SCOPES);
    for (const s of GOOGLE_SCOPES) assert.ok(scope.includes(s));
  });
});

describe("refresh-token exchange", () => {
  it("successful refresh stores tokens and getAccessToken returns them", async () => {
    const seen: string[] = [];
    setFetchImplementationForTesting(async (url, init) => {
      seen.push(String(url));
      const body = new URLSearchParams(String((init?.body as string) ?? ""));
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), "pasted-refresh-token");
      assert.equal(body.get("client_id"), "test-client-id.apps.googleusercontent.com");
      return jsonResponse({
        access_token: "access-123",
        refresh_token: "refresh-456",
        expires_in: 3600,
        scope: "email",
        token_type: "Bearer",
      });
    });

    await authenticateWithRefreshToken("pasted-refresh-token");
    assert.equal(seen.length, 1);
    const stored = await loadTokens();
    assert.ok(stored);
    assert.equal(stored.accessToken, "access-123");
    assert.equal(stored.refreshToken, "refresh-456");

    // Fresh token: no second network call.
    assert.equal(await getAccessToken(), "access-123");
    assert.equal(seen.length, 1);

    await clearTokens();
    assert.equal(await loadTokens(), null);
  });

  it("preserves the existing refresh token when the response omits one", async () => {
    setFetchImplementationForTesting(async () =>
      jsonResponse({ access_token: "new-access", expires_in: 3600 }),
    );
    await authenticateWithRefreshToken("original-refresh");
    const stored = await loadTokens();
    assert.equal(stored?.accessToken, "new-access");
    assert.equal(stored?.refreshToken, "original-refresh");
  });

  it("400 invalid_grant clears stored tokens and throws NotAuthenticatedError", async () => {
    setFetchImplementationForTesting(async () =>
      jsonResponse(
        { error: "invalid_grant", error_description: "Token has been expired or revoked." },
        400,
      ),
    );
    // Seed expired tokens directly (the stubbed refresh endpoint always fails).
    const { saveTokens } = await import("../src/auth/tokens");
    await saveTokens({
      accessToken: "stale",
      refreshToken: "revoked-refresh",
      expiresAt: Date.now() - 10_000,
    });

    await assert.rejects(() => getAccessToken(), NotAuthenticatedError);
    assert.equal(await loadTokens(), null);
  });

  it("getAccessToken with no tokens throws NotAuthenticatedError", async () => {
    await assert.rejects(() => getAccessToken(), NotAuthenticatedError);
  });
});

describe("loopback server", () => {
  it("captures code/state on /callback and reports the exact redirectUri", async () => {
    let redirectUri = "";
    const pending = waitForAuthorizationCode({
      expectedState: "s123",
      timeoutMs: 10_000,
      onListening: (uri) => {
        redirectUri = uri;
      },
    });
    while (!redirectUri) await new Promise((r) => setTimeout(r, 10));
    assert.match(redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    const res = await fetch(`${redirectUri}?code=authcode-1&state=s123`);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.ok(text.includes("Vicinae"));

    const result = await pending;
    assert.deepEqual(result, { code: "authcode-1", state: "s123" });
  });

  it("rejects on state mismatch", async () => {
    let redirectUri = "";
    const pending = waitForAuthorizationCode({
      expectedState: "expected",
      timeoutMs: 10_000,
      onListening: (uri) => {
        redirectUri = uri;
      },
    });
    while (!redirectUri) await new Promise((r) => setTimeout(r, 10));
    const assertion = assert.rejects(() => pending, /state/i);
    await fetch(`${redirectUri}?code=x&state=wrong`);
    await assertion;
  });

  it("rejects with Google's error description", async () => {
    let redirectUri = "";
    const pending = waitForAuthorizationCode({
      expectedState: "s",
      timeoutMs: 10_000,
      onListening: (uri) => {
        redirectUri = uri;
      },
    });
    while (!redirectUri) await new Promise((r) => setTimeout(r, 10));
    const assertion = assert.rejects(() => pending, /access_denied/);
    await fetch(`${redirectUri}?error=access_denied&error_description=user+said+no`);
    await assertion;
  });
});
