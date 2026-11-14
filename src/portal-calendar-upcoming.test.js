import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { upcomingSectionItems } from "./portal-calendar-upcoming.js";

const item = (id) => ({ id, title: id });

test("Kommende drops the event the selected day already shows and keeps the rest in order", () => {
  const onDay = item("vask");
  const other = item("visning");
  const later = item("kontroll");
  const upcoming = [onDay, other, later];

  assert.deepEqual(upcomingSectionItems(upcoming, [onDay]).map((i) => i.id), ["visning", "kontroll"]);
  assert.deepEqual(upcomingSectionItems(upcoming, [other]).map((i) => i.id), ["vask", "kontroll"]);
  assert.deepEqual(upcoming.map((i) => i.id), ["vask", "visning", "kontroll"]);
});

test("no selected-day rows leaves Kommende unchanged", () => {
  const upcoming = [item("a"), item("b")];
  assert.equal(upcomingSectionItems(upcoming, []), upcoming);
  assert.equal(upcomingSectionItems(upcoming, null), upcoming);
  assert.equal(upcomingSectionItems(upcoming, undefined), upcoming);
  assert.deepEqual(upcomingSectionItems(upcoming, [{ title: "uten id" }]).map((i) => i.id), ["a", "b"]);
});

test("an event the day card does not draw stays in Kommende", () => {
  const pending = item("venter");
  const accepted = item("godtatt");
  const other = item("visning");
  assert.deepEqual(
    upcomingSectionItems([pending, accepted, other], [pending]).map((i) => i.id),
    ["godtatt", "visning"],
  );
});

test("every remaining row on the selected day leaves an empty section", () => {
  const onDay = item("vask");
  assert.deepEqual(upcomingSectionItems([onDay], [onDay]), []);
  assert.deepEqual(upcomingSectionItems([onDay, item("samme")], [onDay, item("samme")]), []);
});

test("portal omits selected-day rows from Kommende and leaves Forfalt alone", () => {
  const src = readFileSync(new URL("./portal.js", import.meta.url), "utf8");
  const start = src.indexOf("const drawList = () => {");
  const end = src.indexOf("draw();\n  drawList();", start);
  assert.ok(start >= 0 && end > start);
  const list = src.slice(start, end);
  assert.match(list, /upcomingSectionItems\(upcomingAll, shownOnDay\)/);
  assert.match(list, /calendarIsOverdue\(i, now\)/);
  assert.equal(list.includes("upcomingSectionItems(overdue"), false);
  assert.match(list, /upcomingAll\.length && !upcoming\.length/);
  assert.match(src, /drawDay\(\);\s*drawList\(\)/);
});
