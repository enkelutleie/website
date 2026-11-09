import assert from "node:assert/strict";
import test from "node:test";
import { osloParts, osloTodayISO, osloWallToUtcIso, osloYear } from "./oslo-time.js";

test("Oslo wall time becomes the matching UTC instant", () => {
  assert.equal(osloWallToUtcIso("2026-11-15", "00:00"), "2026-11-14T23:00:00Z");
  assert.equal(osloWallToUtcIso("2026-07-15", "00:00"), "2026-07-14T22:00:00Z");
  assert.equal(osloWallToUtcIso("2026-11-15", "09:30"), "2026-11-15T08:30:00Z");
});

test("an instant is shown again as Oslo wall time", () => {
  const winter = osloParts(new Date("2026-11-14T23:00:00Z"));
  assert.equal(winter.date, "2026-11-15");
  assert.equal(winter.time, "00:00");
  const summer = osloParts(new Date("2026-07-14T22:00:00Z"));
  assert.equal(summer.date, "2026-07-15");
  assert.equal(summer.time, "00:00");
});

test("the calendar year follows Oslo across New Year", () => {
  assert.equal(osloYear(new Date("2025-12-31T23:30:00Z")), 2026);
  assert.equal(osloYear(new Date("2026-01-01T00:30:00Z")), 2026);
  assert.equal(osloTodayISO(new Date("2025-12-31T23:30:00Z")), "2026-01-01");
});
