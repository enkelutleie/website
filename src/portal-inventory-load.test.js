import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PRIVATE_SCOPE } from "./portal-inventory.js";
import {
  ASSET_LOAD_ERROR, LIST_RETRY_DELAYS_MS, isCancellation, loadManagedInventory, readPropertyAssets,
} from "./portal-inventory-load.js";

// «Kunne ikke laste eiendeler» while the item was visible (iOS #1677).
// Cancellation and a single property's failure must not become a page error.

const property = (id, label, over = {}) => ({ id, address_line1: label, ...over });
const asset = (propertyId, name, date = "2026-11-14") => ({
  id: `${propertyId}:${name}`, property_id: propertyId, name, item_kind: "loose_inventory",
  category: "furnishings", purchase_date: date, purchase_amount_minor: 475_000,
  life_under_three_years: false, counts_for_taxable_rental: true, notes: null,
});
const bundle = (p, rows, scope = PRIVATE_SCOPE) => ({ id: p.id, label: p.address_line1, scope, rawRows: rows });
const abortError = () => new DOMException("The operation was aborted.", "AbortError");
const timeout = { message: "timeout", code: "57014" };

function harness(properties, scripts, extra = {}) {
  const calls = [];
  const sleeps = [];
  const listAssets = async (id) => {
    calls.push(id);
    const steps = scripts[id];
    const step = steps?.length ? steps.shift() : { data: [] };
    if (typeof step === "function") return step();
    if (step.throw) throw step.throw;
    if (step.error) return { error: step.error };
    return { data: step.data ?? [] };
  };
  const load = (over = {}) => loadManagedInventory({
    properties,
    labelOf: (p) => p.address_line1,
    listAssets,
    accountingMode: extra.accountingMode ?? (async () => ({ data: [{ accounting_mode: "private_rental" }] })),
    listElections: extra.listElections ?? (async () => ({ data: [] })),
    previous: extra.previous ?? { bundles: [], elections: {} },
    showsFailure: extra.showsFailure ?? true,
    isCancelled: extra.isCancelled ?? (() => false),
    sleep: async (ms) => { sleeps.push(ms); },
    retryDelays: extra.retryDelays ?? [],
    ...over,
  });
  return { load, calls, sleeps };
}

test("AbortError, navigation, re-render and refresh are not failures", () => {
  assert.equal(isCancellation(abortError()), true);
  assert.equal(isCancellation({ name: "AbortError", message: "The user aborted a request." }), true);
  assert.equal(isCancellation({ message: "AbortError: The operation was aborted." }), true);
  assert.equal(isCancellation({ message: "signal is aborted without reason" }), true);
  assert.equal(isCancellation({ name: "DOMException", code: 20, message: "The operation was aborted." }), true);
  assert.equal(isCancellation({ cause: abortError() }), true);
  for (const reason of ["navigation", "render", "refresh"]) {
    assert.equal(isCancellation(reason), true, reason);
    assert.equal(isCancellation({ reason }), true, reason);
    assert.equal(isCancellation({ superseded: reason }), true, reason);
  }
  assert.equal(isCancellation("abort"), true);
  assert.equal(isCancellation({ message: "timeout", code: "57014" }), false);
  assert.equal(isCancellation({ message: "Failed to fetch" }), false);
  assert.equal(isCancellation({ code: 20, message: "nope" }), false);
  assert.equal(isCancellation(null), false);
});

test("a cancelled reload keeps the items and shows no error", async () => {
  const home = property("p1", "Gate 1");
  const sofa = asset("p1", "Sofa");
  const shown = { bundles: [bundle(home, [sofa])], elections: { private: { 2026: { rate_bps: 2000 } } } };
  for (const cancel of [abortError(), { message: "AbortError: The user aborted a request." }, "navigation", "render", "refresh"]) {
    const run = harness([home], { p1: [{ throw: cancel }] }, { previous: shown });
    const view = await run.load();
    assert.deepEqual(view.items.map((item) => item.name), ["Sofa"]);
    assert.equal(view.error, false);
    assert.equal(view.settled, false);
    assert.equal(view.elections.private[2026].rate_bps, 2000);
    assert.equal(run.calls.length, 1);
  }
});

test("one failing property does not hide the others or mark the page failed", async () => {
  const first = property("p1", "Gate 1");
  const second = property("p2", "Gate 2");
  const run = harness([first, second], {
    p1: [{ data: [asset("p1", "Sofa", "2026-03-01")] }],
    p2: [{ error: timeout }, { error: timeout }, { error: timeout }],
  }, { retryDelays: LIST_RETRY_DELAYS_MS });
  const view = await run.load();
  assert.deepEqual(view.items.map((item) => item.name), ["Sofa"]);
  assert.equal(view.error, false);
  assert.deepEqual(view.failedPropertyIds, ["p2"]);
  assert.equal(view.settled, true);
  assert.deepEqual(run.calls.filter((id) => id === "p1"), ["p1"]);
  assert.equal(run.calls.filter((id) => id === "p2").length, 3);
  assert.deepEqual(run.sleeps, [400, 1200]);
});

test("a transient failure is retried quietly and then shown", async () => {
  const home = property("p1", "Gate 1");
  const run = harness([home], { p1: [{ error: timeout }, { data: [asset("p1", "Sofa")] }] }, { retryDelays: LIST_RETRY_DELAYS_MS });
  const view = await run.load();
  assert.deepEqual(view.items.map((item) => item.name), ["Sofa"]);
  assert.equal(view.error, false);
  assert.deepEqual(view.failedPropertyIds, []);
  assert.equal(run.calls.length, 2);
  assert.deepEqual(run.sleeps, [400]);
});

test("a failed reload keeps the visible items and does not show an error", async () => {
  const home = property("p1", "Gate 1");
  const sofa = asset("p1", "Sofa");
  const run = harness([home], { p1: [{ error: timeout }] }, {
    previous: { bundles: [bundle(home, [sofa])], elections: {} },
  });
  const view = await run.load();
  assert.deepEqual(view.items.map((item) => item.name), ["Sofa"]);
  assert.equal(view.error, false);
  assert.equal(view.settled, true);
  assert.deepEqual(view.failedPropertyIds, ["p1"]);
});

test("a real failure with nothing to show explains itself, and the form context stays quiet", async () => {
  const home = property("p1", "Gate 1");
  const failed = harness([home], { p1: [{ error: timeout }] });
  const view = await failed.load();
  assert.equal(view.error, true);
  assert.deepEqual(view.items, []);
  assert.equal(ASSET_LOAD_ERROR, "Kunne ikke laste eiendeler.");

  const quiet = harness([home], { p1: [{ error: timeout }] }, { showsFailure: false });
  const form = await quiet.load();
  assert.equal(form.error, false);
  assert.deepEqual(form.items, []);
});

test("navigation, re-render and refresh supersede the load without applying it or showing an error", async () => {
  const home = property("p1", "Gate 1");
  const chair = asset("p1", "Stol", "2024-01-01");
  let cancelled = false;
  const run = harness([home], {
    p1: [() => { cancelled = true; return { data: [asset("p1", "Sofa")] }; }],
  }, {
    previous: { bundles: [bundle(home, [chair])], elections: {} },
    isCancelled: () => cancelled,
  });
  const view = await run.load();
  assert.deepEqual(view.items.map((item) => item.name), ["Stol"]);
  assert.equal(view.error, false);
  assert.equal(view.settled, false);
});

test("an aborted read is not retried", async () => {
  const sleeps = [];
  let calls = 0;
  const result = await readPropertyAssets(async () => {
    calls += 1;
    throw abortError();
  }, { retryDelays: LIST_RETRY_DELAYS_MS, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(result.cancelled, true);
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test("a cancelled property keeps its rows while the other property's new rows show", async () => {
  const first = property("p1", "Gate 1");
  const second = property("p2", "Gate 2");
  const lamp = asset("p2", "Lampe", "2025-02-01");
  const run = harness([first, second], {
    p1: [{ data: [asset("p1", "Sofa", "2026-04-01")] }],
    p2: [{ throw: abortError() }],
  }, { previous: { bundles: [bundle(second, [lamp])], elections: {} } });
  const view = await run.load();
  assert.deepEqual(view.items.map((item) => item.name), ["Sofa", "Lampe"]);
  assert.equal(view.error, false);
  assert.equal(view.settled, true);
  assert.deepEqual(view.failedPropertyIds, []);
});

test("a mode or election failure does not hide assets that loaded", async () => {
  const home = property("p1", "Gate 1", { municipality_number: "0301", municipality_name: "Oslo" });
  const previous = { bundles: [], elections: { private: { 2026: { rate_bps: 1000, scope_key: "private", tax_year: 2026 } } } };
  const run = harness([home], { p1: [{ data: [asset("p1", "Sofa")] }] }, {
    previous,
    accountingMode: async () => { throw abortError(); },
    listElections: async () => ({ error: timeout }),
  });
  const view = await run.load();
  assert.deepEqual(view.items.map((item) => item.name), ["Sofa"]);
  assert.equal(view.error, false);
  assert.equal(view.elections.private[2026].rate_bps, 1000);
  assert.equal(view.scopes.p1.key, "private");
});

test("a successful empty read replaces old rows and is not an error", async () => {
  const home = property("p1", "Gate 1");
  const run = harness([home], { p1: [{ data: [] }] }, {
    previous: { bundles: [bundle(home, [asset("p1", "Sofa")])], elections: {} },
  });
  const view = await run.load();
  assert.deepEqual(view.items, []);
  assert.equal(view.error, false);
  assert.equal(view.settled, true);
});

test("the furnishings page uses the per-property load and the form never shows the load error", () => {
  const portal = readFileSync(new URL("./portal.js", import.meta.url), "utf8");
  assert.equal(portal.includes("loadManagedInventory"), true);
  assert.equal(portal.includes("ASSET_LOAD_ERROR"), true);
  assert.equal(portal.includes("perProperty.some"), false);
  assert.equal(portal.includes("r.assets.error"), false);
  const form = portal.slice(portal.indexOf("const assetForm"), portal.indexOf("const metric"));
  assert.equal(form.includes("Kunne ikke laste eiendeler"), false);
  assert.equal(form.includes("ASSET_LOAD_ERROR"), false);
  const page = portal.slice(portal.indexOf("const assetsPage"), portal.indexOf("const CO_DELIVERY"));
  assert.equal(page.includes("ASSET_LOAD_ERROR"), true);
  assert.equal(page.includes("data.settled === false"), true);
});
