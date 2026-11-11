import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptedCountText, audienceIds, CALENDAR_ROOM_PICKER_ENABLED, groupSummaries, isMissingRpc, overlayManager, proposeTimes,
  requireResponseMapping, respondentLine, respondentNames, roomChoices, roomStatus, roomTitle, RR_TEXT, showsPicker, showsRequiresToggle,
} from "./portal-calendar-rooms.js";

test("the room picker flag is on (iOS #1601)", () => {
  assert.equal(CALENDAR_ROOM_PICKER_ENABLED, true);
});

test("missing RPC: PGRST202, 42883 or a not-found message; other errors are real", () => {
  assert.equal(isMissingRpc({ code: "PGRST202", message: "x" }), true);
  assert.equal(isMissingRpc({ code: "42883" }), true);
  assert.equal(isMissingRpc({ message: "Could not find the function public.create_calendar_item_v2" }), true);
  assert.equal(isMissingRpc({ message: "function public.x(uuid) does not exist" }), true);
  assert.equal(isMissingRpc({ code: "22023", message: "calendar_audience_not_allowed" }), false);
  assert.equal(isMissingRpc(null), false);
});

test("room choices: active tenancies with a public room name, natural order", () => {
  const labels = { a: "Rom 10", b: "Rom 2", c: "Hele boligen", d: " ", e: "Rom 1" };
  const tenancies = ["a", "b", "c", "d", "e"].map((id) => ({ id, status: "active" })).concat({ id: "f", status: "ended" });
  assert.deepEqual(roomChoices(tenancies, (t) => labels[t.id] ?? "Rom 9").map((c) => c.label), ["Rom 1", "Rom 2", "Rom 10"]);
});

test("picker: shared with two named rooms, never a regular home or maintenance; flag gates it", () => {
  const two = [{ tenancyId: "a", label: "Rom 1" }, { tenancyId: "b", label: "Rom 2" }];
  assert.equal(showsPicker("shared", two, false, true), true);
  assert.equal(showsPicker("shared", two, false, false), false);
  assert.equal(showsPicker("shared", two, false), true);
  assert.equal(showsPicker("shared", two.slice(0, 1), false, true), false);
  assert.equal(showsPicker("standard", two, false, true), false);
  assert.equal(showsPicker("rental_unit", two, false, true), false);
  assert.equal(showsPicker("shared", two, true, true), false);
  assert.equal(showsPicker(null, two, false, true), true);
  assert.equal(showsPicker(null, [{ tenancyId: "a", label: "Rom 1" }, { tenancyId: "b", label: "rom 1" }], false, true), false);
});

test("«Krever svar» switch: hidden for maintenance, private and no active tenant", () => {
  assert.equal(showsRequiresToggle({ isMaintenance: false, visibility: "tenant_shared", hasActiveTenant: true }), true);
  assert.equal(showsRequiresToggle({ isMaintenance: true, visibility: "tenant_shared", hasActiveTenant: true }), false);
  assert.equal(showsRequiresToggle({ isMaintenance: false, visibility: "manager_private", hasActiveTenant: true }), false);
  assert.equal(showsRequiresToggle({ isMaintenance: false, visibility: "tenant_shared", hasActiveTenant: false }), false);
});

test("audience ids: all rooms is null, a set is sorted ids", () => {
  assert.equal(audienceIds("all"), null);
  assert.equal(audienceIds([]), null);
  assert.deepEqual(audienceIds(["b", "a"]), ["a", "b"]);
});

const row = (item, tenancy, label, decision, extra = {}) => ({
  calendar_item_id: item, tenancy_id: tenancy, unit_label: label, decision, comment: null, responded_at: null,
  accepted_count: 1, declined_count: 1, unanswered_count: 1, recipient_count: 3, requires_response: true, audience_restricted: false, ...extra,
});

test("summaries: counts, sorted rooms, progress only for more than one recipient", () => {
  const s = groupSummaries([row("i", "t2", "Rom 2", "declined"), row("i", "t1", "Rom 1", "accepted"), row("i", "t3", "Rom 10", null)]).get("i");
  assert.deepEqual(s.rooms.map((r) => r.unit_label), ["Rom 1", "Rom 2", "Rom 10"]);
  assert.deepEqual([s.accepted, s.recipients, s.showsProgress, s.canPropose], [1, 3, true, true]);
  const one = groupSummaries([row("j", "t1", "Rom 1", "declined", { recipient_count: 1, declined_count: 1 })]).get("j");
  assert.deepEqual([one.showsProgress, one.canPropose], [false, false]);
  const info = groupSummaries([row("k", "t1", "Rom 1", null, { requires_response: false, accepted_count: 0, declined_count: 0, unanswered_count: 0, recipient_count: 2 })]).get("k");
  assert.deepEqual([info.requiresResponse, info.showsProgress, info.canPropose], [false, false, false]);
  assert.equal(acceptedCountText(1, 3), "1 av 3 har godtatt");
});

test("only requires_response === true asks for a reply; null, missing and false are info (iOS #1607)", () => {
  for (const extra of [{ requires_response: null }, { requires_response: undefined }, { requires_response: false }, { requires_response: "true" }]) {
    const s = groupSummaries([row("n", "t1", "Rom 1", null, { ...extra, recipient_count: 2 })]).get("n");
    assert.deepEqual([s.requiresResponse, s.showsProgress, s.canPropose], [false, false, false]);
  }
  assert.equal(groupSummaries([row("y", "t1", "Rom 1", null, { recipient_count: 2 })]).get("y").requiresResponse, true);
  const [info] = overlayManager([{ id: "n", tenant_response: "accepted", requires_response: null }], [row("n", "t1", "Rom 1", null, { requires_response: null })]);
  assert.deepEqual([info.requires_response, info.tenant_response], [false, null]);
});

test("manager overlay: info clears answer, a partial decline is not a decline, maintenance untouched, null keeps legacy", () => {
  const items = [
    { id: "i", tenant_response: "declined" },
    { id: "k", tenant_response: "accepted" },
    { id: "m", tenant_response: "declined", maintenance_request_id: "x" },
    { id: "all", tenant_response: "declined" },
  ];
  const rows = [
    row("i", "t1", "Rom 1", "declined"),
    row("k", "t1", "Rom 1", null, { requires_response: false, recipient_count: 2 }),
    row("m", "t1", "Rom 1", "declined", { declined_count: 1, recipient_count: 3 }),
    row("all", "t1", "Rom 1", "declined", { declined_count: 2, recipient_count: 2 }),
  ];
  const out = overlayManager(items, rows);
  assert.equal(out[0].tenant_response, null);
  assert.deepEqual([out[1].tenant_response, out[1].requires_response], [null, false]);
  assert.equal(out[2].tenant_response, "declined");
  assert.equal(out[3].tenant_response, "declined");
  assert.equal(overlayManager(items, null), items);
  assert.deepEqual(overlayManager(items, []).map((i) => i.tenant_response), ["declined", "accepted", "declined", "declined"]);
});

test("room status and title texts", () => {
  assert.equal(roomStatus("accepted"), "Godtatt");
  assert.equal(roomStatus("declined"), "Avslått");
  assert.equal(roomStatus(null), "Ikke svart");
  assert.equal(roomTitle({ unit_label: " Rom 1 " }), "Rom 1");
  assert.equal(roomTitle({ unit_label: "Hele boligen" }), "Hele boligen");
  assert.equal(roomTitle({ unit_label: null }), "Rom");
});

test("«Foreslå ny tid» sends only the time fields of the kind", () => {
  const event = { item_type: "event", starts_at: "2026-11-20T09:00:00Z", ends_at: "2026-11-20T10:30:00Z" };
  assert.deepEqual(proposeTimes(event, "2026-11-21T12:00:00Z", false), {
    requested_starts_at: "2026-11-21T12:00:00Z", requested_due_at: null, requested_ends_at: "2026-11-21T13:30:00Z", requested_all_day: false,
  });
  assert.deepEqual(proposeTimes({ item_type: "event", starts_at: "2026-11-20T09:00:00Z" }, "2026-11-21T12:00:00Z", false).requested_ends_at, null);
  assert.deepEqual(proposeTimes({ item_type: "deadline", due_at: "x" }, "2026-11-21T23:00:00Z", true), {
    requested_starts_at: null, requested_due_at: "2026-11-21T23:00:00Z", requested_ends_at: null, requested_all_day: true,
  });
});


test("require-response mapping follows the parity table", () => {
  const base = { shown: true, picker: true, mode: "all", selected: [] };
  assert.deepEqual(requireResponseMapping({ ...base, on: false }), { requiresResponse: false, audience: null, valid: true });
  assert.deepEqual(requireResponseMapping({ ...base, on: true }), { requiresResponse: true, audience: null, valid: true });
  assert.deepEqual(requireResponseMapping({ ...base, on: true, mode: "select", selected: ["b", "a"] }), { requiresResponse: true, audience: ["a", "b"], valid: true });
  assert.equal(requireResponseMapping({ ...base, on: true, mode: "select", selected: [] }).valid, false);
  assert.deepEqual(requireResponseMapping({ ...base, picker: false, on: true, mode: "select", selected: ["a"] }), { requiresResponse: true, audience: null, valid: true });
  assert.deepEqual(requireResponseMapping({ ...base, shown: false, on: false }), { requiresResponse: true, audience: null, valid: true });
  // Legacy: an info event for some rooms keeps those rooms when saved with the switch off.
  assert.deepEqual(requireResponseMapping({ ...base, on: false, legacyRooms: ["r2", "r1"] }), { requiresResponse: false, audience: ["r1", "r2"], valid: true });
});

test("respondent lines: profile and manual names, never e-mail or national id", () => {
  assert.deepEqual(respondentNames([" Kari Nordmann ", "kari@example.com", "12345678901", "010190 12345", "Registrert leietaker", "Kari Nordmann", "Ola"]), ["Kari Nordmann", "Ola"]);
  assert.equal(respondentLine("Rom 1", ["Kari Nordmann", "Ola Nordmann"]), "Rom 1 – Kari Nordmann, Ola Nordmann");
  assert.equal(respondentLine("Rom 2", ["ola@example.com"]), "Rom 2");
  assert.equal(RR_TEXT.legacyRooms(["Rom 1", "Rom 2"]), "Gjelder bare: Rom 1, Rom 2");
});
