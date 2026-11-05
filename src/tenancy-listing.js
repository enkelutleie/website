// Landlord tenancy visibility (iOS #1553). Overview keeps draft, invited and active
// tenancies, including a future start date. Ending a tenancy (status "ended") removes
// it from Overview. History stays the list_tenancy_history rows; an ended manually
// registered tenancy that the RPC omitted is added beside them. Nothing is deleted.

export const OVERVIEW_TENANCY_STATUSES = ["draft", "invited", "active"];

export const isOverviewTenancy = (tenancy) =>
  !!tenancy && OVERVIEW_TENANCY_STATUSES.includes(tenancy.status) && !tenancy.archived_at;

export const overviewTenancies = (tenancies) => (tenancies ?? []).filter(isOverviewTenancy);

// A manually registered tenant has no app account yet (manual_occupants, party_role tenant).
export const isManualOccupant = (occupant) =>
  !!occupant && occupant.party_role === "tenant" && !occupant.claimed_user_id;

export const manualOccupantsFor = (occupants, tenancyId) =>
  (occupants ?? []).filter((o) => o.tenancy_id === tenancyId && isManualOccupant(o));

const personName = (value, fallback) => {
  const name = typeof value === "string" ? value.trim() : "";
  return name || fallback;
};

// Rows for Oversikt > Leieforhold. Null when the tenancy is not a current one,
// so an ended manual registration cannot be painted there.
export function overviewTenancyPresentation(tenancy, { members = [], occupants = [] } = {}) {
  if (!isOverviewTenancy(tenancy)) return null;
  const tenants = members.filter((m) => m.tenancy_id === tenancy.id && m.role === "tenant");
  if (tenants.length) {
    return {
      tenancy,
      kind: "members",
      people: tenants.map((m) => ({ name: personName(m.name, "Leietaker"), phone: null })),
    };
  }
  const manuals = manualOccupantsFor(occupants, tenancy.id);
  if (manuals.length) {
    return {
      tenancy,
      kind: "manual",
      people: manuals.map((o) => ({ name: personName(o.display_name, "Leietaker"), phone: o.phone?.trim() || null })),
    };
  }
  return { tenancy, kind: "empty", people: [] };
}

const snapshotTenants = (tenancy) =>
  (Array.isArray(tenancy?.history_tenants) ? tenancy.history_tenants : [])
    .filter((t) => t && (t.name || t.phone || t.email));

// Read-only history row for an ended manual tenancy. Null for every other tenancy,
// so active, future, cancelled and ordinary ended rows are never invented here.
export function historyRowForEndedManual(tenancy, occupants) {
  if (tenancy?.status !== "ended") return null;
  const manuals = manualOccupantsFor(occupants, tenancy.id);
  if (!manuals.length) return null;
  const fromSnapshot = snapshotTenants(tenancy);
  const tenants = fromSnapshot.length
    ? fromSnapshot
    : manuals.map((o) => ({ name: o.display_name?.trim() || null, phone: o.phone?.trim() || null, email: null }));
  return {
    tenancy_id: tenancy.id,
    property_id: tenancy.property_id,
    status: "ended",
    start_date: tenancy.start_date ?? null,
    end_date: tenancy.end_date ?? null,
    closed_at: tenancy.ended_at ?? null,
    tenant_name: tenancy.history_tenant_name ?? tenants[0]?.name ?? null,
    tenant_phone: tenancy.history_tenant_phone ?? tenants[0]?.phone ?? null,
    tenant_email: tenancy.history_tenant_email ?? tenants[0]?.email ?? null,
    tenants,
    contracts: [],
    settlement: null,
    checklists: [],
    conversation_id: null,
  };
}

const closedStamp = (row) => {
  const v = row?.closed_at;
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

// Keep every existing history row, in its original order. Insert missing rows by
// closed_at without reordering what was already there.
export function mergeTenancyHistory(existing, supplements) {
  const rows = [...(existing ?? [])];
  const seen = new Set(rows.map((row) => row.tenancy_id));
  const extra = (supplements ?? [])
    .filter((row) => row?.tenancy_id && !seen.has(row.tenancy_id))
    .sort((a, b) => {
      const at = closedStamp(a);
      const bt = closedStamp(b);
      if (at == null && bt == null) return 0;
      if (at == null) return 1;
      if (bt == null) return -1;
      return bt - at;
    });
  for (const row of extra) {
    seen.add(row.tenancy_id);
    const at = closedStamp(row);
    const index = at == null ? -1 : rows.findIndex((current) => {
      const stamp = closedStamp(current);
      return stamp != null && stamp < at;
    });
    if (index === -1) rows.push(row);
    else rows.splice(index, 0, row);
  }
  return rows;
}

// Status change only. The source record stays in the array.
export function applyTenancyTermination(tenancies, tenancyId, { endDate, endedAt }) {
  return (tenancies ?? []).map((tenancy) => (
    tenancy.id === tenancyId
      ? { ...tenancy, status: "ended", end_date: endDate, ended_at: endedAt }
      : tenancy
  ));
}

export function historyFromRefresh(rpcRows, endedTenancies, occupants) {
  const supplements = (endedTenancies ?? [])
    .map((tenancy) => historyRowForEndedManual(tenancy, occupants))
    .filter(Boolean);
  return mergeTenancyHistory(rpcRows ?? [], supplements);
}
