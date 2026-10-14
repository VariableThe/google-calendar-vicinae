import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveDefaultCalendarId,
  resolveDefaultCalendarSource,
} from "../src/lib/calendar-selection.js";

const CALENDARS = [
  { id: "work@example.com", primary: false },
  { id: "user@example.com", primary: true },
];

describe("resolveDefaultCalendarId", () => {
  it("preference override wins over stored, primary, and first", () => {
    assert.equal(
      resolveDefaultCalendarId({
        preferenceId: "override@example.com",
        storedId: "work@example.com",
        calendars: CALENDARS,
      }),
      "override@example.com",
    );
  });

  it("stored choice wins when no preference is set", () => {
    assert.equal(
      resolveDefaultCalendarId({ storedId: "work@example.com", calendars: CALENDARS }),
      "work@example.com",
    );
  });

  it("falls back to primary, then first, then primary", () => {
    assert.equal(resolveDefaultCalendarId({ calendars: CALENDARS }), "user@example.com");
    assert.equal(
      resolveDefaultCalendarId({ calendars: [{ id: "only@example.com" }] }),
      "only@example.com",
    );
    assert.equal(resolveDefaultCalendarId({}), "primary");
  });
});

describe("resolveDefaultCalendarSource", () => {
  it("reports where the effective default came from", () => {
    assert.equal(
      resolveDefaultCalendarSource({ preferenceId: "a", storedId: "b", calendars: CALENDARS }),
      "preference",
    );
    assert.equal(
      resolveDefaultCalendarSource({ storedId: "b", calendars: CALENDARS }),
      "stored",
    );
    assert.equal(resolveDefaultCalendarSource({ calendars: CALENDARS }), "primary");
    assert.equal(
      resolveDefaultCalendarSource({ calendars: [{ id: "only@example.com" }] }),
      "first",
    );
    assert.equal(resolveDefaultCalendarSource({}), "fallback");
  });
});
