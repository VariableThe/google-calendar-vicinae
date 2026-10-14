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
  resolveEventColorHex,
  resolveEventColorId,
  splitAttendeeEmails,
} from "../src/lib/event-values.js";
import {
  compareEventsByStart,
  dedupeEvents,
} from "../src/lib/event-dedupe.js";
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

  it("formatEventDayGroup classifies today/tomorrow/future/past", () => {    const now = new Date("2026-10-14T12:00:00.000Z");
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

  it("date-only values resolve to local midnight, not UTC midnight", () => {
    // Timezone-agnostic: a date-only start is the same instant as
    // constructing local midnight directly. (`new Date("2026-10-14")` is
    // UTC midnight, which is the previous local day west of UTC.)
    const localMidnight = new Date(2026, 9, 14);
    assert.equal(
      compareEventsByStart(
        { id: "timed", start: { dateTime: toLocalISOString(localMidnight) } },
        { id: "allday", start: { date: "2026-10-14" } },
      ),
      0,
    );
  });

  it("date-only events group by local calendar day", () => {
    // All-local construction, so this holds in every timezone.
    const now = new Date(2026, 9, 14, 12, 0, 0);
    assert.equal(formatEventDayGroup({ date: "2026-10-14" }, now), "Today");
    assert.equal(formatEventDayGroup({ date: "2026-10-15" }, now), "Tomorrow");
    assert.equal(formatEventDayGroup({ date: "2026-10-20" }, now), "Upcoming");
    assert.equal(formatEventDayGroup({ date: "2026-10-13" }, now), "Past");
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
    assert.equal(resolveEventColorId({ colorId: "4" }), "4");
    assert.equal(resolveEventColorId({ colorId: "99" }), undefined);
    assert.equal(resolveEventColorId({}), undefined);
    assert.equal(resolveEventColorId(undefined), undefined);
  });

  it("resolveEventColorHex prefers the event color, falls back to calendar", () => {
    assert.equal(resolveEventColorHex({ colorId: "4" }, "#123456"), "#e67c73");
    assert.equal(resolveEventColorHex({ colorId: "99" }, "#123456"), "#123456");
    assert.equal(resolveEventColorHex({}, "#123456"), "#123456");
    assert.equal(resolveEventColorHex(undefined, undefined), undefined);
  });

  it("parseAttendeeEmails handles messy separators, dupes, case, junk", () => {
    assert.deepEqual(
      parseAttendeeEmails("Ada@Example.com, bob@example.com;ADA@example.com\ncarol@example.org  junk not-an-email"),
      ["ada@example.com", "bob@example.com", "carol@example.org"],
    );
    assert.deepEqual(parseAttendeeEmails(""), []);
    assert.deepEqual(parseAttendeeEmails("   , ;  "), []);
  });

  it("splitAttendeeEmails reports invalid tokens while keeping valid ones", () => {
    const split = splitAttendeeEmails("ada@example.com, not-an-email bob@ bad@x");
    assert.deepEqual(split.valid, ["ada@example.com"]);
    assert.deepEqual(split.invalid, ["not-an-email", "bob@", "bad@x"]);
    assert.deepEqual(splitAttendeeEmails(""), { valid: [], invalid: [] });
    const dupes = splitAttendeeEmails("junk junk ADA@example.com,ada@example.com");
    assert.deepEqual(dupes.valid, ["ada@example.com"]);
    assert.deepEqual(dupes.invalid, ["junk"]);
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

  it("ignores non-video URLs in location/description", () => {
    assert.equal(
      getMeetingUrl({ description: "Notes: https://docs.google.com/document/d/abc123/edit" }),
      undefined,
    );
    assert.equal(
      getMeetingUrl({ location: "HQ, see https://example.com/agenda" }),
      undefined,
    );
    // A docs link followed by a real meeting link resolves to the meeting link.
    assert.equal(
      getMeetingUrl({
        description:
          "Notes https://docs.google.com/document/d/abc join https://meet.google.com/abc-defg-hij",
      }),
      "https://meet.google.com/abc-defg-hij",
    );
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

describe("event-dedupe", () => {
  function item(calendarId: string, overrides: Record<string, unknown> = {}) {
    return {
      calendarId,
      event: {
        id: `id-${calendarId}`,
        iCalUID: "uid-1",
        summary: "Standup",
        start: { dateTime: "2026-10-15T09:00:00.000Z" },
        ...overrides,
      },
    };
  }

  it("collapses only the same occurrence (uid + start + summary)", () => {
    const a = item("work");
    const b = item("personal");
    assert.equal(dedupeEvents([a, b], "work", "personal").length, 1);

    const differentStart = item("personal", { start: { dateTime: "2026-10-15T10:00:00.000Z" } });
    assert.equal(dedupeEvents([a, differentStart], "work", "personal").length, 2);

    const differentSummary = item("personal", { summary: "Different" });
    assert.equal(dedupeEvents([a, differentSummary], "work", "personal").length, 2);
  });

  it("prefers the user's default calendar over the primary", () => {
    const primary = item("primary-cal");
    const def = item("work-cal");
    const winner = dedupeEvents([primary, def], "work-cal", "primary-cal");
    assert.equal(winner.length, 1);
    assert.equal(winner[0].calendarId, "work-cal");
    // Order-independent: default still wins when listed second.
    const winner2 = dedupeEvents([def, primary], "work-cal", "primary-cal");
    assert.equal(winner2[0].calendarId, "work-cal");
  });

  it("falls back to primary, then first occurrence", () => {
    const a = item("a");
    const b = item("b");
    assert.equal(dedupeEvents([a, b], undefined, "b")[0].calendarId, "b");
    assert.equal(dedupeEvents([a, b])[0].calendarId, "a");
  });

  it("never collapses events without an iCalUID", () => {
    const a = { calendarId: "a", event: { id: "same", summary: "X" } };
    const b = { calendarId: "b", event: { id: "same", summary: "X" } };
    assert.equal(dedupeEvents([a, b], "a", "b").length, 2);
  });

  it("compareEventsByStart orders by start instant", () => {
    const early = { id: "e", start: { dateTime: "2026-10-15T09:00:00.000Z" } };
    const late = { id: "l", start: { dateTime: "2026-10-15T10:00:00.000Z" } };
    assert.ok(compareEventsByStart(early, late) < 0);
    assert.ok(compareEventsByStart(late, early) > 0);
    assert.equal(compareEventsByStart(early, { ...early }), 0);
  });
});
