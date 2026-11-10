import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  STUCK_FINALIZE_RETRY_MS, allRequiredSigned, createStuckFinalizer, isStuckFullySigned,
} from "./portal-sign-refresh.js";
import { finalizeStuckAgreement } from "./portal-actions.js";
import { supabase } from "./supabase.js";

// Fixtures only. Nothing in this file may reach Production.
const AGREEMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION_ID = "vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv";
const agreement = (over = {}) => ({ agreement_id: AGREEMENT_ID, current_version_id: VERSION_ID, agreement_status: "partially_signed", ...over });
const lease = (signed = [true, true], row = {}) => ({
  data: { agreement_status: "partially_signed", ...row },
  parties: signed.map((s, i) => ({ party_role: i ? "tenant" : "landlord", required_to_sign: true, has_signature: s })),
});

const originalFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = async () => { throw new Error("network is blocked in tests"); }; });
afterEach(() => { globalThis.fetch = originalFetch; });

function finalizer(answer = () => ({ data: { outcome: "signed", document_id: "d" }, error: null })) {
  let clock = 1_000_000;
  const calls = [];
  const f = createStuckFinalizer({
    invoke: async (name, options) => { calls.push({ name, body: options?.body }); return answer(calls.length); },
    now: () => clock,
  });
  return { f, calls, advance: (ms) => { clock += ms; } };
}

describe("stuck fully signed contract (iOS #1583)", { concurrency: 1 }, () => {
  test("triggers refresh_signature_pdf when partially_signed and everyone signed", async () => {
    const { f, calls } = finalizer();
    assert.equal(isStuckFullySigned(agreement(), lease()), true);
    const res = await f.finalize(agreement(), lease());
    assert.deepEqual(res, { attempted: true, ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "contract-pdf");
    assert.deepEqual(calls[0].body, { agreement_id: AGREEMENT_ID, version_id: VERSION_ID, intent: "refresh_signature_pdf" });
  });

  test("counts on the lease row also mean everyone signed", () => {
    assert.equal(allRequiredSigned({ data: { recorded_signature_count: 2, required_signature_count: 2 }, parties: [] }), true);
    assert.equal(allRequiredSigned({ data: { recorded_signature_count: 1, required_signature_count: 2 }, parties: [] }), false);
  });

  test("does not trigger when a required party lacks a signature", async () => {
    const { f, calls } = finalizer();
    const res = await f.finalize(agreement(), lease([true, false]));
    assert.equal(res.attempted, false);
    assert.equal(calls.length, 0);
    // A party that is not required to sign does not block it.
    const optional = lease([true, true]);
    optional.parties.push({ party_role: "guarantor", required_to_sign: false, has_signature: false });
    assert.equal(isStuckFullySigned(agreement(), optional), true);
    assert.equal(isStuckFullySigned(agreement(), { data: {}, parties: [] }), false);
  });

  test("does not trigger for signed or other statuses", async () => {
    const { f, calls } = finalizer();
    for (const st of ["signed", "awaiting_signatures", "ready_for_review", "draft", "cancelled"]) {
      const res = await f.finalize(agreement({ agreement_status: st }), lease([true, true], { agreement_status: st }));
      assert.equal(res.attempted, false, st);
    }
    assert.equal(calls.length, 0);
  });

  test("at most once per 30 seconds per version", async () => {
    const { f, calls, advance } = finalizer(() => ({ data: { outcome: "temporary_failure" }, error: null }));
    await f.finalize(agreement(), lease());
    advance(5_000);
    assert.equal((await f.finalize(agreement(), lease())).attempted, false);
    advance(STUCK_FINALIZE_RETRY_MS - 5_001);
    assert.equal((await f.finalize(agreement(), lease())).attempted, false);
    assert.equal(calls.length, 1);
    // Another version is throttled on its own.
    await f.finalize(agreement({ current_version_id: "wwwwwwww-wwww-4www-8www-wwwwwwwwwwww" }), lease());
    assert.equal(calls.length, 2);
    advance(1);
    assert.equal((await f.finalize(agreement(), lease())).attempted, true);
    assert.equal(calls.length, 3);
  });

  test("overlapping renders share one request", async () => {
    const { f, calls } = finalizer();
    const [a, b] = await Promise.all([f.finalize(agreement(), lease()), f.finalize(agreement(), lease())]);
    assert.equal(calls.length, 1);
    assert.equal(a.ok && b.ok, true);
  });

  test("failure is silent: errors, throws and failure outcomes resolve without a message", async () => {
    const answers = [
      () => ({ data: null, error: { name: "FunctionsHttpError", message: "503" } }),
      () => { throw new Error("offline"); },
      () => ({ data: { outcome: "document_unavailable" }, error: null }),
      () => ({ data: "not json", error: null }),
    ];
    for (const answer of answers) {
      const { f } = finalizer(answer);
      const res = await f.finalize(agreement(), lease());
      assert.deepEqual(res, { attempted: true, ok: false });
      assert.equal("message" in res, false);
    }
  });
});

describe("portal wiring", { concurrency: 1 }, () => {
  const descriptor = Object.getOwnPropertyDescriptor(supabase, "functions")
    ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(supabase), "functions");
  let invokeImpl;
  beforeEach(() => {
    Object.defineProperty(supabase, "functions", { configurable: true, get() { return { invoke: (...a) => invokeImpl(...a) }; } });
  });
  afterEach(() => {
    if (descriptor) Object.defineProperty(supabase, "functions", { ...descriptor, configurable: true });
  });

  test("success invalidates the read cache so the agreement reloads as signed", async () => {
    const calls = [];
    invokeImpl = async (name, options) => { calls.push({ name, body: options.body }); return { data: { outcome: "signed" }, error: null }; };
    const a = agreement({ current_version_id: "11111111-1111-4111-8111-111111111111" });
    const res = await finalizeStuckAgreement(a, lease());
    assert.equal(res.ok, true);
    assert.equal(calls[0].body.intent, "refresh_signature_pdf");
    // Within 30 s the same version is not asked again, so a reload cannot loop.
    assert.equal((await finalizeStuckAgreement(a, lease())).attempted, false);
    assert.equal(calls.length, 1);
  });

  test("failure through the real client stays silent", async () => {
    invokeImpl = async () => ({ data: null, error: { name: "FunctionsFetchError" } });
    const res = await finalizeStuckAgreement(agreement({ current_version_id: "22222222-2222-4222-8222-222222222222" }), lease());
    assert.deepEqual(res, { attempted: true, ok: false });
  });
});
