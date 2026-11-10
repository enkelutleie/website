// «Klar til å avslutte leieforholdet» cards (iOS #1597, CLOSE_TENANCY_CARD_SHARED_HOUSING_ANDROID_PARITY
// and END_TENANCY_POSTPONE_ANDROID_PARITY). One card per ready tenancy; each card completes only
// its own move_out_processes row through complete_move_out(p_process_id).

export const READY_TITLE = "Klar til å avslutte leieforholdet";
export const READY_BUTTON = "Avslutt leieforholdet";
export const READY_LATER = "Gjør det senere";
export const READY_BODY = {
  approved: "Utflyttingen og depositumsoppgjøret er godkjent av begge parter. Når du avslutter, flyttes leieforholdet til Tidligere leieforhold, og boligen blir ledig for nye leietakere.",
  approvedRoom: "Utflyttingen og depositumsoppgjøret er godkjent av begge parter. Når du avslutter, flyttes dette leieforholdet til Tidligere leieforhold, og rommet blir ledig for en ny leietaker.",
  skipped: "Utflyttingen er ferdigstilt, og depositumsoppgjøret ble hoppet over. Når du avslutter, flyttes leieforholdet til Tidligere leieforhold, og boligen blir ledig for nye leietakere.",
  skippedRoom: "Utflyttingen er ferdigstilt, og depositumsoppgjøret ble hoppet over. Når du avslutter, flyttes dette leieforholdet til Tidligere leieforhold, og rommet blir ledig for en ny leietaker.",
};

const ONGOING_OFF = ["ended", "cancelled"];
export const isOngoing = (process) => !!process && !ONGOING_OFF.includes(process.state);

// MoveOutFinishEligibility.checksDeposit / isLastActiveTenant.
export const checksDeposit = (scope, last) => scope !== "one_tenant" || last;
export const isLastActiveTenant = (process, memberIds) => {
  if (process?.scope !== "one_tenant" || !memberIds) return false;
  if (!process.subject_member_id) return memberIds.length <= 1;
  return !memberIds.some((id) => id !== process.subject_member_id);
};

// settlement: "unknown" (read failed / not read), "absent" (no row) or a status string.
export const showsReadyToEnd = ({ scope, state, tenancyStatus, last, settlement }) => {
  if (state !== "approved" && state !== "deposit") return false;
  if (tenancyStatus !== "active") return false;
  const checks = checksDeposit(scope, last);
  if (settlement === "unknown") return !checks;
  if (!checks) return true;
  return settlement === "absent" || settlement === "accepted" || settlement === "full_refund";
};

export const readyBody = (settlement, sharedHousing) => {
  const approved = settlement === "accepted" || settlement === "full_refund";
  if (sharedHousing) return approved ? READY_BODY.approvedRoom : READY_BODY.skippedRoom;
  return approved ? READY_BODY.approved : READY_BODY.skipped;
};

const WHOLE = "Hele boligen";
export const publicRoomLabel = (label) => {
  const t = typeof label === "string" ? label.trim() : "";
  return !t || t === WHOLE ? null : t;
};

// Nil housing kind: a public room label still counts as shared.
export const isSharedHousing = (housingKind, roomLabel) => {
  if (housingKind === "shared") return true;
  if (housingKind === "standard" || housingKind === "rental_unit") return false;
  return roomLabel != null;
};

const SENTINEL = "registrert leietaker";
// Eleven digits, with only spaces and hyphens beside them: the national identity number shape.
export const isNationalIdentityNumber = (value) => {
  const s = String(value ?? "");
  const digits = s.replace(/\D/g, "");
  return digits.length === 11 && /^[\d -]+$/.test(s);
};
export const displayNames = (names) => {
  const out = [];
  for (const raw of names ?? []) {
    const t = typeof raw === "string" ? raw.trim() : "";
    if (!t || t.toLowerCase() === SENTINEL || isNationalIdentityNumber(t) || out.includes(t)) continue;
    out.push(t);
  }
  return out;
};

// «Rom 1 – Kari Nordmann», only the room, only the names, or null.
export const subjectLine = ({ sharedHousing, housingKind, severalActive, roomLabel, names }) => {
  const joined = displayNames(names).join(", ");
  let room = null;
  if (sharedHousing) room = roomLabel ?? (housingKind === "shared" ? "Rom" : null);
  else if (severalActive) room = roomLabel;
  if (room && joined) return `${room} – ${joined}`;
  return room || joined || null;
};

// One card line per ready tenancy. settlements: Map tenancyId → fact; members: Map tenancyId → [member id].
export const readyLines = ({ tenancies, processes, settlements, members, housingKind, roomOf, namesOf, postponed = () => false }) => {
  const several = tenancies.filter((t) => t.status === "active").length > 1;
  const lines = [];
  for (const t of tenancies) {
    if (postponed(t.id)) continue;
    const process = [...(processes ?? [])].reverse().find((p) => isOngoing(p) && p.tenancy_id === t.id);
    if (!process) continue;
    const settlement = settlements.get(t.id) ?? "unknown";
    const last = isLastActiveTenant(process, members.get(t.id));
    if (!showsReadyToEnd({ scope: process.scope, state: process.state, tenancyStatus: t.status, last, settlement })) continue;
    const room = publicRoomLabel(roomOf(t));
    const shared = isSharedHousing(housingKind, room);
    lines.push({
      tenancyId: t.id,
      processId: process.id,
      body: readyBody(settlement, shared),
      subject: subjectLine({ sharedHousing: shared, housingKind, severalActive: several, roomLabel: room, names: namesOf(t) }),
    });
  }
  return lines;
};

// Device-local postpone, one flag per tenancy (iOS uuidString is upper case).
export const postponeKey = (tenancyId) => `tenancy.readyToEnd.postponed.${String(tenancyId).toUpperCase()}`;
