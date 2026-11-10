import assert from "node:assert/strict";
import { test } from "node:test";
import {
  displayNames, isLastActiveTenant, isNationalIdentityNumber, postponeKey, readyBody, readyLines, READY_BODY,
  showsReadyToEnd, subjectLine,
} from "./portal-ready-to-end.js";

test("ready gate mirrors MoveOutFinishEligibility", () => {
  const base = { scope: "one_room", state: "deposit", tenancyStatus: "active", last: false };
  assert.equal(showsReadyToEnd({ ...base, settlement: "absent" }), true);
  assert.equal(showsReadyToEnd({ ...base, settlement: "accepted" }), true);
  assert.equal(showsReadyToEnd({ ...base, settlement: "full_refund" }), true);
  assert.equal(showsReadyToEnd({ ...base, settlement: "claims_pending" }), false);
  assert.equal(showsReadyToEnd({ ...base, settlement: "unknown" }), false);
  assert.equal(showsReadyToEnd({ ...base, state: "checklist", settlement: "absent" }), false);
  assert.equal(showsReadyToEnd({ ...base, tenancyStatus: "ended", settlement: "absent" }), false);
  // A personal move-out with others left does not wait for the deposit.
  assert.equal(showsReadyToEnd({ ...base, scope: "one_tenant", settlement: "unknown" }), true);
  assert.equal(showsReadyToEnd({ ...base, scope: "one_tenant", last: true, settlement: "unknown" }), false);
});

test("last active tenant", () => {
  const p = { scope: "one_tenant", subject_member_id: "a" };
  assert.equal(isLastActiveTenant(p, ["a"]), true);
  assert.equal(isLastActiveTenant(p, ["a", "b"]), false);
  assert.equal(isLastActiveTenant(p, undefined), false);
  assert.equal(isLastActiveTenant({ scope: "one_tenant" }, ["a"]), true);
  assert.equal(isLastActiveTenant({ scope: "whole_tenancy" }, ["a"]), false);
});

test("room copy in bofellesskap, home copy otherwise", () => {
  assert.equal(readyBody("accepted", true), READY_BODY.approvedRoom);
  assert.equal(readyBody("full_refund", false), READY_BODY.approved);
  assert.equal(readyBody("absent", true), READY_BODY.skippedRoom);
  assert.equal(readyBody("unknown", false), READY_BODY.skipped);
  assert.match(READY_BODY.approvedRoom, /dette leieforholdet .* rommet blir ledig for en ny leietaker/);
});

test("names drop blanks, duplicates, the sentinel and national ids", () => {
  assert.deepEqual(displayNames([" Kari Nordmann ", "", "Kari Nordmann", "Registrert leietaker", "12345678901", "123456 78901", "010190-12345", "Ola Nordmann", "Ola 2"]), ["Kari Nordmann", "Ola Nordmann", "Ola 2"]);
  assert.equal(isNationalIdentityNumber("1234567890"), false);
  assert.equal(isNationalIdentityNumber("Kari 12345678901"), false);
});

test("subject line table from the parity doc", () => {
  const s = (o) => subjectLine({ sharedHousing: false, housingKind: "standard", severalActive: false, roomLabel: null, names: [], ...o });
  const shared = { sharedHousing: true, housingKind: "shared" };
  assert.equal(s({ ...shared, roomLabel: "Rom 1", names: ["Jolkulf Wolfgang"] }), "Rom 1 – Jolkulf Wolfgang");
  assert.equal(s({ ...shared, roomLabel: "Rom 1", names: ["Kari Nordmann", "Ola Nordmann"] }), "Rom 1 – Kari Nordmann, Ola Nordmann");
  assert.equal(s({ ...shared, roomLabel: "Rom 1", names: ["12345678901"] }), "Rom 1");
  assert.equal(s({ ...shared, names: ["Kari Nordmann"] }), "Rom – Kari Nordmann");
  assert.equal(s({ ...shared }), "Rom");
  assert.equal(s({ sharedHousing: true, housingKind: null, roomLabel: "Rom 2" }), "Rom 2");
  assert.equal(s({ names: ["Kari Nordmann"], roomLabel: "Rom 1" }), "Kari Nordmann");
  assert.equal(s({}), null);
  assert.equal(s({ severalActive: true, roomLabel: "Rom 1", names: ["Kari Nordmann"] }), "Rom 1 – Kari Nordmann");
  assert.equal(s({ severalActive: true, roomLabel: "Rom 1" }), "Rom 1");
  assert.equal(s({ severalActive: true, names: ["Kari Nordmann", "Ola Nordmann"] }), "Kari Nordmann, Ola Nordmann");
});

test("one line per ready tenancy, each with its own process", () => {
  const tenancies = [
    { id: "t1", status: "active", room: "Rom 1" },
    { id: "t2", status: "active", room: "Rom 2" },
    { id: "t3", status: "active", room: "Rom 3" },
    { id: "t4", status: "active", room: "Hele boligen" },
  ];
  const processes = [
    { id: "p0", tenancy_id: "t1", scope: "one_room", state: "cancelled" },
    { id: "p1", tenancy_id: "t1", scope: "one_room", state: "deposit" },
    { id: "p2", tenancy_id: "t2", scope: "one_room", state: "approved" },
    { id: "p3", tenancy_id: "t3", scope: "one_room", state: "deposit" },
    { id: "p4", tenancy_id: "t4", scope: "one_room", state: "deposit" },
  ];
  const settlements = new Map([["t1", "accepted"], ["t2", "absent"], ["t3", "disputed"], ["t4", "absent"]]);
  const lines = readyLines({
    tenancies, processes, settlements, members: new Map(), housingKind: "shared",
    roomOf: (t) => t.room, namesOf: (t) => (t.id === "t1" ? ["Kari Nordmann", "Ola Nordmann"] : ["01019012345"]),
  });
  assert.deepEqual(lines.map((l) => [l.tenancyId, l.processId, l.subject]), [
    ["t1", "p1", "Rom 1 – Kari Nordmann, Ola Nordmann"], ["t2", "p2", "Rom 2"], ["t4", "p4", "Rom"],
  ]);
  assert.equal(lines[0].body, READY_BODY.approvedRoom);
  assert.equal(lines[1].body, READY_BODY.skippedRoom);
  const later = readyLines({ tenancies, processes, settlements, members: new Map(), housingKind: "shared", roomOf: (t) => t.room, namesOf: () => [], postponed: (id) => id === "t1" });
  assert.deepEqual(later.map((l) => l.tenancyId), ["t2", "t4"]);
});

test("regular home: name only, room when several are active", () => {
  const one = readyLines({
    tenancies: [{ id: "t1", status: "active" }], processes: [{ id: "p1", tenancy_id: "t1", scope: "whole_tenancy", state: "deposit" }],
    settlements: new Map([["t1", "full_refund"]]), members: new Map(), housingKind: "standard", roomOf: () => "Rom 1", namesOf: () => ["Kari Nordmann"],
  });
  assert.deepEqual([one[0].subject, one[0].body], ["Kari Nordmann", READY_BODY.approved]);
});

test("postpone key uses the upper-case uuid", () => {
  assert.equal(postponeKey("ab-cd"), "tenancy.readyToEnd.postponed.AB-CD");
});
