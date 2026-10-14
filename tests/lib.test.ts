import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addMinutes,
  computeTimeRange,
  formatEventDayGroup,
  formatEventTimeRange,
  isAllDay,
  resolveEventDurationMinutes,
  toLocalISOString,
} from "../src/lib/date-utils.js";
import {
  GOOGLE_EVENT_COLORS,
  formatRecurrenceRule,
  getAttendeeSummary,
  getResponseStatusLabel,
  parseAttendeeEmails,
  resolveEventColorId,
} from "../src/lib/event-values.js";
import {
  getMeetingProviderName,
  getMeetingUrl,
  isVideoCallUrl,
} from "../src/lib/meet-links.js";

describe("date-utils", () => {
  it("resolveEventDurationMinutes handles valid/invalid/missing", () => {
    assert.equal(resolveEventDurationMinutes("60"), 60);
    assert.equal(resolveEventDurationMinutes(45), 45);
    assert.equal(resolveEventDurationMinutes(undefined), 30);
    assert.equal(resolveEventDurationMinutes(undefined, 90), 90);
    assert.equal(resolveEventDurationMinutes("bogus"), 30);
    assert.equal(resolveEventDurationMinutes("bogus", 60), 60);
    assert.equal(resolveEventDurationMinutes(0), 30);
    assert.equal(resolveEventDurationMinutes(-15), 30);
    assert.equal(resolveEventDurationMinutes("0"), 30);
  });

  it("computeTimeRange clamps and defaults", () => {
    const now = new Date("2026-10-14T00:00:00.000Z");
    const r7 = computeTimeRange(undefined, now);
    assert.equal(r7.timeMin, now.toISOString());
    assert.equal(r7.timeMax, new Date(now.getTime() + 7 * 86400000).toISOString());

    const r1 = computeTimeRange(0, now);
    assert.equal(r1.timeMax, new Date(now.getTime() + 1 * 86400000).toISOString());

    const r30 = computeTimeRange(99, now);
    assert.equal(r30.timeMax, new Date(now.getTime() + 30 * 86400000).toISOString());

    const rStr = computeTimeRange("3", now);
    assert.equal(rStr.timeMax, new Date(now.getTime() + 3 * 86400000).toISOString());

    const rBad = computeTimeRange("nope", now);
    assert.equal(rBad.timeMax, new Date(now.getTime() + 7 * 86400000).toISOString());
  });

  it("isAllDay distinguishes date vs dateTime", () => {
    assert.equal(isAllDay({ date: "2026-10-14" }), true);
    assert.equal(isAllDay({ dateTime: "2026-10-14T09:00:00Z" }), false);
    assert.equal(isAllDay(undefined), false);
    assert.equal(isAllDay({}), false);
  });

  it("formatEventTimeRange formats timed ranges and all-day", () => {
    const timed = formatEventTimeRange(
      { dateTime: "2026-10-14T09:00:00.000Z" },
      { dateTime: "2026-10-14T10:00:00.000Z" },
      { timeZone: "UTC", locale: "en-US" },
    );
    assert.match(timed, /9:00/);
    assert.match(timed, /10:00/);

    const withDate = formatEventTimeRange(
      { dateTime: "2026-03-03T09:00:00.000Z" },
      { dateTime: "2026-03-03T10:00:00.000Z" },
      { timeZone: "UTC", locale: "en-US", includeDate: true },
    );
    assert.match(withDate, /Mar 3/);

    assert.equal(
      formatEventTimeRange({ date: "2026-10-14" }, { date: "2026-10-15" }),
      "All day",
    );
    assert.equal(formatEventTimeRange({ dateTime: "bogus" }, undefined), "");
    assert.equal(formatEventTimeRange(undefined, undefined), "");
  });

  it("formatEventDayGroup classifies today/tomorrow/future/past", () => {
    const now = new Date("2026-10-14T12:00:00.000Z");
    assert.equal(
      formatEventDayGroup({ dateTime: "2026-10-14T18:00:00.000Z" }, now),
      "Today",
    );
    assert.equal(
      formatEventDayGroup({ dateTime: "2026-10-15T09:00:00.000Z" }, now),
      "Tomorrow",
    );
    assert.equal(
      formatEventDayGroup({ dateTime: "2026-10-20T09:00:00.000Z" }, now),
      "Upcoming",
    );
    assert.equal(
      formatEventDayGroup({ dateTime: "2026-10-10T09:00:00.000Z" }, now),
      "Past",
    );
    assert.equal(formatEventDayGroup({ date: "2026-10-14" }, now), "Today");
  });

  it("toLocalISOString has offset-preserving shape", () => {
    const out = toLocalISOString(new Date(2026, 9, 14, 9, 0, 0));
    assert.match(out, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    assert.ok(out.startsWith("2026-10-14T09:00:00"));
  });

  it("addMinutes shifts the date", () => {
    const base = new Date("2026-10-14T09:00:00.000Z");
    assert.equal(addMinutes(base, 30).toISOString(), "2026-10-14T09:30:00.000Z");
  });
});

describe("event-values", () => {
  it("color map covers 1..11 with canonical entries", () => {
    for (let i = 1; i <= 11; i++) {
      assert.ok(GOOGLE_EVENT_COLORS[String(i)], `missing color ${i}`);
    }
    assert.equal(GOOGLE_EVENT_COLORS["1"].hex, "#7986cb");
    assert.equal(GOOGLE_EVENT_COLORS["11"].hex, "#d50000");
    assert.equal(Object.keys(GOOGLE_EVENT_COLORS).length, 11);
  });

  it("resolveEventColorId passes valid ids through, rejects others", () => {
    assert.equal(resolveEventColorId({ colorId: "4" }, "#7986cb"), "4");
    assert.equal(resolveEventColorId({ colorId: "99" }, "#7986cb"), undefined);
    assert.equal(resolveEventColorId({}, "#7986cb"), undefined);
    assert.equal(resolveEventColorId(undefined, "#7986cb"), undefined);
  });

  it("parseAttendeeEmails handles messy separators, dupes, case, junk", () => {
    assert.deepEqual(
      parseAttendeeEmails("Ada@Example.com, bob@example.com;ADA@example.com\ncarol@example.org  junk not-an-email"),
      ["ada@example.com", "bob@example.com", "carol@example.org"],
    );
    assert.deepEqual(parseAttendeeEmails(""), []);
    assert.deepEqual(parseAttendeeEmails("   , ;  "), []);
  });

  it("formatRecurrenceRule humanizes common rules", () => {
    assert.equal(
      formatRecurrenceRule("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"),
      "Every 2 weeks on Mon, Wed",
    );
    assert.equal(formatRecurrenceRule("RRULE:FREQ=DAILY"), "Every day");
    assert.equal(formatRecurrenceRule("RRULE:FREQ=MONTHLY;COUNT=6"), "Every month, 6 times");
    assert.equal(
      formatRecurrenceRule("RRULE:FREQ=YEARLY;UNTIL=20271231"),
      "Every year until Dec 31, 2027",
    );
    assert.equal(formatRecurrenceRule(undefined), undefined);
    assert.equal(formatRecurrenceRule("not a rule"), undefined);
    assert.equal(formatRecurrenceRule("RRULE:FREQ=HOURLY"), undefined);
  });

  it("getAttendeeSummary and getResponseStatusLabel", () => {
    assert.equal(getAttendeeSummary(undefined), undefined);
    assert.equal(getAttendeeSummary({ attendees: [] }), undefined);
    assert.equal(
      getAttendeeSummary({ attendees: [{ email: "a@x.com", displayName: "Ada" }] }),
      "Ada",
    );
    assert.equal(
      getAttendeeSummary({ attendees: [{ email: "a@x.com" }] }),
      "a@x.com",
    );
    assert.equal(
      getAttendeeSummary({ attendees: [{}, {}, {}] }),
      "3 guests",
    );
    assert.equal(getResponseStatusLabel("accepted"), "Accepted");
    assert.equal(getResponseStatusLabel("declined"), "Declined");
    assert.equal(getResponseStatusLabel("tentative"), "Tentative");
    assert.equal(getResponseStatusLabel("needsAction"), "No reply");
    assert.equal(getResponseStatusLabel("unknown"), undefined);
    assert.equal(getResponseStatusLabel(undefined), undefined);
  });
});

describe("meet-links", () => {
  it("prefers hangoutLink over description", () => {
    const url = getMeetingUrl({
      hangoutLink: "https://meet.google.com/abc-defg-hij",
      description: "Join at https://zoom.us/j/123",
    });
    assert.equal(url, "https://meet.google.com/abc-defg-hij");
  });

  it("uses conferenceData video entryPoint", () => {
    const url = getMeetingUrl({
      conferenceData: {
        entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/xyz" }],
      },
    });
    assert.equal(url, "https://meet.google.com/xyz");
  });

  it("falls back to location then description URLs", () => {
    assert.equal(
      getMeetingUrl({ location: "Room 5 https://teams.live.com/meet/1" }),
      "https://teams.live.com/meet/1",
    );
    assert.equal(
      getMeetingUrl({ description: "See https://whereby.com/team-room for details" }),
      "https://whereby.com/team-room",
    );
    assert.equal(getMeetingUrl({}), undefined);
    assert.equal(getMeetingUrl(undefined), undefined);
  });

  it("isVideoCallUrl positives and negatives", () => {
    assert.equal(isVideoCallUrl("https://meet.google.com/abc"), true);
    assert.equal(isVideoCallUrl("https://acme.zoom.us/j/123"), true);
    assert.equal(isVideoCallUrl("https://teams.microsoft.com/l/meetup"), true);
    assert.equal(isVideoCallUrl("https://www.google.com/search?q=x"), false);
    assert.equal(isVideoCallUrl("https://example.com/meet"), false);
    assert.equal(isVideoCallUrl("not a url"), false);
  });

  it("getMeetingProviderName maps providers", () => {
    assert.equal(getMeetingProviderName("https://meet.google.com/a"), "Google Meet");
    assert.equal(getMeetingProviderName("https://acme.zoom.us/j/1"), "Zoom");
    assert.equal(getMeetingProviderName("https://teams.microsoft.com/x"), "Microsoft Teams");
    assert.equal(getMeetingProviderName("https://teams.live.com/x"), "Microsoft Teams");
    assert.equal(getMeetingProviderName("https://acme.webex.com/meet"), "Webex");
    assert.equal(getMeetingProviderName("https://team.whereby.com/r"), "Whereby");
    assert.equal(getMeetingProviderName("https://meet.jit.si/room"), "Jitsi");
    assert.equal(getMeetingProviderName("https://example.com"), undefined);
  });
});
