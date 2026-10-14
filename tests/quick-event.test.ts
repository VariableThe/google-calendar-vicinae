import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseQuickEventText } from "../src/lib/quick-event.js";

const NOW = new Date(2026, 9, 14, 9, 0, 0);

describe("parseQuickEventText", () => {
  it("parses an explicit date and time", () => {
    const preview = parseQuickEventText("Team sync on October 20, 2026 at 3pm", NOW);
    assert.ok(preview);
    assert.equal(preview.title, "Team sync");
    assert.ok(preview.start instanceof Date);
    assert.equal(preview.start?.getFullYear(), 2026);
    assert.equal(preview.start?.getMonth(), 9);
    assert.equal(preview.start?.getDate(), 20);
    assert.equal(preview.start?.getHours(), 15);
    assert.equal(preview.hasTime, true);
    assert.equal(preview.confidence, "high");
  });

  it("parses relative phrasing", () => {
    const preview = parseQuickEventText("Dentist tomorrow at 5pm", NOW);
    assert.ok(preview);
    assert.equal(preview.title, "Dentist");
    assert.ok(preview.start instanceof Date);
    assert.equal(preview.start?.getFullYear(), 2026);
    assert.equal(preview.start?.getMonth(), 9);
    assert.equal(preview.start?.getDate(), 15);
    assert.equal(preview.start?.getHours(), 17);
    assert.equal(preview.hasTime, true);
  });

  it("honours duration phrases", () => {
    const preview = parseQuickEventText("Focus time tomorrow for 90 minutes", NOW);
    assert.ok(preview);
    assert.ok(preview.start);
    assert.ok(preview.end);
    const minutes = (preview.end.getTime() - preview.start.getTime()) / 60_000;
    assert.equal(minutes, 90);
    assert.equal(preview.title, "Focus time");
  });

  it("falls back when there is no date", () => {
    const preview = parseQuickEventText("Buy milk", NOW);
    assert.ok(preview);
    assert.equal(preview.title, "Buy milk");
    assert.equal(preview.start, undefined);
    assert.equal(preview.end, undefined);
    assert.equal(preview.hasTime, false);
    assert.equal(preview.confidence, "none");
  });

  it("strips the parsed date words from the title", () => {
    const preview = parseQuickEventText("Lunch with Bob tomorrow at noon", NOW);
    assert.ok(preview);
    assert.equal(preview.title, "Lunch with Bob");
    assert.equal(preview.hasTime, true);
    assert.ok(preview.start);
    assert.equal(preview.start?.getDate(), 15);
    assert.equal(preview.start?.getHours(), 12);
  });

  it("returns undefined for empty input", () => {
    assert.equal(parseQuickEventText("   ", NOW), undefined);
  });
});
