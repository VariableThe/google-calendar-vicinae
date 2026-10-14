import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Regression test for all-day events grouping on the wrong day west of UTC.
 * `new Date("2026-10-14")` is UTC midnight — still the previous local day in
 * negative-offset zones — so this runs the grouping in a child process with
 * `TZ=America/New_York`, where the old behaviour reports "Past" instead of
 * "Today". The child loads the real `date-utils.ts` through tsx.
 */
describe("all-day grouping west of UTC (TZ=America/New_York)", () => {
  it("groups a date-only event for today as Today, not Past", () => {
    const moduleUrl =
      "file://" + path.resolve(__dirname, "../src/lib/date-utils.ts");
    const script = [
      "import(" + JSON.stringify(moduleUrl) + ").then((m) => {",
      "  const fns = m.default ?? m;",
      "  const group = fns.formatEventDayGroup({ date: '2026-10-14' }, new Date(2026, 9, 14, 12, 0, 0));",
      "  if (group !== 'Today') { console.error('FAIL: grouped as ' + group); process.exit(1); }",
      "  // Guard that the timezone actually discriminates: UTC midnight must",
      "  // differ from local midnight, or this test proves nothing.",
      "  if (new Date('2026-10-14').getTime() === new Date(2026, 9, 14).getTime()) {",
      "    console.error('FAIL: no UTC offset under this TZ'); process.exit(2);",
      "  }",
      "  console.log('OK ' + group);",
      "}).catch((e) => { console.error(e); process.exit(1); });",
    ].join("\n");
    const out = execFileSync(process.execPath, ["--import", "tsx", "-e", script], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, TZ: "America/New_York" },
      encoding: "utf8",
    });
    assert.match(out, /OK Today/);
  });
});
