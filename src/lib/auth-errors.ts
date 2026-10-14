/**
 * Pure helpers for the unauthenticated view's refresh-token boot attempt.
 *
 * Kept here — not in the auth module, not in the component — so the
 * decision and the error wording stay unit-testable without the Vicinae
 * runtime or React rendering. Nothing here ever sees a token value, so
 * nothing here can log one.
 */

/**
 * Decide whether the unauthenticated view should auto-attempt the
 * refresh-token exchange on mount. The component guards the call itself
 * with a ref so it fires at most once; this helper holds the pure part
 * of that decision.
 */
export function shouldAutoAttemptRefreshToken(
  preferenceToken: string | undefined,
  alreadyAttempted: boolean,
): boolean {
  if (alreadyAttempted) return false;
  return typeof preferenceToken === "string" && preferenceToken.length > 0;
}

/**
 * Turn a refresh-token exchange failure into plain user-facing wording.
 * Only the error message is used — the token value is never interpolated.
 */
export function formatRefreshTokenError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "MissingClientIdError") {
    return "Google Client ID is missing. Set your Google OAuth Client ID in the extension preferences, then try again.";
  }
  if (/invalid_grant/i.test(message)) {
    return "Google rejected the refresh token: it may belong to a different OAuth client, or the app may be in Testing mode with an expired token. Mint a refresh token for the same Client ID stored in the extension preferences (see scripts/get-refresh-token.mjs) and try again.";
  }
  return message;
}
