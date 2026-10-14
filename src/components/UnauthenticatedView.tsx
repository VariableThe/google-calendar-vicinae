import { useState } from "react";
import {
  Action,
  ActionPanel,
  Detail,
  Icon,
  openExtensionPreferences,
  showToast,
  Toast,
} from "@vicinae/api";
import {
  MissingClientIdError,
  authenticateWithRefreshToken,
  startBrowserAuthorization,
} from "../auth/google-oauth";
import { getExtensionPreferences } from "../preferences";

const SETUP_MARKDOWN = `# Sign in with Google

This extension uses **your own Google Cloud OAuth "Desktop app" client**, so your credentials never pass through a third party.

**Setup steps:**

1. Create a **Desktop app** OAuth client in the [Google Cloud console](https://console.cloud.google.com/apis/credentials) and enable the **Google Calendar API**.
2. Paste the **Client ID** (and Client Secret, if your client type has one) into this extension's preferences.
3. Choose **Sign in with Google** below and approve the consent screen in your browser.
4. Alternatively, paste a **Refresh Token** into the extension preferences (\`refreshToken\`) to skip the browser flow entirely, then choose **Use Refresh Token from Preferences** below.
`;

/** Refresh tokens live in extension preferences — never entered inline. */
function readPreferenceRefreshToken(): string | undefined {
  try {
    return getExtensionPreferences().refreshToken;
  } catch {
    return undefined;
  }
}

/**
 * Shared unauthenticated view for all four commands. Rendered as a root
 * view (Detail works in both List and Form commands).
 */
export function UnauthenticatedView({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [signingIn, setSigningIn] = useState(false);
  const [usingToken, setUsingToken] = useState(false);
  const preferenceRefreshToken = readPreferenceRefreshToken();
  const hasPreferenceToken =
    typeof preferenceRefreshToken === "string" && preferenceRefreshToken.length > 0;

  async function handleSignIn() {
    if (signingIn) return;
    setSigningIn(true);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Waiting for Google sign-in…",
      message: "Complete the approval in your browser",
    });
    try {
      await startBrowserAuthorization();
      toast.style = Toast.Style.Success;
      toast.title = "Signed in with Google";
      await toast.update();
      onAuthenticated();
    } catch (error) {
      if (error instanceof MissingClientIdError) {
        toast.style = Toast.Style.Failure;
        toast.title = "Google Client ID is missing";
        toast.message =
          "Set your Google OAuth Client ID in the extension preferences, then try again.";
        await toast.update();
      } else {
        const message = error instanceof Error ? error.message : String(error);
        toast.style = Toast.Style.Failure;
        toast.title = "Google sign-in failed";
        toast.message = message;
        await toast.update();
      }
    } finally {
      setSigningIn(false);
    }
  }

  async function handleUsePreferenceToken() {
    if (usingToken) return;
    const token = readPreferenceRefreshToken();
    if (!token) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No refresh token in preferences",
        message: "Paste a refresh token into the extension preferences first.",
      });
      return;
    }
    setUsingToken(true);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Signing in with refresh token…",
    });
    try {
      await authenticateWithRefreshToken(token);
      toast.style = Toast.Style.Success;
      toast.title = "Signed in with Google";
      await toast.update();
      onAuthenticated();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.style = Toast.Style.Failure;
      toast.title =
        error instanceof MissingClientIdError
          ? "Google Client ID is missing"
          : "Refresh token sign-in failed";
      toast.message =
        error instanceof MissingClientIdError
          ? "Set your Google OAuth Client ID in the extension preferences, then try again."
          : message;
      await toast.update();
    } finally {
      setUsingToken(false);
    }
  }

  async function handleOpenPreferences() {
    try {
      await openExtensionPreferences();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not open preferences",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <Detail
      markdown={SETUP_MARKDOWN}
      actions={
        <ActionPanel>
          <Action
            title="Sign in with Google"
            icon={Icon.PersonCircle}
            onAction={() => void handleSignIn()}
          />
          {hasPreferenceToken ? (
            <Action
              title="Use Refresh Token from Preferences"
              icon={Icon.Key}
              onAction={() => void handleUsePreferenceToken()}
            />
          ) : null}
          <Action
            title="Open Extension Preferences"
            icon={Icon.Cog}
            onAction={() => void handleOpenPreferences()}
          />
        </ActionPanel>
      }
    />
  );
}
