import { test } from "node:test";
import assert from "node:assert/strict";
import { routeComposer, routeErrorText, routeRequestBody, routeResult, ROUTE_TEXT } from "./portal-mileage-route.js";

const kmText = (m) => String(Math.round(m / 100) / 10).replace(".", ",");
const tollText = (minor) => (minor / 100).toFixed(2).replace(".", ",");
const settings = { vehicleType: "fossil", usesAutopass: true, includeTolls: true };

// Manual timers and a controllable Edge call.
const harness = (opts = {}) => {
  const timers = [];
  const calls = [];
  const pending = [];
  const c = routeComposer({
    settings, kmText, tollText, ...opts,
    estimate: (body) => { calls.push(body); return new Promise((resolve) => pending.push(resolve)); },
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: (id) => { timers[id - 1] = null; },
  });
  const flush = async () => { const fns = timers.splice(0).filter(Boolean); for (const fn of fns) fn(); await Promise.resolve(); };
  const answer = async (res, i = pending.length - 1) => { pending[i](res); await new Promise((r) => setTimeout(r, 0)); };
  return { c, calls, flush, answer };
};
const ok = { data: { distanceMeters: 15234, durationSeconds: 900, toll_included: true, toll_amount_minor: 3360, toll_estimated: true } };

test("request body: free-text addresses, tolls with settings only when wanted", () => {
  assert.deepEqual(routeRequestBody({ from: " Oslo S ", to: "Sandvika", tolls: true, settings }), {
    from_address: "Oslo S", to_address: "Sandvika", tolls: true, include_tolls: true, vehicle_type: "fossil", uses_autopass: true,
  });
  assert.deepEqual(routeRequestBody({ from: "A", to: "B", tolls: false, settings }), { from_address: "A", to_address: "B" });
  assert.equal(routeRequestBody({ from: "A", to: "B", tolls: true, settings: { vehicleType: "electric", usesAutopass: false } }).vehicle_type, "electric");
});

test("result: meters and an in-range included toll", () => {
  assert.deepEqual(routeResult(ok.data), { meters: 15234, toll: { minor: 3360, estimated: true } });
  assert.deepEqual(routeResult({ distanceMeters: 1000, toll_included: false, toll_amount_minor: 500 }), { meters: 1000, toll: null });
  assert.deepEqual(routeResult({ distanceMeters: 1000, toll_included: true, toll_amount_minor: null }), { meters: 1000, toll: null });
  assert.deepEqual(routeResult({ distanceMeters: 1000, toll_included: true, toll_amount_minor: 1_000_001 }), { meters: 1000, toll: null });
  assert.equal(routeResult({}).meters, null);
});

test("errors: address_not_found is per field, the rest asks for km by hand", () => {
  assert.deepEqual(routeErrorText({ code: "address_not_found", field: "from_address" }), { field: "from_address", text: ROUTE_TEXT.notFound.from_address });
  assert.deepEqual(routeErrorText({ code: "address_not_found", field: "to_address" }), { field: "to_address", text: ROUTE_TEXT.notFound.to_address });
  assert.deepEqual(routeErrorText({ code: "address_not_found", field: null }), { field: null, text: ROUTE_TEXT.notFound.any });
  assert.deepEqual(routeErrorText({ code: "upstream_error" }), { field: null, text: "Kunne ikke beregne avstand — skriv km selv" });
  assert.deepEqual(routeErrorText(undefined), { field: null, text: ROUTE_TEXT.unavailable });
});

test("fires after the delay once both addresses have 3+ characters; fills km and «beregnet» toll", async () => {
  const { c, calls, flush, answer } = harness();
  c.editFrom("Os");
  c.editTo("Sandvika");
  await flush();
  assert.equal(calls.length, 0);
  c.editFrom("Oslo S");
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(c.state.loading, true);
  await answer(ok);
  assert.equal(c.state.loading, false);
  assert.equal(c.state.km, "15,2");
  assert.equal(c.state.toll, "33,60");
  assert.equal(c.state.tollEstimated, true);
  assert.equal(c.kmAutomatic, true);
});

test("a hand-typed toll or km is never overwritten by a late answer", async () => {
  const { c, flush, answer } = harness();
  c.editFrom("Oslo S"); c.editTo("Sandvika");
  await flush();
  c.editToll("40");
  c.editKm("20");
  await answer(ok);
  assert.equal(c.state.toll, "40");
  assert.equal(c.state.tollEstimated, false);
  assert.equal(c.state.km, "20");
});

test("a hand-typed toll is not requested again; editing the estimate makes it «Bompenger»", async () => {
  const { c, calls, flush, answer } = harness();
  c.editFrom("Oslo S"); c.editTo("Sandvika");
  await flush();
  await answer(ok);
  c.editToll("35");
  assert.equal(c.state.tollEstimated, false);
  assert.equal(calls[0].tolls, true);
});

test("a changed address clears automatic km and the route's toll, and ignores the stale answer", async () => {
  const { c, calls, flush, answer } = harness();
  c.editFrom("Oslo S"); c.editTo("Sandvika");
  await flush();
  await answer(ok);
  c.editTo("Asker");
  assert.equal(c.state.km, "");
  assert.equal(c.state.toll, "");
  assert.equal(c.state.tollEstimated, false);
  await flush();
  c.editTo("Asker st");
  await answer({ data: { distanceMeters: 99000 } }, 1); // stale
  assert.equal(c.state.km, "");
  await flush();
  await answer({ data: { distanceMeters: 24000, toll_included: true, toll_amount_minor: 0, toll_estimated: true } }, 2);
  assert.equal(c.state.km, "24");
  assert.equal(c.state.toll, "0,00");
  assert.equal(calls.length, 3);
});

test("tolls off: no tolls flag, toll untouched", async () => {
  const { c, calls, flush, answer } = harness({ settings: { ...settings, includeTolls: false } });
  c.editFrom("Oslo S"); c.editTo("Sandvika");
  await flush();
  assert.equal(calls[0].tolls, undefined);
  await answer(ok);
  assert.equal(c.state.toll, "");
  assert.equal(c.state.km, "15,2");
});

test("failure: field message when km is empty; nothing when km was typed; automatic km cleared", async () => {
  const { c, flush, answer } = harness();
  c.editFrom("Nowhere"); c.editTo("Sandvika");
  await flush();
  await answer({ failure: { code: "address_not_found", field: "from_address" } });
  assert.deepEqual(c.state.error, { field: "from_address", text: ROUTE_TEXT.notFound.from_address });
  c.editKm("12");
  assert.equal(c.state.error, null);
  c.editTo("Sandvika st");
  c.editKm("12");
  await flush();
  await answer({ failure: { code: "upstream_error" } });
  assert.equal(c.state.error, null);
  assert.equal(c.state.km, "12");
});

test("existing trip: stored km and toll shown, no lookup until the route changes", async () => {
  const trip = { from_place: "Hjemme", to_place: "Bomveien 2", distance_meters: 20000, toll_amount_minor: 3360, toll_estimated: true };
  const { c, calls, flush } = harness({ trip });
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(c.state.km, "20");
  assert.equal(c.state.toll, "33,60");
  assert.equal(c.state.tollEstimated, true);
  c.editTo("Bomveien 3");
  assert.equal(c.state.km, "20"); // stored km is not automatic, kept until the answer
  await flush();
  assert.equal(calls.length, 1);
});

test("out-of-range distance asks for km by hand", async () => {
  const { c, flush, answer } = harness();
  c.editFrom("Oslo S"); c.editTo("Sandvika");
  await flush();
  await answer({ data: { distanceMeters: 50 } });
  assert.deepEqual(c.state.error, { field: null, text: ROUTE_TEXT.unavailable });
});

test("trip options: a change re-asks for the toll with the new biltype, keeps km, and never touches a typed toll", async () => {
  const opts = { vehicleType: "fossil", usesAutopass: true, includeTolls: true };
  const { c, calls, flush, answer } = harness({ settings: opts });
  c.editFrom("Oslo S"); c.editTo("Sandvika");
  await flush();
  await answer(ok);
  opts.vehicleType = "electric";
  c.optionsChanged();
  assert.equal(c.state.toll, "");
  assert.equal(c.state.km, "15,2");
  await flush();
  assert.equal(calls.at(-1).vehicle_type, "electric");
  await answer({ data: { distanceMeters: 15234, toll_included: true, toll_amount_minor: 1300, toll_estimated: true } });
  assert.equal(c.state.toll, "13,00");
  opts.includeTolls = false;
  c.optionsChanged();
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(c.state.toll, "");
  opts.includeTolls = true;
  c.optionsChanged();
  c.editToll("50");
  opts.usesAutopass = false;
  c.optionsChanged();
  assert.equal(c.state.toll, "50");
});

test("an answer that arrives after «Ta med bompenger» was turned off fills no toll", async () => {
  const opts = { vehicleType: "fossil", usesAutopass: true, includeTolls: true };
  const { c, flush, answer } = harness({ settings: opts });
  c.editFrom("Oslo S"); c.editTo("Sandvika");
  await flush();
  opts.includeTolls = false; // without optionsChanged: the guard still holds
  await answer(ok);
  assert.equal(c.state.toll, "");
  assert.equal(c.state.km, "15,2");
});
