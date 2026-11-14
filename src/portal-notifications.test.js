import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationRoute, notificationText, notificationTitle } from "./portal-notifications.js";

// Magnus 2026-11-12: maintenance dates need no tenant approval; both variants say a date is set.
test("maintenance_schedule_changed: same text for request and calendar destinations, no approval wording", () => {
  const n = (destination_type) => ({ notification_type: "maintenance_schedule_changed", destination_type, summary: "" });
  for (const d of ["maintenance_request", "calendar_item", null]) {
    const text = notificationText(n(d), "landlord");
    assert.equal(text, "Det er satt en dato for vedlikehold i boligen.");
    assert.doesNotMatch(text, /godkjenning/i);
  }
  assert.equal(notificationTitle(n("maintenance_request")), "Ny dato for vedlikehold");
  assert.equal(notificationTitle({ notification_type: "maintenance_schedule_changed", summary: "2026-11-14T08:30:00Z", title: "Lekkasje" }), "Ny dato for vedlikehold");
  assert.equal(notificationText({ notification_type: "maintenance_schedule_changed", summary: "2026-11-14T08:30:00Z", title: "Lekkasje" }, "tenant"), "Det er satt en dato for vedlikehold i boligen.");
});

test("rescheduled maintenance uses the new title and Oslo time, never the case title", () => {
  const n = {
    notification_type: "maintenance_schedule_changed",
    summary: "rescheduled:2026-11-14T08:30:00Z",
    title: "Lekkasje på badet",
    destination_type: "maintenance_request",
  };
  assert.equal(notificationTitle(n), "Nytt tidspunkt for vedlikehold");
  assert.equal(notificationText(n, "tenant"), "Tidspunktet for vedlikehold i boligen er endret til 14. nov. 2026 kl. 09:30.");
  assert.equal(notificationText(n, "tenant").includes("Lekkasje"), false);
});

test("maintenance_schedule_changed opens the calendar overview, not the event", () => {
  const base = { notification_type: "maintenance_schedule_changed", tenancy_id: "t1" };
  assert.equal(notificationRoute({ ...base, destination_type: "maintenance_request", destination_id: "case", source_id: "item" }, "tenant"), "#kalender/vis/item");
  assert.equal(notificationRoute({ ...base, destination_type: "calendar_item", destination_id: "item" }, "tenant"), "#kalender/vis/item");
  assert.equal(notificationRoute({ ...base, destination_type: "maintenance_request", destination_id: "case" }, "tenant"), "#vedlikehold/case");
  assert.equal(notificationRoute({ ...base, destination_type: "maintenance_request", destination_id: "case", source_id: "item" }, "manager"), "#vedlikehold/case");
  assert.equal(notificationRoute({ ...base, destination_type: "calendar_item", destination_id: "item" }, "manager"), "#kalender/vis/item");
  assert.equal(notificationRoute({ notification_type: "calendar_created", destination_type: "calendar_item", destination_id: "item", tenancy_id: "t1" }, "tenant"), "#kalender/item");
});

test("a chat notification opens that conversation and tenancy, not the inbox", () => {
  const n = {
    notification_type: "chat_message", destination_type: "chat_conversation",
    destination_id: "cccccccc-cccc-4ccc-8ccc-cccccccccc01", tenancy_id: "44444444-4444-4444-8444-44444444aaa1",
    property_id: "22222222-2222-4222-8222-222222222222", source_type: "chat",
  };
  assert.equal(notificationRoute(n, "manager"), "#meldinger/cccccccc-cccc-4ccc-8ccc-cccccccccc01/44444444-4444-4444-8444-44444444aaa1");
  assert.equal(notificationRoute({ source_type: "chat" }, "manager"), "#meldinger");
});
