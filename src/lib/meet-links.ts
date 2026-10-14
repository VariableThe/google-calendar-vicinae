import type { GoogleEvent } from "../api/calendar";

type MeetingEvent = Pick<
  GoogleEvent,
  "hangoutLink" | "conferenceData" | "location" | "description"
>;

const URL_RE = /https?:\/\/[^\s<>"')]+/g;

function firstUrl(text: string | undefined): string | undefined {
  if (typeof text !== "string" || text.length === 0) return undefined;
  const matches = text.match(URL_RE);
  if (!matches || matches.length === 0) return undefined;
  // Strip trailing punctuation that is rarely part of the URL.
  return matches[0].replace(/[.,;!?)\]]+$/, "");
}

/**
 * Meeting URL priority: hangoutLink -> conferenceData video entryPoint uri
 * -> first URL in location -> first URL in description.
 */
export function getMeetingUrl(
  event: MeetingEvent | undefined,
): string | undefined {
  if (!event) return undefined;
  if (typeof event.hangoutLink === "string" && event.hangoutLink.length > 0) {
    return event.hangoutLink;
  }
  const entryPoints = event.conferenceData?.entryPoints;
  if (Array.isArray(entryPoints)) {
    const video = entryPoints.find(
      (e) => e.entryPointType === "video" && typeof e.uri === "string" && e.uri.length > 0,
    );
    if (video?.uri) return video.uri;
    const anyUri = entryPoints.find(
      (e) => typeof e.uri === "string" && (e.uri as string).length > 0,
    );
    if (anyUri?.uri) return anyUri.uri;
  }
  return firstUrl(event.location) ?? firstUrl(event.description);
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function isVideoCallUrl(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  if (host === "meet.google.com" || host.endsWith(".meet.google.com")) return true;
  if (host === "zoom.us" || host.endsWith(".zoom.us")) return true;
  if (host === "teams.microsoft.com" || host.endsWith(".teams.microsoft.com")) return true;
  if (host === "teams.live.com" || host.endsWith(".teams.live.com")) return true;
  if (host === "webex.com" || host.endsWith(".webex.com")) return true;
  if (host === "whereby.com" || host.endsWith(".whereby.com")) return true;
  if (host === "meet.jit.si" || host.endsWith(".meet.jit.si")) return true;
  if (host.includes("jitsi")) return true;
  return false;
}

export function getMeetingProviderName(url: string): string | undefined {
  const host = hostnameOf(url);
  if (!host) return undefined;
  if (host === "meet.google.com" || host.endsWith(".meet.google.com")) return "Google Meet";
  if (host === "zoom.us" || host.endsWith(".zoom.us")) return "Zoom";
  if (host === "teams.microsoft.com" || host.endsWith(".teams.microsoft.com")) {
    return "Microsoft Teams";
  }
  if (host === "teams.live.com" || host.endsWith(".teams.live.com")) return "Microsoft Teams";
  if (host === "webex.com" || host.endsWith(".webex.com")) return "Webex";
  if (host === "whereby.com" || host.endsWith(".whereby.com")) return "Whereby";
  if (host === "meet.jit.si" || host.endsWith(".meet.jit.si") || host.includes("jitsi")) {
    return "Jitsi";
  }
  return undefined;
}
