import assert from "node:assert/strict";
import test from "node:test";
import { INSPECTION_COLUMNS, INSPECTION_ITEM_COLUMNS, coalesceCalls } from "./portal-actions.js";

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
