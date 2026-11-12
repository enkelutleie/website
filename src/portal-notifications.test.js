import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationText, notificationTitle } from "./portal-notifications.js";

// Magnus 2026-11-12: maintenance dates need no tenant approval; both variants say a date is set.
test("maintenance_schedule_changed: same text for request and calendar destinations, no approval wording", () => {
  const n = (destination_type) => ({ notification_type: "maintenance_schedule_changed", destination_type, summary: "" });
  for (const d of ["maintenance_request", "calendar_item", null]) {
    const text = notificationText(n(d), "landlord");
    assert.equal(text, "Det er satt en dato for vedlikehold i boligen.");
    assert.doesNotMatch(text, /godkjenning/i);
  }
  assert.equal(notificationTitle(n("maintenance_request")), "Ny dato for vedlikehold");
});
