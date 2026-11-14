import { test } from "node:test";
import assert from "node:assert/strict";
import { overviewShowsEvent } from "./portal-calendar-window.js";

const at = (iso) => new Date(iso);
const event = (over = {}) => ({ status: "active", item_type: "event", starts_at: "2026-11-12T21:00:00Z", ...over });

test("a timed event stays through its end and is gone the moment after", () => {
  const item = event({ starts_at: "2026-11-12T20:00:00Z", ends_at: "2026-11-12T21:00:00Z" });
  assert.equal(overviewShowsEvent(item, at("2026-11-12T21:00:00Z")), true);
  assert.equal(overviewShowsEvent(item, at("2026-11-12T21:00:00.001Z")), false);
  assert.equal(overviewShowsEvent(event(), at("2026-11-13T14:48:00Z")), false);
});

test("an event earlier the same day is hidden once that time has passed", () => {
  assert.equal(overviewShowsEvent(event({ starts_at: "2026-11-12T08:00:00Z" }), at("2026-11-12T14:48:00Z")), false);
  assert.equal(overviewShowsEvent(event({ starts_at: "2026-11-12T20:00:00Z" }), at("2026-11-12T14:48:00Z")), true);
});

test("all-day stays through the Oslo day and a later end day", () => {
  const day = event({ all_day: true, starts_at: "2026-11-12T11:00:00Z" });
  assert.equal(overviewShowsEvent(day, at("2026-11-12T22:00:00Z")), true);
  assert.equal(overviewShowsEvent(day, at("2026-11-12T23:00:00Z")), false);
  const span = event({ all_day: true, starts_at: "2026-11-12T11:00:00Z", ends_at: "2026-11-13T12:00:00Z" });
  assert.equal(overviewShowsEvent(span, at("2026-11-13T20:00:00Z")), true);
  assert.equal(overviewShowsEvent(span, at("2026-11-13T23:00:00Z")), false);
});

test("undated active maintenance stays; finished and declined do not", () => {
  assert.equal(overviewShowsEvent({ status: "active", item_type: "event", maintenance_request_id: "m" }, at("2026-11-13T14:48:00Z")), true);
  assert.equal(overviewShowsEvent(event({ status: "completed" }), at("2026-11-12T10:00:00Z")), false);
  assert.equal(overviewShowsEvent(event({ tenant_response: "declined" }), at("2026-11-12T10:00:00Z")), false);
});
