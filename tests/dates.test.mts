import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dateKeyInMadrid,
  inDateKeyRange,
  madridMidnightIso,
  monthKeyInMadrid,
  monthRange,
  monthWeekBuckets,
  previousDateRange,
  shiftDateKey,
  yearRange,
} from "../src/lib/dates.ts";

test("Madrid midnight in winter and summer time", () => {
  assert.equal(madridMidnightIso(2026, 0, 1), "2025-12-31T23:00:00.000Z");
  assert.equal(madridMidnightIso(2026, 6, 1), "2026-06-30T22:00:00.000Z");
});

test("Madrid midnight on the two daylight-saving change days", () => {
  assert.equal(madridMidnightIso(2026, 2, 29), "2026-03-28T23:00:00.000Z");
  assert.equal(madridMidnightIso(2026, 9, 25), "2026-10-24T22:00:00.000Z");
});

test("month and year ranges start and end at Madrid midnight", () => {
  assert.deepEqual(
    { start: monthRange("2026-09").start, end: monthRange("2026-09").end },
    { start: "2026-08-31T22:00:00.000Z", end: "2026-09-30T22:00:00.000Z" },
  );
  assert.equal(monthRange("2026-12").end, "2026-12-31T23:00:00.000Z");
  assert.equal(yearRange(2026).start, "2025-12-31T23:00:00.000Z");
});

test("a record made at 00:30 in Madrid on the 1st belongs to that month", () => {
  assert.equal(monthKeyInMadrid("2026-08-31T22:30:00+00:00"), "2026-09");
  assert.equal(dateKeyInMadrid("2026-09-14T23:10:00.000Z"), "2026-09-15");
});

test("plain dates pass through unchanged", () => {
  assert.equal(dateKeyInMadrid("2026-09-01"), "2026-09-01");
});

test("date filters are inclusive on both ends in Madrid time", () => {
  assert.equal(inDateKeyRange("2026-09-15T21:59:00Z", "2026-09-01", "2026-09-15"), true);
  assert.equal(inDateKeyRange("2026-09-15T22:01:00Z", "2026-09-01", "2026-09-15"), false);
  assert.equal(inDateKeyRange("2026-01-01", "", ""), true);
});

test("week buckets cover the whole month without gaps", () => {
  const weeks = monthWeekBuckets("2026-09");
  assert.equal(weeks[0].start, "2026-08-31T22:00:00.000Z");
  assert.equal(weeks[weeks.length - 1].end, "2026-09-30T22:00:00.000Z");
  for (let index = 1; index < weeks.length; index++) assert.equal(weeks[index].start, weeks[index - 1].end);
});

test("previous comparison window has the same length and ends the day before", () => {
  assert.equal(shiftDateKey("2026-03-01", -1), "2026-02-28");
  assert.deepEqual(previousDateRange("2026-09-01", "2026-09-30"), { from: "2026-08-02", to: "2026-08-31" });
  assert.equal(previousDateRange("2026-09-01", ""), null);
  assert.equal(previousDateRange("2026-09-30", "2026-09-01"), null);
});
