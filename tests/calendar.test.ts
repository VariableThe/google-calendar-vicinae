import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GoogleApiError,
  createCalendarClient,
  type FetchLike,
  type HttpResponseLike,
} from "../src/api/calendar.js";

function jsonResponse(body: unknown, status = 200): HttpResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function errorResponse(status: number, body: unknown): HttpResponseLike {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

interface RecordedCall {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown };
}

function makeFakeFetch(
  handler: (url: string, init?: RecordedCall["init"]) => Promise<HttpResponseLike>,
): { calls: RecordedCall[]; fetchImpl: FetchLike } {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const record = { url, init: init as RecordedCall["init"] };
    calls.push(record);
    return handler(url, record.init);
  };
  return { calls, fetchImpl };
}

describe("createCalendarClient", () => {
  it("listEvents builds correct URL with encoded calendarId and Bearer header", async () => {
    const { calls, fetchImpl } = makeFakeFetch(async () => jsonResponse({ items: [] }));
    const client = createCalendarClient({
      getAccessToken: async () => "tok-123",
      fetchImpl,
    });
    await client.listEvents("user@example.com", {
      timeMin: "2026-10-14T00:00:00.000Z",
      timeMax: "2026-10-21T00:00:00.000Z",
    });
    assert.equal(calls.length, 1);
    const { url, init } = calls[0];
    const parsed = new URL(url);
    assert.equal(
      parsed.pathname,
      "/calendar/v3/calendars/user%40example.com/events",
    );
    assert.equal(parsed.searchParams.get("singleEvents"), "true");
    assert.equal(parsed.searchParams.get("orderBy"), "startTime");
    assert.equal(parsed.searchParams.get("timeMin"), "2026-10-14T00:00:00.000Z");
    assert.equal(parsed.searchParams.get("timeMax"), "2026-10-21T00:00:00.000Z");
    assert.equal(parsed.searchParams.get("showDeleted"), "false");
    assert.ok(parsed.searchParams.get("maxResults"));
    assert.equal(init?.headers?.["Authorization"], "Bearer tok-123");
    assert.equal(init?.method, "GET");
  });

  it("listEvents forwards q, pageToken, maxResults and AbortSignal", async () => {
    const { calls, fetchImpl } = makeFakeFetch(async () =>
      jsonResponse({ items: [{ id: "e1" }], nextPageToken: "next-1" }),
    );
    const client = createCalendarClient({
      getAccessToken: async () => "tok",
      fetchImpl,
    });
    const controller = new AbortController();
    const result = await client.listEvents(
      "primary",
      {
        timeMin: "2026-10-14T00:00:00.000Z",
        timeMax: "2026-10-15T00:00:00.000Z",
        maxResults: 10,
        query: "standup",
        pageToken: "tok-abc",
      },
      controller.signal,
    );
    assert.deepEqual(result.items, [{ id: "e1" }]);
    assert.equal(result.nextPageToken, "next-1");
    const parsed = new URL(calls[0].url);
    assert.equal(parsed.searchParams.get("q"), "standup");
    assert.equal(parsed.searchParams.get("pageToken"), "tok-abc");
    assert.equal(parsed.searchParams.get("maxResults"), "10");
    assert.equal((calls[0].init as { signal?: unknown })?.signal, controller.signal);
  });

  it("listCalendars follows nextPageToken across pages", async () => {
    const seen: string[] = [];
    const { calls, fetchImpl } = makeFakeFetch(async (url) => {
      seen.push(url);
      const parsed = new URL(url);
      const pageToken = parsed.searchParams.get("pageToken");
      if (!pageToken) {
        return jsonResponse({ items: [{ id: "a" }], nextPageToken: "p2" });
      }
      assert.equal(pageToken, "p2");
      return jsonResponse({ items: [{ id: "b" }] });
    });
    const client = createCalendarClient({
      getAccessToken: async () => "tok",
      fetchImpl,
    });
    const result = await client.listCalendars();
    assert.deepEqual(result, [{ id: "a" }, { id: "b" }]);
    assert.equal(calls.length, 2);
    const first = new URL(seen[0]);
    assert.equal(first.pathname, "/calendar/v3/users/me/calendarList");
    assert.equal(first.searchParams.get("maxResults"), "250");
    assert.equal(first.searchParams.get("showHidden"), "false");
  });

  it("401 throws GoogleApiError with status 401", async () => {
    const { fetchImpl } = makeFakeFetch(async () =>
      errorResponse(401, {
        error: { message: "Invalid Credentials", errors: [{ reason: "authError" }] },
      }),
    );
    const client = createCalendarClient({
      getAccessToken: async () => "bad",
      fetchImpl,
    });
    await assert.rejects(() => client.getEvent("primary", "e1"), (err: unknown) => {
      assert.ok(err instanceof GoogleApiError);
      assert.equal((err as GoogleApiError).status, 401);
      assert.match((err as Error).message, /Invalid Credentials/);
      assert.equal((err as GoogleApiError).reason, "authError");
      return true;
    });
  });

  it("403 message includes Google's error message", async () => {
    const { fetchImpl } = makeFakeFetch(async () =>
      errorResponse(403, {
        error: { message: "Quota exceeded for quux", errors: [{ reason: "quotaExceeded" }] },
      }),
    );
    const client = createCalendarClient({
      getAccessToken: async () => "tok",
      fetchImpl,
    });
    await assert.rejects(() => client.listCalendars(), (err: unknown) => {
      assert.ok(err instanceof GoogleApiError);
      assert.equal((err as GoogleApiError).status, 403);
      assert.match((err as Error).message, /Quota exceeded for quux/);
      return true;
    });
  });

  it("quickAdd posts text as a query param", async () => {
    const { calls, fetchImpl } = makeFakeFetch(async () => jsonResponse({ id: "q1" }));
    const client = createCalendarClient({
      getAccessToken: async () => "tok",
      fetchImpl,
    });
    const event = await client.quickAddEvent("primary", "Lunch tomorrow at noon", {
      sendUpdates: "none",
    });
    assert.equal(event.id, "q1");
    assert.equal(calls.length, 1);
    const parsed = new URL(calls[0].url);
    assert.ok(parsed.pathname.endsWith("/events/quickAdd"));
    assert.equal(parsed.searchParams.get("text"), "Lunch tomorrow at noon");
    assert.equal(parsed.searchParams.get("sendUpdates"), "none");
    assert.equal(calls[0].init?.method, "POST");
  });

  it("createEvent sets conferenceDataVersion when asked and sends JSON body", async () => {
    const { calls, fetchImpl } = makeFakeFetch(async () => jsonResponse({ id: "c1" }));
    const client = createCalendarClient({
      getAccessToken: async () => "tok",
      fetchImpl,
    });
    await client.createEvent(
      "primary",
      {
        summary: "Sync",
        start: { dateTime: "2026-10-15T09:00:00+05:30" },
        end: { dateTime: "2026-10-15T09:30:00+05:30" },
        conferenceData: {
          createRequest: {
            requestId: "req-1",
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
      { conferenceDataVersion: 1, sendUpdates: "all" },
    );
    const parsed = new URL(calls[0].url);
    assert.equal(parsed.searchParams.get("conferenceDataVersion"), "1");
    assert.equal(parsed.searchParams.get("sendUpdates"), "all");
    const body = JSON.parse(calls[0].init?.body ?? "{}");
    assert.equal(body.summary, "Sync");
    assert.equal(body.conferenceData.createRequest.requestId, "req-1");
  });

  it("obtains a fresh token for every request", async () => {
    let n = 0;
    const { fetchImpl } = makeFakeFetch(async () => jsonResponse({ id: "e" }));
    const client = createCalendarClient({
      getAccessToken: async () => `tok-${++n}`,
      fetchImpl,
    });
    await client.getEvent("primary", "a");
    await client.getEvent("primary", "b");
    assert.equal(n, 2);
  });

  it("encodes special calendarIds and eventIds in paths", async () => {
    const { calls, fetchImpl } = makeFakeFetch(async () => jsonResponse({ id: "e" }));
    const client = createCalendarClient({
      getAccessToken: async () => "tok",
      fetchImpl,
    });
    await client.getEvent("a/b#c", "d/e");
    assert.ok(calls[0].url.includes("/calendars/a%2Fb%23c/events/d%2Fe"));
  });

  it("401 invalidates once and retries with the fresh token", async () => {
    let tokenCalls = 0;
    let invalidations = 0;
    const { calls, fetchImpl } = makeFakeFetch(async (url, init) => {
      const auth = init?.headers?.["Authorization"];
      if (auth === "Bearer stale-token") {
        return errorResponse(401, {
          error: { message: "Invalid Credentials", errors: [{ reason: "authError" }] },
        });
      }
      return jsonResponse({ id: "e1" });
    });
    const client = createCalendarClient({
      getAccessToken: async () => (++tokenCalls === 1 ? "stale-token" : "fresh-token"),
      invalidateAccessToken: async () => {
        invalidations++;
      },
      fetchImpl,
    });
    const event = await client.getEvent("primary", "e1");
    assert.equal(event.id, "e1");
    assert.equal(calls.length, 2);
    assert.equal(invalidations, 1);
    assert.equal(tokenCalls, 2);
    assert.equal(calls[0].init?.headers?.["Authorization"], "Bearer stale-token");
    assert.equal(calls[1].init?.headers?.["Authorization"], "Bearer fresh-token");
  });

  it("a second 401 surfaces GoogleApiError with status 401 after exactly two attempts", async () => {
    let invalidations = 0;
    const { calls, fetchImpl } = makeFakeFetch(async () =>
      errorResponse(401, {
        error: { message: "Invalid Credentials", errors: [{ reason: "authError" }] },
      }),
    );
    const client = createCalendarClient({
      getAccessToken: async () => "still-bad",
      invalidateAccessToken: async () => {
        invalidations++;
      },
      fetchImpl,
    });
    await assert.rejects(() => client.getEvent("primary", "e1"), (err: unknown) => {
      assert.ok(err instanceof GoogleApiError);
      assert.equal((err as GoogleApiError).status, 401);
      return true;
    });
    assert.equal(calls.length, 2);
    assert.equal(invalidations, 1);
  });
});

describe("listAllEvents", () => {
  const baseParams = {
    timeMin: "2026-10-14T00:00:00.000Z",
    timeMax: "2026-10-21T00:00:00.000Z",
  };

  function pageTokensOf(calls: { url: string }[]): (string | null)[] {
    return calls.map((c) => new URL(c.url).searchParams.get("pageToken"));
  }

  it("follows nextPageToken across pages and stops when a page omits the token", async () => {
    const { calls, fetchImpl } = makeFakeFetch(async (url) => {
      const pageToken = new URL(url).searchParams.get("pageToken");
      if (pageToken === null) return jsonResponse({ items: [{ id: "e1" }], nextPageToken: "p2" });
      if (pageToken === "p2") return jsonResponse({ items: [{ id: "e2" }], nextPageToken: "p3" });
      assert.equal(pageToken, "p3");
      return jsonResponse({ items: [{ id: "e3" }] });
    });
    const client = createCalendarClient({
      getAccessToken: async () => "tok",
      fetchImpl,
    });
    const items = await client.listAllEvents("primary", baseParams);
    assert.deepEqual(items.map((e) => e.id), ["e1", "e2", "e3"]);
    assert.equal(calls.length, 3);
    assert.deepEqual(pageTokensOf(calls), [null, "p2", "p3"]);
  });

  it("respects maxPages", async () => {
    const { calls, fetchImpl } = makeFakeFetch(async (url) => {
      const pageToken = new URL(url).searchParams.get("pageToken");
      if (pageToken === null) return jsonResponse({ items: [{ id: "e1" }], nextPageToken: "p2" });
      return jsonResponse({ items: [{ id: "e2" }], nextPageToken: "p3" });
    });
    const client = createCalendarClient({
      getAccessToken: async () => "tok",
      fetchImpl,
    });
    const items = await client.listAllEvents("primary", baseParams, { maxPages: 2 });
    assert.deepEqual(items.map((e) => e.id), ["e1", "e2"]);
    assert.equal(calls.length, 2);
    assert.deepEqual(pageTokensOf(calls), [null, "p2"]);
  });

  it("returns a single page when the first response has no token", async () => {
    const { calls, fetchImpl } = makeFakeFetch(async () =>
      jsonResponse({ items: [{ id: "only" }] }),
    );
    const client = createCalendarClient({
      getAccessToken: async () => "tok",
      fetchImpl,
    });
    const items = await client.listAllEvents("primary", baseParams);
    assert.deepEqual(items.map((e) => e.id), ["only"]);
    assert.equal(calls.length, 1);
  });
});
