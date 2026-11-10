import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OVERVIEW_TENANCY_STATUSES,
  applyTenancyTermination,
  historyFromRefresh,
  historyRowForEndedManual,
  mergeTenancyHistory,
  overviewTenancies,
  overviewTenancyPresentation,
} from "./tenancy-listing.js";

const propertyId = "property-1";
const manual = (id, extra = {}) => ({
  id,
  property_id: propertyId,
  status: "active",
  start_date: "2024-03-01",
  end_date: null,
  archived_at: null,
  ...extra,
});
const occupant = (tenancyId, extra = {}) => ({
  tenancy_id: tenancyId,
  property_id: propertyId,
  party_role: "tenant",
  display_name: "Kari Nordmann",
  phone: "40000000",
  claimed_user_id: null,
  ...extra,
});
const priorHistory = {
  tenancy_id: "history-1",
  property_id: propertyId,
  status: "ended",
  closed_at: "2023-05-01T00:00:00Z",
  tenant_name: "Eldre Leietaker",
  tenants: [{ name: "Eldre Leietaker", phone: null, email: "eldre@example.com" }],
  contracts: [{ title: "Kontrakt" }],
};

describe("overview tenancies", () => {
  it("shows an active manually registered tenancy and hides an ended one", () => {
    const active = manual("manual-active");
    const ended = manual("manual-ended", { status: "ended", end_date: "2026-11-01", ended_at: "2026-11-01T08:00:00Z" });
    const occupants = [occupant("manual-active"), occupant("manual-ended")];
    const visible = overviewTenancies([active, ended]);

    assert.deepEqual(visible.map((t) => t.id), ["manual-active"]);
    assert.equal(overviewTenancyPresentation(ended, { occupants }), null);
    const shown = overviewTenancyPresentation(active, { occupants });
    assert.equal(shown.kind, "manual");
    assert.deepEqual(shown.people, [{ name: "Kari Nordmann", phone: "40000000" }]);
  });

  it("keeps active and future tenancies, including a future end date that is still active", () => {
    const current = manual("current", { start_date: "2025-01-01" });
    const futureStart = manual("future", { start_date: "2027-04-01" });
    const activeUntilLater = manual("fixed", { start_date: "2026-01-01", end_date: "2027-12-31" });
    const pastEndStillActive = manual("past-end", { start_date: "2024-01-01", end_date: "2026-01-01" });
    const draft = manual("draft", { status: "draft", start_date: null });
    const invited = manual("invited", { status: "invited" });
    const ids = overviewTenancies([current, futureStart, activeUntilLater, pastEndStillActive, draft, invited]).map((t) => t.id);

    assert.deepEqual(ids, ["current", "future", "fixed", "past-end", "draft", "invited"]);
    assert.deepEqual(OVERVIEW_TENANCY_STATUSES, ["draft", "invited", "active"]);
  });

  it("does not treat a claimed or landlord party as the manual tenant", () => {
    const tenancy = manual("manual-active");
    const claimed = overviewTenancyPresentation(tenancy, {
      occupants: [occupant("manual-active", { claimed_user_id: "user-1" })],
    });
    const landlord = overviewTenancyPresentation(tenancy, {
      occupants: [occupant("manual-active", { party_role: "landlord", display_name: "Utleier" })],
    });
    assert.equal(claimed.kind, "empty");
    assert.equal(landlord.kind, "empty");
  });

  it("prefers an accepted member over the manual registration", () => {
    const tenancy = manual("manual-active");
    const shown = overviewTenancyPresentation(tenancy, {
      members: [{ tenancy_id: "manual-active", role: "tenant", name: "Per App" }],
      occupants: [occupant("manual-active")],
    });
    assert.equal(shown.kind, "members");
    assert.deepEqual(shown.people, [{ name: "Per App", phone: null }]);
  });
});

describe("rental history", () => {
  it("adds an ended manual tenancy without dropping or reordering existing history", () => {
    const newer = { ...priorHistory, tenancy_id: "history-new", closed_at: "2026-10-01T00:00:00Z", tenant_name: "Ny" };
    const existing = [newer, priorHistory];
    const ended = manual("manual-ended", {
      status: "ended",
      end_date: "2025-06-01",
      ended_at: "2025-06-01T12:00:00Z",
    });
    const row = historyRowForEndedManual(ended, [occupant("manual-ended")]);
    const merged = mergeTenancyHistory(existing, [row]);

    assert.deepEqual(existing.map((r) => r.tenancy_id), ["history-new", "history-1"]);
    assert.deepEqual(merged.map((r) => r.tenancy_id), ["history-new", "manual-ended", "history-1"]);
    assert.equal(merged[1].tenant_name, "Kari Nordmann");
    assert.equal(merged[1].tenant_phone, "40000000");
    assert.equal(merged[0].contracts[0].title, "Kontrakt");
  });

  it("does not duplicate a manual tenancy the history RPC already returned", () => {
    const ended = manual("manual-ended", { status: "ended", ended_at: "2026-11-05T10:00:00Z", end_date: "2026-11-05" });
    const rpcRow = {
      tenancy_id: "manual-ended",
      closed_at: "2026-11-05T10:00:00Z",
      tenant_name: "Kari Nordmann",
      tenants: [{ name: "Kari Nordmann", phone: "40000000", email: null }],
      contracts: [{ title: "Signert kontrakt" }],
      settlement: { status: "accepted" },
    };
    const merged = historyFromRefresh([priorHistory, rpcRow], [ended], [occupant("manual-ended")]);
    assert.deepEqual(merged.map((r) => r.tenancy_id), ["history-1", "manual-ended"]);
    assert.equal(merged[1].contracts[0].title, "Signert kontrakt");
    assert.equal(merged[1].settlement.status, "accepted");
  });

  it("leaves cancelled and ordinary ended tenancies to the history RPC", () => {
    const cancelled = manual("cancelled", { status: "cancelled" });
    const ordinary = manual("ordinary", { status: "ended", ended_at: "2026-01-01T00:00:00Z" });
    assert.equal(historyRowForEndedManual(cancelled, [occupant("cancelled")]), null);
    assert.equal(historyRowForEndedManual(ordinary, []), null);
    assert.equal(historyRowForEndedManual(manual("still-active"), [occupant("still-active")]), null);
  });
});

describe("refresh after termination", () => {
  it("moves the ended manual tenancy to history and keeps every other record", () => {
    const activeManual = manual("manual-active");
    const future = manual("future", { start_date: "2027-02-01" });
    const regular = manual("regular", { start_date: "2025-08-01" });
    const occupants = [occupant("manual-active")];
    const before = [activeManual, future, regular];

    assert.deepEqual(overviewTenancies(before).map((t) => t.id), ["manual-active", "future", "regular"]);
    assert.equal(historyFromRefresh([priorHistory], [], occupants).some((r) => r.tenancy_id === "manual-active"), false);

    const endedAt = "2026-11-05T15:00:00Z";
    const after = applyTenancyTermination(before, "manual-active", { endDate: "2026-11-05", endedAt });
    assert.equal(after.length, before.length);
    assert.equal(before[0].status, "active");
    assert.equal(after.find((t) => t.id === "manual-active").status, "ended");

    const overviewFetch = after.filter((t) => OVERVIEW_TENANCY_STATUSES.includes(t.status) && !t.archived_at);
    const endedFetch = after.filter((t) => t.status === "ended");
    const overview = overviewTenancies(overviewFetch);
    const history = historyFromRefresh([priorHistory], endedFetch, occupants);

    assert.deepEqual(overview.map((t) => t.id), ["future", "regular"]);
    assert.deepEqual(history.map((r) => r.tenancy_id), ["manual-active", "history-1"]);
    assert.equal(history[0].tenant_name, "Kari Nordmann");
    assert.equal(history[0].end_date, "2026-11-05");
    assert.equal(history[1].tenant_name, "Eldre Leietaker");
    assert.equal(after.length, 3);
  });

  it("still files an ended manual tenancy when its end date is in the future", () => {
    const tenancy = manual("manual-active", { end_date: "2027-01-15" });
    const ended = applyTenancyTermination([tenancy], "manual-active", {
      endDate: "2027-01-15",
      endedAt: "2026-11-05T15:00:00Z",
    });
    assert.deepEqual(overviewTenancies(ended), []);
    const history = historyFromRefresh([], ended, [occupant("manual-active")]);
    assert.equal(history.length, 1);
    assert.equal(history[0].tenancy_id, "manual-active");
    assert.equal(history[0].end_date, "2027-01-15");
  });
});

describe("national identity numbers", () => {
  it("never shows an 11-digit string as a tenant name", () => {
    const tenancy = { id: "t", status: "active" };
    const view = overviewTenancyPresentation(tenancy, { members: [
      { tenancy_id: "t", role: "tenant", name: "12345678901" },
      { tenancy_id: "t", role: "tenant", name: "010190 12345" },
      { tenancy_id: "t", role: "tenant", name: "Kari 2" },
    ] });
    assert.deepEqual(view.people.map((p) => p.name), ["Leietaker", "Leietaker", "Kari 2"]);
  });
});
