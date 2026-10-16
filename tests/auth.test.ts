import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createCodeChallengeS256, createCodeVerifier, createState } from "../src/auth/pkce";
import { buildAuthorizationUrl, waitForAuthorizationCode } from "../src/auth/loopback";
import {
  clearTokens,
  isExpired,
  loadTokens,
  saveTokens,
  setTokenStoreForTesting,
  type StoredTokens,
  type TokenStoreAdapter,
} from "../src/auth/tokens";
import {
  GOOGLE_SCOPES,
  MissingClientIdError,
  NotAuthenticatedError,
  authenticateWithRefreshToken,
  ensureSession,
  getAccessToken,
  invalidateAccessToken,
  setFetchImplementationForTesting,
  setPreferencesForTesting,
} from "../src/auth/google-oauth";
import {
  getExtensionPreferences,
  readSendUpdates,
  setRawPreferencesForTesting,
} from "../src/preferences";

/**
 * In-memory stand-in for the `OAuth.PKCEClient` token methods: implements
 * the same `setTokens` / `getTokens` / `removeTokens` shape with the same
 * `updatedAt`-anchored, `expiresIn`-relative semantics, so the
 * save/load/clear/refresh paths exercise the production mapping without a
 * Vicinae host.
 */
function memoryStore(): TokenStoreAdapter {
  let set:
    | {
        accessToken: string;
        refreshToken?: string;
        expiresIn?: number;
        scope?: string;
        updatedAt: Date;
      }
    | undefined;
  return {
    setTokens: async (tokens) => {
      set = { ...tokens, updatedAt: new Date() };
    },
    getTokens: async () => {
      if (!set) return undefined;
      const snapshot = set;
      const expiresIn =
        typeof snapshot.expiresIn === "number" && Number.isFinite(snapshot.expiresIn)
          ? snapshot.expiresIn
          : 3600;
      const updatedAt = snapshot.updatedAt;
      return {
        accessToken: snapshot.accessToken,
        ...(snapshot.refreshToken !== undefined
          ? { refreshToken: snapshot.refreshToken }
          : {}),
        expiresIn,
        ...(snapshot.scope !== undefined ? { scope: snapshot.scope } : {}),
        updatedAt,
        // Mirrors the API's own `isExpired()`: relative lifetime anchored
        // at the store time, with a small buffer before actual expiry.
        isExpired: () => Date.now() >= updatedAt.getTime() + expiresIn * 1000 - 5_000,
      };
    },
    removeTokens: async () => {
      set = undefined;
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
  setRawPreferencesForTesting(null);
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

describe("PKCEClient-backed token store", () => {
  it("round-trips tokens and re-anchors expiry to the store time", async () => {
    const before = Date.now();
    await saveTokens({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: before + 3600_000,
      scope: "email profile",
    });
    const stored = await loadTokens();
    assert.ok(stored);
    assert.equal(stored.accessToken, "access-1");
    assert.equal(stored.refreshToken, "refresh-1");
    assert.equal(stored.scope, "email profile");
    // expiresIn is second-granular: allow rounding + elapsed tolerance.
    assert.ok(Math.abs(stored.expiresAt - (before + 3600_000)) < 5_000);
    assert.equal(isExpired(stored), false);
  });

  it("loads an already-expired save as expired", async () => {
    await saveTokens({
      accessToken: "stale",
      refreshToken: "refresh-1",
      expiresAt: Date.now() - 10_000,
    });
    const stored = await loadTokens();
    assert.ok(stored);
    assert.equal(isExpired(stored), true);
  });

  it("returns null when the store is empty and after clear", async () => {
    assert.equal(await loadTokens(), null);
    await saveTokens({ accessToken: "x", expiresAt: Date.now() + 3600_000 });
    assert.ok(await loadTokens());
    await clearTokens();
    assert.equal(await loadTokens(), null);
  });
});

describe("buildAuthorizationUrl", () => {
  it("contains all required parameters with correctly encoded scopes", () => {
    const url = buildAuthorizationUrl({
      clientId: "cid.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:54321/callback",
      codeChallenge: "challenge123",
      state: "state-abc",
      scopes: GOOGLE_SCOPES,
    });
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(parsed.searchParams.get("client_id"), "cid.apps.googleusercontent.com");
    assert.equal(parsed.searchParams.get("redirect_uri"), "http://127.0.0.1:54321/callback");
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

describe("getAccessToken single-flight", () => {
  async function seedExpired(refreshToken = "stored-refresh"): Promise<void> {
    await saveTokens({
      accessToken: "stale-access",
      refreshToken,
      expiresAt: Date.now() - 10_000,
    });
  }

  it("two concurrent calls with an expired token perform exactly ONE token POST", async () => {
    await seedExpired();
    let posts = 0;
    setFetchImplementationForTesting(async () => {
      posts++;
      // Widen the race window so both callers overlap in-flight.
      await new Promise((r) => setTimeout(r, 20));
      return jsonResponse({ access_token: "fresh-access", expires_in: 3600 });
    });

    const [a, b] = await Promise.all([getAccessToken(), getAccessToken()]);
    assert.equal(a, "fresh-access");
    assert.equal(b, "fresh-access");
    assert.equal(posts, 1);
    // The rotated-in token preserves the stored refresh token.
    assert.equal((await loadTokens())?.refreshToken, "stored-refresh");
  });

  it("a failed refresh rejects both waiters and does not poison later calls", async () => {
    await seedExpired("revoked-refresh");
    let posts = 0;
    setFetchImplementationForTesting(async () => {
      posts++;
      await new Promise((r) => setTimeout(r, 10));
      return jsonResponse(
        { error: "invalid_grant", error_description: "Token has been expired or revoked." },
        400,
      );
    });

    const [r1, r2] = await Promise.allSettled([getAccessToken(), getAccessToken()]);
    assert.equal(r1.status, "rejected");
    assert.equal(r2.status, "rejected");
    assert.ok((r1 as PromiseRejectedResult).reason instanceof NotAuthenticatedError);
    assert.ok((r2 as PromiseRejectedResult).reason instanceof NotAuthenticatedError);
    assert.equal(posts, 1);

    // Later calls work again once valid tokens/refresh input exist.
    await seedExpired("good-refresh");
    setFetchImplementationForTesting(async () =>
      jsonResponse({ access_token: "recovered-access", expires_in: 3600 }),
    );
    assert.equal(await getAccessToken(), "recovered-access");
  });
});

describe("invalidateAccessToken", () => {
  it("forces the next getAccessToken past the skew/expiry fast path", async () => {
    // Fresh token: no network call without invalidation.
    await saveTokens({
      accessToken: "cached-access",
      refreshToken: "stored-refresh",
      expiresAt: Date.now() + 3_600_000,
    });
    let posts = 0;
    setFetchImplementationForTesting(async () => {
      posts++;
      return jsonResponse({ access_token: "post-401-access", expires_in: 3600 });
    });
    assert.equal(await getAccessToken(), "cached-access");
    assert.equal(posts, 0);

    await invalidateAccessToken();
    assert.equal(await getAccessToken(), "post-401-access");
    assert.equal(posts, 1);
  });

  it("resolves quietly when no tokens are stored", async () => {
    await invalidateAccessToken();
  });
});

describe("ensureSession", () => {
  it("returns true without network when stored tokens exist", async () => {
    await saveTokens({
      accessToken: "cached-access",
      refreshToken: "stored-refresh",
      expiresAt: Date.now() + 3_600_000,
    });
    let posts = 0;
    setFetchImplementationForTesting(async () => {
      posts++;
      return jsonResponse({ access_token: "x", expires_in: 3600 });
    });
    assert.equal(await ensureSession(), true);
    assert.equal(posts, 0);
  });

  it("exchanges the pasted refreshToken preference when no tokens are stored", async () => {
    setPreferencesForTesting({
      googleClientId: "test-client-id.apps.googleusercontent.com",
      refreshToken: "pasted-refresh-token",
    });
    let posts = 0;
    setFetchImplementationForTesting(async (url, init) => {
      posts++;
      const body = new URLSearchParams(String((init?.body as string) ?? ""));
      assert.equal(body.get("refresh_token"), "pasted-refresh-token");
      return jsonResponse({ access_token: "boot-access", expires_in: 3600 });
    });
    assert.equal(await ensureSession(), true);
    assert.equal(posts, 1);
    assert.equal((await loadTokens())?.accessToken, "boot-access");
  });

  it("throws MissingClientIdError mentioning the Client ID when refreshToken is set without one", async () => {
    setPreferencesForTesting({ refreshToken: "pasted-refresh-token" });
    await assert.rejects(() => ensureSession(), (err: unknown) => {
      assert.ok(err instanceof MissingClientIdError);
      assert.match((err as Error).message, /Client ID/);
      return true;
    });
  });

  it("returns false (never throws) when simply not authenticated", async () => {
    setPreferencesForTesting({ googleClientId: "test-client-id.apps.googleusercontent.com" });
    assert.equal(await ensureSession(), false);
  });

  it("returns false when the pasted refresh token is rejected", async () => {
    setPreferencesForTesting({
      googleClientId: "test-client-id.apps.googleusercontent.com",
      refreshToken: "bad-refresh-token",
    });
    setFetchImplementationForTesting(async () =>
      jsonResponse({ error: "invalid_grant", error_description: "Bad." }, 400),
    );
    assert.equal(await ensureSession(), false);
  });
});

describe("extension preferences", () => {
  it("defaults sendInvitations to all and addSignature to true", () => {
    setPreferencesForTesting(null);
    setRawPreferencesForTesting({});
    assert.equal(readSendUpdates(), "all");
    const prefs = getExtensionPreferences();
    assert.equal(prefs.sendInvitations, "all");
    assert.equal(prefs.addSignature, true);
    assert.equal(prefs.defaultEventDuration, "30");
  });

  it("falls back to all on an invalid stored sendInvitations value", () => {
    setPreferencesForTesting(null);
    setRawPreferencesForTesting({ sendInvitations: "everyone" });
    assert.equal(readSendUpdates(), "all");
    assert.equal(getExtensionPreferences().sendInvitations, "all");
  });

  it("passes through valid values and normalizes empty strings", () => {
    setPreferencesForTesting(null);
    setRawPreferencesForTesting({
      sendInvitations: "none",
      addSignature: false,
      refreshToken: "",
      googleClientId: "cid",
    });
    assert.equal(readSendUpdates(), "none");
    const prefs = getExtensionPreferences();
    assert.equal(prefs.sendInvitations, "none");
    assert.equal(prefs.addSignature, false);
    assert.equal(prefs.refreshToken, undefined);
    assert.equal(prefs.googleClientId, "cid");
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
