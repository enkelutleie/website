import assert from "node:assert/strict";
import test from "node:test";
import {
  createConcurrencyGate,
  createLatestCoalescer,
  createOccupantCache,
  createReadCache,
  mapWithLimit,
  shouldClearInspectionReviewDone,
} from "./portal-cache.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a read is shared until it is invalidated, and a failed read is tried again", async () => {
  const cache = createReadCache();
  let loads = 0;
  const load = () => {
    loads += 1;
    return Promise.resolve(loads === 1 ? { error: { message: "nett" } } : { data: ["ok"] });
  };
  const first = cache.read("tenancies:p1", load);
  const second = cache.read("tenancies:p1", load);
  assert.equal(await first, await second);
  assert.equal(loads, 1);
  assert.equal((await cache.read("tenancies:p1", load)).data[0], "ok");
  assert.equal(loads, 2);
  assert.equal((await cache.read("tenancies:p1", load)).data[0], "ok");
  assert.equal(loads, 2);
  cache.invalidate("tenancies:");
  await cache.read("tenancies:p1", load);
  assert.equal(loads, 3);
  cache.invalidate(null);
  await cache.read("tenancies:p1", load);
  assert.equal(loads, 4);
});

test("manual occupants are remembered per tenancy and only missing ones are fetched again", () => {
  const occupants = createOccupantCache();
  occupants.rememberAll([
    { tenancy_id: "t1", display_name: "Ada" },
    { tenancy_id: "t1", display_name: "Bo" },
    { tenancy_id: "t2", display_name: "Cia" },
  ]);
  assert.deepEqual(occupants.missing(["t1", "t2", "t3"]), []);
  assert.equal(occupants.rows("t1").length, 2);
  assert.deepEqual(occupants.rows("t9"), []);
  occupants.invalidate("t1");
  assert.deepEqual(occupants.missing(["t1", "t2"]), ["t1"]);
  occupants.rememberTenancy("t1", [{ tenancy_id: "t1", display_name: "Ada" }]);
  assert.deepEqual(occupants.missing(["t1", "t2"]), []);
  assert.equal(occupants.rows("t1").length, 1);
  occupants.invalidate();
  assert.deepEqual(occupants.missing(["t2"]), ["t2"]);
});

test("clear_inspection_review_done is only requested when review_done is set", () => {
  assert.equal(shouldClearInspectionReviewDone({ id: "i", review_done: true }), true);
  assert.equal(shouldClearInspectionReviewDone({ id: "i", review_done: false }), false);
  assert.equal(shouldClearInspectionReviewDone({ id: "i" }), false);
  assert.equal(shouldClearInspectionReviewDone(null), false);
});

test("uploads to one collection stay at two in flight", async () => {
  const gate = createConcurrencyGate(2);
  let active = 0;
  let max = 0;
  const one = () => gate(async () => {
    active += 1;
    max = Math.max(max, active);
    await wait(30);
    active -= 1;
    return true;
  });
  await Promise.all([one(), one(), one(), one(), one()]);
  assert.equal(max, 2);
});

test("mapWithLimit keeps the failure and does not start the items behind it", async () => {
  let started = 0;
  const results = await mapWithLimit([1, 2, 3, 4, 5], 2, async (n) => {
    if (n === 2) return "feil";
    started += 1;
    await wait(30);
    return null;
  });
  assert.equal(results[1], "feil");
  assert.equal(started, 1);
  assert.deepEqual(results.slice(2), [undefined, undefined, undefined]);
});

test("a burst of inspection saves sends the first and then only the latest", async () => {
  const sent = [];
  let release = null;
  const save = createLatestCoalescer(async (_key, payload) => {
    sent.push(payload);
    if (sent.length === 1) await new Promise((resolve) => { release = resolve; });
    return { data: { note: payload } };
  });
  const first = save("item", "a");
  const second = save("item", "b");
  const third = save("item", "c");
  await wait(20);
  assert.deepEqual(sent, ["a"]);
  release();
  const results = await Promise.all([first, second, third]);
  assert.deepEqual(sent, ["a", "c"]);
  assert.equal(results[2].data.note, "c");
  assert.equal(results[1].data.note, "c");
});
