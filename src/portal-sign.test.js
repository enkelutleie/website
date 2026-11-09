import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { signAsLandlord, signStatusRetry } from "./portal-actions.js";
import { supabase } from "./supabase.js";

const NETWORK = "Nettleseren fikk ikke kontakt med signeringstjenesten. Prøv igjen om litt.";
const CONFLICT = "Kontrakten er endret. Last inn på nytt.";
const ATTEMPTS = signStatusRetry.attempts;
const GAP_MS = signStatusRetry.gapMs;
const AGREEMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const originalFetch = globalThis.fetch;
const originalRpc = supabase.rpc.bind(supabase);
// `supabase.functions` is a getter that builds a new client on every read, so the
// test replaces the getter. fetch to Production is blocked for the whole file.
let invokeImpl = async () => { throw new Error("invoke was not mocked"); };

function agreement() {
  return {
    agreement_id: AGREEMENT_ID,
    property_id: "pppppppp-pppp-4ppp-8ppp-pppppppppppp",
    current_version_id: "vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv",
    draft_revision: 3,
    agreement_status: "ready_for_review",
  };
}

// Replaces the client methods. Nothing here may reach Production.
function installSupabase({ invoke, listStatus, parties = [], recorded = 0 }) {
  const calls = { invoke: 0, list: 0, rpc: [] };
  invokeImpl = async (name, options) => {
    calls.invoke += 1;
    calls.functionName = name;
    calls.body = options?.body;
    return invoke();
  };
  supabase.rpc = async (name) => {
    calls.rpc.push(name);
    if (name === "list_my_property_rental_agreements") {
      calls.list += 1;
      const status = typeof listStatus === "function" ? listStatus(calls.list) : listStatus;
      return { data: [{ agreement_id: AGREEMENT_ID, agreement_status: status }], error: null };
    }
    if (name === "get_rental_agreement_lease_by_id") {
      return { data: [{ agreement_status: "ready_for_review", recorded_signature_count: recorded, both_parties_signed_confirmed: false }], error: null };
    }
    if (name === "list_rental_agreement_lease_parties_by_id") return { data: parties, error: null };
    if (name === "get_rental_agreement") return { data: [], error: null };
    return { data: null, error: { message: `unexpected rpc ${name}` } };
  };
  return calls;
}

Object.defineProperty(supabase, "functions", {
  configurable: true,
  get() { return { invoke: (...args) => invokeImpl(...args) }; },
});

describe("contract signing after a lost response", { concurrency: 1 }, () => {
  beforeEach(() => {
    signStatusRetry.gapMs = 0;
    globalThis.fetch = async (input) => {
      const url = String(input?.url ?? input);
      throw new Error(`blocked network during sign test: ${url}`);
    };
  });
  afterEach(() => {
    signStatusRetry.gapMs = GAP_MS;
    signStatusRetry.attempts = ATTEMPTS;
    supabase.rpc = originalRpc;
    globalThis.fetch = originalFetch;
    invokeImpl = async () => { throw new Error("invoke was not mocked"); };
  });

  test("a timeout followed by status signed is success", async () => {
    assert.equal(ATTEMPTS, 19);
    assert.equal(GAP_MS * (ATTEMPTS - 1), 90_000);
    const calls = installSupabase({
      invoke: async () => ({ data: null, error: { name: "FunctionsFetchError", message: "Failed to fetch" } }),
      listStatus: (n) => (n >= 2 ? "signed" : "ready_for_review"),
    });
    const res = await signAsLandlord(agreement(), { jpeg_base64: "ink" });
    assert.equal(res.outcome, "ready");
    assert.equal(res.message, undefined);
    assert.equal(calls.invoke, 1);
    assert.equal(calls.list, 2);
    assert.equal(calls.functionName, "contract-pdf");
    assert.equal(calls.body.intent, "deliver");
  });

  test("a timeout with an unchanged agreement shows the network error", async () => {
    const calls = installSupabase({
      invoke: async () => ({ data: null, error: { name: "FunctionsRelayError", message: "Relay Error invoking the Edge Function" } }),
      listStatus: "ready_for_review",
    });
    const res = await signAsLandlord(agreement(), { jpeg_base64: "ink" });
    assert.equal(res.message, NETWORK);
    assert.equal(res.outcome, undefined);
    assert.equal(calls.invoke, 1);
    assert.equal(calls.list, ATTEMPTS);
    assert.equal(calls.rpc.filter((name) => name === "get_rental_agreement").length, 0);
  });

  test("a registered signature counts as success when the status text is unchanged", async () => {
    const calls = installSupabase({
      invoke: async () => ({ data: null, error: { name: "FunctionsRelayError", message: "timeout" } }),
      listStatus: "ready_for_review",
      parties: [{ party_role: "landlord", has_signature: true }],
    });
    const res = await signAsLandlord(agreement(), { jpeg_base64: "ink" });
    assert.equal(res.outcome, "ready");
    assert.equal(res.message, undefined);
    assert.equal(calls.list, 1);
    assert.equal(calls.invoke, 1);
  });

  test("a double submit sends the signature once", async () => {
    let release;
    const calls = installSupabase({
      invoke: () => new Promise((resolve) => {
        release = () => resolve({ data: { outcome: "ready" }, error: null });
      }),
      listStatus: "ready_for_review",
    });
    const a = agreement();
    const first = signAsLandlord(a, { jpeg_base64: "first" });
    const second = signAsLandlord(a, { jpeg_base64: "second" });
    assert.equal(calls.invoke, 1);
    assert.equal(calls.body.landlord_ink.jpeg_base64, "first");
    release();
    const [one, two] = await Promise.all([first, second]);
    assert.equal(one.outcome, "ready");
    assert.equal(two.outcome, "ready");
    assert.equal(one.message, undefined);
    assert.equal(calls.invoke, 1);
    assert.equal(calls.list, 0);
  });

  test("a definitive rejection is not turned into success", async () => {
    const calls = installSupabase({
      invoke: async () => ({
        data: null,
        error: { name: "FunctionsHttpError", context: { json: async () => ({ outcome: "version_conflict" }) } },
      }),
      listStatus: "signed",
    });
    const res = await signAsLandlord(agreement(), { jpeg_base64: "ink" });
    assert.equal(res.message, CONFLICT);
    assert.equal(calls.invoke, 1);
    assert.equal(calls.list, 0);
  });
});
