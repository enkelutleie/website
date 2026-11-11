// Calendar per room in shared housing (iOS #1600, CALENDAR_ROOM_AUDIENCE_ANDROID_PARITY, «Web-portalen»).
// The portal user is always the landlord. Writes go only through the v2 RPCs; a missing RPC falls
// back to the old ones and the old behaviour.

// «Gjelder» room picker. On since iOS #1601 closed the list_history_h1 gap.
// Off: events are created for the whole home, as before the room audience.
export const CALENDAR_ROOM_PICKER_ENABLED = true;

export const ROOM_TEXT = {
  appliesTo: "Gjelder",
  appliesToHint: "Velg hvilke rom som ser hendelsen. Alle rom gjelder også rom du legger til senere.",
  allRooms: "Alle rom",
  requiresResponse: "Krever svar fra leietaker",
  requiresResponseHint: "Leietakeren får svarknapper. Slå av for en ren informasjonshendelse.",
  info: "Dette er informasjon. Ingen svar trengs.",
  propose: "Foreslå ny tid",
  proposeTitle: "Ny tid",
  accepted: "Godtatt",
  declined: "Avslått",
  unanswered: "Ikke svart",
  roomFallback: "Rom",
  proposeError: "Kunne ikke foreslå ny tid.",
  timeProposed: "Ny tid er sendt til rommene som avslo.",
};
export const acceptedCountText = (accepted, recipients) => `${accepted} av ${recipients} har godtatt`;

// PGRST202 (PostgREST: function not in the schema cache), 42883 (undefined function), or a message
// saying the function does not exist. Any other error is a real error and is not a fallback.
export const isMissingRpc = (error) => {
  if (!error) return false;
  const code = String(error.code ?? "");
  if (code === "PGRST202" || code === "42883") return true;
  const msg = String(error.message ?? error).toLowerCase();
  return msg.includes("could not find the function") || msg.includes("function not found")
    || (msg.includes("function") && msg.includes("does not exist"));
};

const WHOLE = "Hele boligen";
const publicLabel = (label) => {
  const t = typeof label === "string" ? label.trim() : "";
  return !t || t === WHOLE ? null : t;
};
const natural = (a, b) => a.localeCompare(b, "nb", { numeric: true, sensitivity: "base" });

// Active tenancies with a public room name, sorted by name.
export const roomChoices = (tenancies, unitLabelOf) => (tenancies ?? [])
  .filter((t) => t.status === "active")
  .map((t) => ({ tenancyId: t.id, label: publicLabel(unitLabelOf(t)) }))
  .filter((c) => c.label)
  .sort((a, b) => natural(a.label, b.label));

export const showsPicker = (housingKind, choices, isMaintenance, enabled = CALENDAR_ROOM_PICKER_ENABLED) => {
  if (!enabled || isMaintenance || (choices ?? []).length < 2) return false;
  if (housingKind === "standard" || housingKind === "rental_unit") return false;
  if (housingKind === "shared") return true;
  return new Set(choices.map((c) => c.label.toLocaleLowerCase("nb").normalize("NFD").replace(/\p{Diacritic}/gu, ""))).size >= 2;
};

export const showsRequiresToggle = ({ isMaintenance, visibility, hasActiveTenant }) =>
  !isMaintenance && visibility !== "manager_private" && !!hasActiveTenant;

// Null (whole home, also future rooms) or the chosen tenancy ids, sorted.
export const audienceIds = (choice) => (choice === "all" || !choice?.length ? null : [...choice].sort());

// One summary per item from list_calendar_item_responses_v2, rooms sorted by name, then id.
export const groupSummaries = (rows) => {
  const by = new Map();
  for (const r of rows ?? []) by.set(r.calendar_item_id, [...(by.get(r.calendar_item_id) ?? []), r]);
  const out = new Map();
  for (const [id, list] of by) {
    const rooms = [...list].sort((a, b) => natural(String(a.unit_label ?? "").trim(), String(b.unit_label ?? "").trim()) || String(a.tenancy_id).localeCompare(String(b.tenancy_id)));
    const first = rooms[0];
    const requiresResponse = first.requires_response !== false;
    const recipients = first.recipient_count ?? 0;
    const declined = first.declined_count ?? 0;
    const showsProgress = requiresResponse && recipients > 1;
    out.set(id, {
      rooms, requiresResponse, audienceRestricted: first.audience_restricted === true,
      accepted: first.accepted_count ?? 0, declined, unanswered: first.unanswered_count ?? 0, recipients,
      showsProgress, canPropose: showsProgress && declined > 0,
    });
  }
  return out;
};

// CalendarRoomAudienceOverlay.apply for the landlord. rows null: v2 did not run, legacy answers stay.
// Maintenance is never overridden. An info event has no answer. With several rooms, a legacy decline
// that is not every room's decline does not hide the event as declined.
export const overlayManager = (items, rows) => {
  if (!rows) return items;
  const summaries = groupSummaries(rows);
  return items.map((item) => {
    const s = summaries.get(item.id);
    if (item.maintenance_request_id || !s) return item;
    if (!s.requiresResponse) return { ...item, requires_response: false, tenant_response: null, tenant_response_comment: null };
    const next = { ...item, requires_response: true };
    if (s.recipients > 1 && item.tenant_response === "declined" && s.declined !== s.recipients) next.tenant_response = null;
    return next;
  });
};

export const roomStatus = (decision) =>
  decision === "accepted" ? ROOM_TEXT.accepted : decision === "declined" ? ROOM_TEXT.declined : ROOM_TEXT.unanswered;
export const roomTitle = (row) => publicLabel(row?.unit_label) ?? (String(row?.unit_label ?? "").trim() || ROOM_TEXT.roomFallback);

// «Foreslå ny tid» sends only the time fields of the item's kind. An event keeps its duration.
export const proposeTimes = (item, startIso, allDay) => {
  if (item.item_type === "deadline") return { requested_starts_at: null, requested_due_at: startIso, requested_ends_at: null, requested_all_day: allDay };
  let ends = null;
  if (item.ends_at && item.starts_at) {
    const span = Math.max(0, new Date(item.ends_at) - new Date(item.starts_at));
    ends = new Date(new Date(startIso).getTime() + span).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return { requested_starts_at: startIso, requested_due_at: null, requested_ends_at: ends, requested_all_day: allDay };
};

// «Krever svar fra leietaker» as one card (iOS #1602, CALENDAR_REQUIRE_RESPONSE_SECTION_ANDROID_PARITY).
export const RR_TEXT = {
  title: "Krever svar fra leietaker",
  subtitle: "Leietakere må godkjenne eller avslå hendelsen.",
  who: "Hvem skal svare?",
  all: "Alle leietakere",
  select: "Velg leietakere",
  legacyRooms: (rooms) => `Gjelder bare: ${rooms.join(", ")}`,
};

const NATIONAL_ID = (s) => s.replace(/\D/g, "").length === 11 && /^[\d -]+$/.test(s);
// Profile names and manual residents only: never an e-mail, an 11-digit string or «Registrert leietaker».
export const respondentNames = (names) => {
  const out = [];
  for (const raw of names ?? []) {
    const t = typeof raw === "string" ? raw.trim() : "";
    if (!t || t.includes("@") || NATIONAL_ID(t) || t.toLowerCase() === "registrert leietaker" || out.includes(t)) continue;
    out.push(t);
  }
  return out;
};
// «Rom 1 – Kari Nordmann, Ola Nordmann», or just the room.
export const respondentLine = (room, names) => {
  const list = respondentNames(names);
  return list.length ? `${room} – ${list.join(", ")}` : room;
};

/**
 * CalendarRequireResponseForm.mapping.
 * shown: the switch is offered (not maintenance, not «Kun for utleiere», a tenant exists).
 * picker: «Hvem skal svare?» is offered. legacyRooms: saved rooms on an event without reply.
 * → { requiresResponse, audience: null | [tenancy ids], valid }
 */
export const requireResponseMapping = ({ shown, on, picker, mode, selected, legacyRooms = null }) => {
  if (!shown) return { requiresResponse: true, audience: null, valid: true };
  if (!on) return { requiresResponse: false, audience: legacyRooms?.length ? [...legacyRooms].sort() : null, valid: true };
  if (!picker || mode !== "select") return { requiresResponse: true, audience: null, valid: true };
  const ids = [...(selected ?? [])].sort();
  return { requiresResponse: true, audience: ids.length ? ids : null, valid: ids.length > 0 };
};
