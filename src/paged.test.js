import assert from "node:assert/strict";
import test from "node:test";
import { collectPages } from "./paged.js";

test("collectPages stops when a full page repeats instead of looping", async () => {
  const page = Array.from({ length: 200 }, (_, i) => ({ id: `row-${i}` }));
  let calls = 0;
  const res = await collectPages(() => {
    calls += 1;
    return { data: page };
  });
  assert.equal(calls, 2);
  assert.equal(res.data.length, 200);
});

test("collectPages keeps reading while each page is new and full", async () => {
  const res = await collectPages((offset) => {
    if (offset >= 400) return { data: [] };
    return { data: Array.from({ length: 200 }, (_, i) => ({ id: offset + i })) };
  });
  assert.equal(res.data.length, 400);
});

test("collectPages returns a short page and a request error", async () => {
  const short = await collectPages(() => ({ data: [{ id: "only" }] }));
  assert.deepEqual(short.data, [{ id: "only" }]);
  const failed = await collectPages(() => ({ error: { message: "nope" } }));
  assert.equal(failed.error.message, "nope");
});
