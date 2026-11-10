import assert from "node:assert/strict";
import test from "node:test";
import {
  coInviteReceivedNotificationId, createCoInviteAcceptGate, isCoInviteReceivedRow, isTransientFailure, RETRY_DELAY_MS,
} from "./portal-co-invite-accept.js";

const INV = "inv-1";
const PID = "prop-1";

const setup = ({ answers, mine = { data: [{ invitation_id: INV }] }, member = { ok: false }, offline = false } = {}) => {
  const calls = { accept: 0, sleeps: [], verify: 0 };
  const queue = [...answers];
  const gate = createCoInviteAcceptGate({
    accept: async () => {
      calls.accept += 1;
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return typeof next === "function" ? next() : next;
    },
    listMine: async () => { calls.verify += 1; return typeof mine === "function" ? mine() : mine; },
    managesProperty: async () => (typeof member === "function" ? member() : member),
    isOffline: () => offline,
    sleep: async (ms) => { calls.sleeps.push(ms); },
  });
  return { gate, calls };
};

const accepted = { result: { outcome: "accepted", property_display_name: "Storgata 1" } };
const timeout = { error: { code: "57014", message: "canceling statement due to statement timeout" }, status: 500 };

test("isTransientFailure: 57014, 5xx and dropped connection are transient; account errors are not", () => {
  assert.equal(isTransientFailure({ code: "57014" }, 500), true);
  assert.equal(isTransientFailure({ code: "40P01" }, 400), true);
  assert.equal(isTransientFailure({ code: "", message: "Bad gateway" }, 502), true);
  assert.equal(isTransientFailure({ name: "TypeError", message: "Failed to fetch" }, 0), true);
  assert.equal(isTransientFailure({ code: "42501", message: "permission denied" }, 403), false);
  assert.equal(isTransientFailure(null, 500), false);
});

test("retries once after ~1.2 s on 57014, then succeeds", async () => {
  const { gate, calls } = setup({ answers: [timeout, accepted] });
  const r = await gate.accept(INV, PID);
  assert.equal(r.result.outcome, "accepted");
  assert.equal(calls.accept, 2);
  assert.deepEqual(calls.sleeps, [RETRY_DELAY_MS]);
  assert.equal(RETRY_DELAY_MS, 1200);
});

test("retries once on HTTP 5xx and on a thrown network error", async () => {
  const a = setup({ answers: [{ error: { code: "", message: "Service Unavailable" }, status: 503 }, accepted] });
  assert.equal((await a.gate.accept(INV, PID)).result.outcome, "accepted");
  assert.equal(a.calls.accept, 2);
  const b = setup({ answers: [new TypeError("Failed to fetch"), accepted] });
  assert.equal((await b.gate.accept(INV, PID)).result.outcome, "accepted");
  assert.equal(b.calls.accept, 2);
});

test("retries only once: two timeouts and no proof give the error", async () => {
  const { gate, calls } = setup({ answers: [timeout, timeout, accepted] });
  const r = await gate.accept(INV, PID);
  assert.ok(r.error);
  assert.equal(calls.accept, 2);
  assert.equal(calls.verify, 2);
});

test("no retry when the browser is offline", async () => {
  const { gate, calls } = setup({ answers: [{ error: { message: "Failed to fetch" }, status: 0 }, accepted], offline: true });
  const r = await gate.accept(INV, PID);
  assert.ok(r.error);
  assert.equal(calls.accept, 1);
  assert.deepEqual(calls.sleeps, []);
});

test("no retry on a non-transient error", async () => {
  const { gate, calls } = setup({ answers: [{ error: { code: "42501", message: "permission denied" }, status: 403 }, accepted] });
  assert.ok((await gate.accept(INV, PID)).error);
  assert.equal(calls.accept, 1);
});

test("verify before error: no longer pending and now a manager counts as accepted", async () => {
  const { gate } = setup({ answers: [timeout, timeout], mine: { data: [] }, member: { ok: true } });
  const r = await gate.accept(INV, PID);
  assert.equal(r.error, undefined);
  assert.equal(r.result.outcome, "accepted");
  assert.equal(r.result.verified, true);
});

test("verify: an 'inactive' outcome that was really ours is accepted", async () => {
  const { gate } = setup({ answers: [{ result: { outcome: "inactive" } }], mine: { data: [] }, member: { ok: true } });
  assert.equal((await gate.accept(INV, PID)).result.outcome, "accepted");
});

test("verify proves nothing when still pending, not a member, or a read fails", async () => {
  for (const [mine, member] of [
    [{ data: [{ invitation_id: INV }] }, { ok: true }],
    [{ data: [] }, { ok: false }],
    [{ error: { code: "57014" } }, { ok: true }],
    [{ data: [] }, { error: { code: "57014" } }],
    [() => { throw new Error("boom"); }, { ok: true }],
  ]) {
    const { gate } = setup({ answers: [timeout, timeout], mine, member });
    assert.ok((await gate.accept(INV, PID)).error);
  }
});

test("expired and email_unconfirmed are shown as-is without verification", async () => {
  const { gate, calls } = setup({ answers: [{ result: { outcome: "expired" } }], mine: { data: [] }, member: { ok: true } });
  assert.equal((await gate.accept(INV, PID)).result.outcome, "expired");
  assert.equal(calls.verify, 0);
});

test("lock: a second tap while the first is running shares the same call", async () => {
  let release;
  const { gate, calls } = setup({ answers: [() => new Promise((r) => { release = () => r(accepted); })] });
  const first = gate.accept(INV, PID);
  const second = gate.accept(INV, PID);
  assert.equal(first, second);
  assert.equal(gate.isPending(INV), true);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(calls.accept, 1);
  assert.equal(gate.isPending(INV), false);
});

test("lock is per invitation and released after an error", async () => {
  const { gate, calls } = setup({ answers: [{ error: { code: "42501" }, status: 403 }, accepted, accepted] });
  assert.ok((await gate.accept(INV, PID)).error);
  assert.equal(gate.isPending(INV), false);
  const [a, b] = await Promise.all([gate.accept(INV, PID), gate.accept("inv-2", "prop-2")]);
  assert.equal(a.result.outcome, "accepted");
  assert.equal(b.result.outcome, "accepted");
  assert.equal(calls.accept, 3);
});

test("iOS #1588: a timeout that already committed is accepted without a second call", async () => {
  const { gate, calls } = setup({ answers: [timeout, accepted], mine: { data: [] }, member: { ok: true } });
  const r = await gate.accept(INV, PID);
  assert.equal(r.result.outcome, "accepted");
  assert.equal(r.result.verified, true);
  assert.equal(calls.accept, 1);
  assert.deepEqual(calls.sleeps, []);
});

test("iOS #1588: 'invalid' and 'already_used' are recovered when the membership exists", async () => {
  for (const outcome of ["invalid", "already_used"]) {
    const { gate } = setup({ answers: [{ result: { outcome } }], mine: { data: [] }, member: { ok: true } });
    assert.equal((await gate.accept(INV, PID)).result.outcome, "accepted");
    const still = setup({ answers: [{ result: { outcome } }], mine: { data: [] }, member: { ok: false } });
    assert.equal((await still.gate.accept(INV, PID)).result.outcome, outcome);
  }
});

test("email_unconfirmed is never read as success", async () => {
  const { gate, calls } = setup({ answers: [{ result: { outcome: "email_unconfirmed" } }], mine: { data: [] }, member: { ok: true } });
  assert.equal((await gate.accept(INV, PID)).result.outcome, "email_unconfirmed");
  assert.equal(calls.verify, 0);
});

test("bell row: matches co_landlord_invitation:received:<id> or the typed row with source_id", () => {
  const id = "AB12CD34-0000-4000-8000-000000000001";
  assert.equal(coInviteReceivedNotificationId(id), "co_landlord_invitation:received:ab12cd34-0000-4000-8000-000000000001");
  assert.equal(isCoInviteReceivedRow({ notification_id: "co_landlord_invitation:received:ab12cd34-0000-4000-8000-000000000001" }, id), true);
  assert.equal(isCoInviteReceivedRow({ notification_id: "n-9", notification_type: "co_landlord_invitation_received", source_id: id.toLowerCase() }, id), true);
  assert.equal(isCoInviteReceivedRow({ notification_id: "n-9", notification_type: "tenancy_invitation_received", source_id: id }, id), false);
  assert.equal(isCoInviteReceivedRow({ notification_id: "co_landlord_invitation:received:other" }, id), false);
  assert.equal(isCoInviteReceivedRow(null, id), false);
});
