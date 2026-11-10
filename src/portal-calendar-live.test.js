import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarCacheKeys,
  calendarSignalProperty,
  createCalendarLive,
  domainChangeHandler,
} from "./portal-calendar-live.js";

// Fake timers: the test decides when the debounce fires.
const fakeTimers = () => {
  let next = 1;
  const pending = new Map();
  return {
    setTimer: (fn) => { const id = next++; pending.set(id, fn); return id; },
    clearTimer: (id) => { pending.delete(id); },
    count: () => pending.size,
    async fire() {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) await fn();
    },
  };
};

const setup = ({ screen = "p1", selected = "p1", hidden = false } = {}) => {
  const timers = fakeTimers();
  const cache = new Map([["cal:p1", 1], ["calresp:p1", 1], ["cal:p2", 1], ["calresp:p2", 1], ["tx:p1", 1], ["mt:p1", 1]]);
  const redraws = [];
  const view = { screen, selected, hidden };
  const live = createCalendarLive({
    invalidate: (key) => cache.delete(key),
    selected: () => view.selected,
    onScreen: () => view.screen,
    redraw: async (pid) => { redraws.push(pid); },
    isHidden: () => view.hidden,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { live, cache, redraws, timers, view };
};

test("a calendar change drops only that property's calendar reads", () => {
  const { live, cache } = setup();
  live.signal({ eventType: "UPDATE", new: { id: "i1", property_id: "p2" }, old: {} });
  assert.deepEqual([...cache.keys()].sort(), ["cal:p1", "calresp:p1", "mt:p1", "tx:p1"]);
  assert.deepEqual(calendarCacheKeys("p2"), ["cal:p2", "calresp:p2"]);
});

test("a payload without property_id (maintenance_events, resubscribe) drops the selected property", () => {
  const { live, cache } = setup({ selected: "p1" });
  assert.equal(calendarSignalProperty({ new: { id: "e1", maintenance_request_id: "r1" } }), null);
  live.signal({ eventType: "INSERT", new: { id: "e1", maintenance_request_id: "r1" } });
  live.signal(null);
  assert.equal(cache.has("cal:p1"), false);
  assert.equal(cache.has("calresp:p1"), false);
  assert.equal(cache.has("cal:p2"), true);
  assert.equal(cache.has("tx:p1"), true);
});

test("a burst of signals makes one quiet redraw of the calendar on screen", async () => {
  const { live, redraws, timers } = setup({ screen: "p1" });
  for (let i = 0; i < 5; i++) live.signal({ new: { id: `i${i}`, property_id: "p1" } });
  assert.equal(timers.count(), 1);
  assert.deepEqual(redraws, []);
  await timers.fire();
  assert.deepEqual(redraws, ["p1"]);
  await timers.fire();
  assert.deepEqual(redraws, ["p1"]);
});

test("no refetch when another property's or no calendar is on screen", async () => {
  const { live, redraws, timers, cache, view } = setup({ screen: "p1" });
  live.signal({ new: { id: "i1", property_id: "p2" } });
  await timers.fire();
  assert.deepEqual(redraws, []);
  assert.equal(cache.has("cal:p2"), false); // still dropped, so the next visit reads fresh
  view.screen = null;
  live.signal({ new: { id: "i2", property_id: "p1" } });
  await timers.fire();
  assert.deepEqual(redraws, []);
});

test("a hidden tab waits and redraws once when it is visible again", async () => {
  const { live, redraws, timers, view } = setup({ hidden: true });
  live.signal({ new: { id: "i1", property_id: "p1" } });
  live.signal({ new: { id: "i2", property_id: "p1" } });
  await timers.fire();
  assert.deepEqual(redraws, []);
  view.hidden = false;
  live.resume();
  await timers.fire();
  assert.deepEqual(redraws, ["p1"]);
  live.resume();
  assert.equal(timers.count(), 0);
});

test("the bell is still woken for every table, the calendar only for calendar tables", () => {
  let bell = 0;
  const calendar = [];
  const deps = { wakeBell: () => { bell += 1; }, calendar: (p) => calendar.push(p) };
  const payload = { new: { id: "i1", property_id: "p1" } };
  for (const table of ["property_calendar_items", "maintenance_events", "tenancy_members", "notification_inbox_wakes"]) {
    domainChangeHandler(table, deps)(payload);
  }
  assert.equal(bell, 4);
  assert.equal(calendar.length, 2);
  domainChangeHandler("property_calendar_items", { wakeBell: () => { bell += 1; }, calendar: null })(payload);
  assert.equal(bell, 5);
});
