/**
 * Lazy access to getPreferenceValues: a static import of @vicinae/api crashes
 * at module load outside the Vicinae host (its init reads host globals), and
 * unit tests must run under plain tsx. So require it only when actually
 * reading preferences — a path tests never touch.
 */
function readRawPreferences(): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const api = require("@vicinae/api") as typeof import("@vicinae/api");
  return api.getPreferenceValues<Record<string, unknown>>();
}

export interface ExtensionPreferences {
  googleClientId?: string;
  googleClientSecret?: string;
  refreshToken?: string;
  defaultCalendarId?: string;
  defaultEventDuration: string;
}

export interface ListEventsPreferences {
  daysToShow: string;
  showLocation: boolean;
  openCommandJoinsMeeting: boolean;
}

/** Textfield/password preferences come back as "" when unset — normalize to undefined. */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function getExtensionPreferences(): ExtensionPreferences {
  const raw = readRawPreferences();
  return {
    googleClientId: optionalString(raw["googleClientId"]),
    googleClientSecret: optionalString(raw["googleClientSecret"]),
    refreshToken: optionalString(raw["refreshToken"]),
    defaultCalendarId: optionalString(raw["defaultCalendarId"]),
    defaultEventDuration: optionalString(raw["defaultEventDuration"]) ?? "30",
  };
}

export function getListEventsPreferences(): ListEventsPreferences {
  const raw = readRawPreferences();
  return {
    daysToShow: optionalString(raw["daysToShow"]) ?? "7",
    showLocation: raw["showLocation"] === true,
    openCommandJoinsMeeting: raw["openCommandJoinsMeeting"] === true,
  };
}
