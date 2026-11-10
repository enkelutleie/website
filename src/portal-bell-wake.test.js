import assert from "node:assert/strict";
import test from "node:test";
import { createBellWaker, FOREGROUND_FRESH_MS, IDLE_REFRESH_MS, WAKE_WINDOW_MS } from "./portal-bell-wake.js";

const flush = () => new Promise((r) => setImmediate(r));

const setup = ({ hidden = false, slow = false } = {}) => {
  let t = 1_000_000;
  const timers = new Map();
  let next = 1;
  const view = { hidden };
  let release = null;
  const calls = [];
  const waker = createBellWaker({
    fetch: () => {
      calls.push(t);
      if (slow) return new Promise((r) => { release = () => { waker.markSuccess(); r(); }; });
      waker.markSuccess();
      return Promise.resolve();
    },
    isHidden: () => view.hidden,
    now: () => t,
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, at: t + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  const advance = async (ms) => {
    const until = t + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, v]) => v.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      t = due[1].at;
      due[1].fn();
      await flush();
    }
    t = until;
    await flush();
  };
  return { waker, calls, advance, view, release: () => release?.() };
};

test("window is 2.5 s, foreground freshness 15 s, idle fallback 10 min", () => {
  assert.equal(WAKE_WINDOW_MS, 2500);
  assert.equal(FOREGROUND_FRESH_MS, 15_000);
  assert.equal(IDLE_REFRESH_MS, 600_000);
});

test("Realtime: the first signal fetches at once, a burst gives one trailing fetch", async () => {
  const { waker, calls, advance } = setup();
  waker.signal();
  await flush();
  assert.equal(calls.length, 1);
  for (let i = 0; i < 10; i++) { await advance(100); waker.signal(); }
  assert.equal(calls.length, 1);
  await advance(WAKE_WINDOW_MS);
  assert.equal(calls.length, 2);
  await advance(WAKE_WINDOW_MS * 2);
  assert.equal(calls.length, 2);
});

test("a single signal costs one fetch, and a later one is leading again", async () => {
  const { waker, calls, advance } = setup();
  waker.signal();
  await advance(WAKE_WINDOW_MS + 1);
  assert.equal(calls.length, 1);
  waker.signal();
  await flush();
  assert.equal(calls.length, 2);
});

test("foreground is skipped when the last success is under 15 s old", async () => {
  const { waker, calls, advance } = setup();
  waker.immediate();
  await flush();
  await advance(10_000);
  waker.foreground();
  await flush();
  assert.equal(calls.length, 1);
  await advance(6_000);
  waker.foreground();
  await flush();
  assert.equal(calls.length, 2);
});

test("focus + visibilitychange together give one fetch", async () => {
  const { waker, calls, advance } = setup();
  waker.foreground();
  waker.foreground();
  await advance(WAKE_WINDOW_MS * 2);
  assert.equal(calls.length, 1);
});

test("foreground waits for a running fetch instead of queuing another", async () => {
  const { waker, calls, advance, release } = setup({ slow: true });
  waker.signal();
  await flush();
  waker.foreground();
  await advance(WAKE_WINDOW_MS * 2);
  assert.equal(calls.length, 1);
  release();
});

test("opening the bell always fetches at once, also right after another fetch", async () => {
  const { waker, calls } = setup();
  waker.signal();
  await flush();
  waker.immediate();
  waker.immediate();
  await flush();
  assert.equal(calls.length, 3);
});

test("hidden tab: no fetch from signals, foreground or idle tick", async () => {
  const { waker, calls, advance, view } = setup({ hidden: true });
  waker.signal();
  waker.foreground();
  waker.idleTick();
  await advance(IDLE_REFRESH_MS * 2);
  assert.equal(calls.length, 0);
  view.hidden = false;
  waker.signal();
  await flush();
  assert.equal(calls.length, 1);
});

test("idle tick fetches only after 10 quiet minutes", async () => {
  const { waker, calls, advance } = setup();
  waker.immediate();
  await flush();
  for (let i = 0; i < 9; i++) { await advance(60_000); waker.idleTick(); }
  assert.equal(calls.length, 1);
  await advance(60_000);
  waker.idleTick();
  await flush();
  assert.equal(calls.length, 2);
});
