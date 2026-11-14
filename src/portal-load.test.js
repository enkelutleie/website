import assert from "node:assert/strict";
import test from "node:test";
import { INSPECTION_COLUMNS, INSPECTION_ITEM_COLUMNS, coalesceCalls, maintenanceRescheduleParams } from "./portal-actions.js";

test("coalesceCalls runs one call for a burst and one follow-up if more arrive mid-call", async () => {
  let release = null;
  let n = 0;
  const run = coalesceCalls(() => {
    n += 1;
    return new Promise((resolve) => { release = resolve; });
  }, 30);
  run();
  run();
  run();
  assert.equal(n, 0);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(n, 1);
  run();
  release();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(n, 2);
  run.cancel();
});

test("inspection reads ask only for the columns the handover screens use", () => {
  assert.equal(INSPECTION_COLUMNS.includes("*"), false);
  assert.equal(INSPECTION_ITEM_COLUMNS.includes("*"), false);
  for (const column of ["id", "type", "status", "protocol_mark", "sent_for_review_at", "tenant_may_fill", "finalized_at", "updated_at"]) {
    assert.equal(INSPECTION_COLUMNS.split(", ").includes(column), true, column);
  }
  for (const column of ["id", "area_code", "condition", "note", "sort_order", "updated_at"]) {
    assert.equal(INSPECTION_ITEM_COLUMNS.split(", ").includes(column), true, column);
  }
});

test("Endre tidspunkt updates the same row and shifts ends_at", () => {
  const params = maintenanceRescheduleParams({
    id: "cal-1", title: "Fiks", description: null, item_type: "deadline", category: "other",
    starts_at: "2026-11-14T08:00:00Z", ends_at: "2026-11-14T09:30:00Z", due_at: "2026-11-14T08:00:00Z", all_day: true,
  }, "2026-11-15T10:00");
  assert.equal(params.requested_calendar_item_id, "cal-1");
  assert.equal(params.requested_item_type, "event");
  assert.equal(params.requested_category, "maintenance");
  assert.equal(params.requested_due_at, null);
  assert.equal(params.requested_all_day, false);
  assert.equal(params.requested_title, "Fiks");
  const start = new Date(params.requested_starts_at).getTime();
  const end = new Date(params.requested_ends_at).getTime();
  assert.equal(end - start, 90 * 60 * 1000);
  assert.equal(maintenanceRescheduleParams({ id: "c", title: "Fiks", starts_at: "2026-11-14T08:00:00Z" }, "2026-11-15T10:00").requested_ends_at, null);
});
