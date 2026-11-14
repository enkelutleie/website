// Intercepts the Production Supabase host. Nothing is forwarded.
const HOST = /jfrorhixjsuomwtjwqla\.supabase\.co/;

export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const PROPERTY_ID = "22222222-2222-4222-8222-222222222222";
export const PROPERTY_2_ID = "33333333-3333-4333-8333-333333333333";
export const TENANCY_ID = "44444444-4444-4444-8444-444444444444";
export const TENANT_ID = "55555555-5555-4555-8555-555555555555";
export const MAINTENANCE_ID = "66666666-6666-4666-8666-666666666666";

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

export function sessionFor() {
  const exp = 2_000_000_000;
  const access = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: USER_ID, exp, role: "authenticated" })}.signature`;
  return {
    access_token: access,
    token_type: "bearer",
    expires_in: exp - Math.floor(Date.now() / 1000),
    expires_at: exp,
    refresh_token: "smoke-refresh-token",
    user: {
      id: USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "kari@example.com",
      app_metadata: {},
      user_metadata: { full_name: "Kari Utleier" },
    },
  };
}

const PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
).toString("base64");

const properties = [
  {
    id: PROPERTY_ID, owner_id: USER_ID, address_line1: "Testveien 1", postal_code: "0150", city: "Oslo",
    unit_identifier: "H0101", housing_kind: "standard", lifecycle_status: "active",
    rental_profile: { home_use: "other_home", landlord_kind: "individual", rental_duration: "long_term" },
    finn_code: null, payment_account_override: null, municipality_number: "0301", municipality_name: "Oslo",
  },
  {
    id: PROPERTY_2_ID, owner_id: USER_ID, address_line1: "Fjellveien 2", postal_code: "5003", city: "Bergen",
    unit_identifier: null, housing_kind: "standard", lifecycle_status: "active",
    rental_profile: { home_use: "other_home", landlord_kind: "individual", rental_duration: "long_term" },
    finn_code: null, payment_account_override: null, municipality_number: "4601", municipality_name: "Bergen",
  },
];

const tables = {
  profiles: [{ id: USER_ID, first_name: "Kari", display_name: "Kari Utleier", tax_residence_tiltakssone: false }],
  properties,
  property_members: [
    { property_id: PROPERTY_ID, user_id: USER_ID, role: "owner", valid_until: null },
    { property_id: PROPERTY_2_ID, user_id: USER_ID, role: "owner", valid_until: null },
  ],
  tenancies: [{ id: TENANCY_ID, property_id: PROPERTY_ID, status: "active", start_date: "2026-01-01", end_date: null, archived_at: null }],
  tenancy_members: [{ tenancy_id: TENANCY_ID, user_id: TENANT_ID, role: "tenant", invitation_status: "accepted", valid_until: null }],
  manual_occupants: [],
  maintenance_requests: [{
    id: MAINTENANCE_ID, property_id: PROPERTY_ID, tenancy_id: TENANCY_ID, created_by: TENANT_ID,
    title: "Drypp i kran", description: "Kjøkkenkranen drypper", category: "plumbing", priority: "normal",
    status: "reported", resolved_at: null, closed_at: null, submitted_at: "2026-11-01T10:00:00Z",
    last_activity_at: "2026-11-02T10:00:00Z", created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-02T10:00:00Z",
  }],
  maintenance_events: [],
  maintenance_images: [],
  maintenance_documents: [],
  financial_transactions: [{
    id: "77777777-7777-4777-8777-777777777777", property_id: PROPERTY_ID, transaction_type: "income",
    category: "rent", legacy_category: null, amount_minor: 1_200_000, transaction_date: "2026-11-01",
    description: "Husleie november", counterparty: "Ola Leietaker", maintenance_request_id: null,
    updated_at: "2026-11-01T10:00:00Z", voided_at: null,
  }],
  financial_transaction_documents: [],
  subscription_entitlements: [{ status: "active", expires_at: "2030-01-01T00:00:00Z", environment: "production" }],
  inspections: [],
  inspection_items: [],
  inspection_comments: [],
  move_out_processes: [],
  deposit_settlements: [],
  property_handbook_sections: [],
  property_handbook_settings: [],
  property_images: [],
  property_units: [],
  documents: [],
};

const agreement = {
  agreement_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  tenancy_id: TENANCY_ID,
  property_id: PROPERTY_ID,
  agreement_status: "draft",
  current_version_id: "vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv",
  draft_revision: 1,
};

const historyEntry = {
  tenancy_id: "hhhhhhhh-hhhh-4hhh-8hhh-hhhhhhhhhhhh",
  property_id: PROPERTY_ID,
  start_date: "2024-01-01",
  end_date: "2025-12-31",
  tenants: [{ name: "Ola Nordmann", phone: "90000000", email: "ola@example.com" }],
};

const calendarItem = {
  id: "e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1",
  property_id: PROPERTY_ID,
  title: "Visning",
  item_type: "event",
  status: "active",
  all_day: true,
  starts_at: "2026-11-15T12:00:00Z",
  due_at: null,
  ends_at: null,
  category: "inspection",
  visibility: "manager_private",
  description: "Visning av boligen",
  maintenance_request_id: null,
  tenant_response: null,
};
tables.property_calendar_items = [calendarItem];

const GALLERY_COLLECTION = "abababab-abab-4aba-8aba-abababababab";

function galleryImageRows() {
  return Array.from({ length: 6 }, (_, i) => ({
    id: `b0b0b0b0-b0b0-40b0-80b0-00000000000${i}`,
    collection_id: GALLERY_COLLECTION,
    property_id: PROPERTY_ID,
    storage_path: `gallery/${i}.jpg`,
    status: "ready",
    created_at: `2026-01-0${i + 1}T00:00:00Z`,
  }));
}

// Move-in/move-out with checklist photos from both the landlord and the tenant (iOS #1595).
export const HANDOVER_IN_ID = "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1";
export const HANDOVER_OUT_ID = "d2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2";
const HO_IN_COLLECTION = "e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1";
const HO_OUT_COLLECTION = "e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2";
const WALLS_IN = "property.detail.handover.moveIn.item.walls";
const WALLS_OUT = "property.detail.handover.moveOut.item.walls";
const hoNote = (data) => `[[eu-handover:${JSON.stringify(data)}]]`;
const HO_SHARED = {
  in: [{ k: WALLS_IN, d: true, c: "Liten flekk i stua", p: true }],
  out: [{ k: WALLS_OUT, d: false, c: "Hull etter bilde", p: true, bd: true, bc: "Liten flekk i stua" }],
  keys: [],
  meters: [{ kind: "electricity", in: "12345", out: "15000" }],
};
export function handoverTables(options = {}) {
  const inspection = (id, type, collection) => ({
    id, tenancy_id: TENANCY_ID, type, image_collection_id: collection, status: "finalized", protocol_mark: null,
    sent_for_review_at: null, tenant_decision: null, tenant_may_fill: false, tenant_fill_done_at: null,
    finalized_at: "2026-10-01T10:00:00Z", created_at: type === "move_in" ? "2025-01-01T10:00:00Z" : "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z",
  });
  const item = (inspectionId, data) => ({ id: `${inspectionId.slice(0, 8)}-0000-4000-8000-000000000001`, inspection_id: inspectionId, area_code: "other", condition: "ok", note: hoNote(data), sort_order: 0, updated_at: "2026-10-01T10:00:00Z" });
  const image = (n, collection, caption, uploadedBy, extra = {}) => ({
    id: `f0f0f0f0-f0f0-40f0-80f0-0000000000${String(n).padStart(2, "0")}`, collection_id: collection, property_id: PROPERTY_ID,
    caption, storage_path: `handover/${n}.jpg`, status: "ready", uploaded_by: uploadedBy,
    created_at: `2026-0${Math.min(9, n)}-01T10:00:00Z`, ...extra,
  });
  return {
    inspections: [inspection(HANDOVER_IN_ID, "move_in", HO_IN_COLLECTION), inspection(HANDOVER_OUT_ID, "move_out", HO_OUT_COLLECTION)],
    move_out_processes: [{ id: "d3d3d3d3-d3d3-43d3-83d3-d3d3d3d3d3d3", tenancy_id: TENANCY_ID, property_id: PROPERTY_ID, scope: "tenancy", subject_member_id: null, move_out_on: "2026-10-01", notice_party: "tenant", state: "deposit", inspection_id: HANDOVER_OUT_ID, notice_given_at: "2026-08-01T10:00:00Z" }],
    deposit_settlements: [{ id: "d4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4", status: options.status ?? "open", tenancy_id: TENANCY_ID, move_out_inspection_id: HANDOVER_OUT_ID, created_at: "2026-10-02T10:00:00Z" }],
    inspection_items: [item(HANDOVER_IN_ID, { in: HO_SHARED.in, keys: [], meters: [{ kind: "electricity", in: "12345" }] }), item(HANDOVER_OUT_ID, HO_SHARED)],
    property_images: [
      // Newest landlord photo listed first: the page sorts oldest first.
      image(3, HO_IN_COLLECTION, `eu-checklist:in:${WALLS_IN}`, USER_ID),
      image(1, HO_IN_COLLECTION, `eu-checklist-photo:in:0a0a0a0a-0a0a-40a0-80a0-0a0a0a0a0a0a:${WALLS_IN}`, TENANT_ID),
      image(4, HO_OUT_COLLECTION, `eu-checklist-photo:out:0b0b0b0b-0b0b-40b0-80b0-0b0b0b0b0b0b:${WALLS_OUT}`, TENANT_ID),
      image(5, HO_OUT_COLLECTION, `eu-checklist:out:${WALLS_OUT}`, USER_ID),
      image(2, HO_IN_COLLECTION, "Strøm (kWh) – Sjekkliste for innflytting", TENANT_ID),
      image(6, HO_OUT_COLLECTION, "Strøm (kWh) – Sjekkliste for utflytting", USER_ID),
      // Same storage path again: shown once.
      image(7, HO_OUT_COLLECTION, `eu-checklist:out:${WALLS_OUT}`, TENANT_ID, { storage_path: "handover/5.jpg" }),
      // Left out: not ready, unknown key, bad uuid, another collection.
      image(8, HO_OUT_COLLECTION, `eu-checklist:out:${WALLS_OUT}`, TENANT_ID, { status: "pending" }),
      image(9, HO_OUT_COLLECTION, `eu-checklist:out:${WALLS_OUT}`, TENANT_ID, { status: "deleted" }),
      image(10, HO_OUT_COLLECTION, "eu-checklist:out:property.detail.handover.moveOut.item.unknown", TENANT_ID),
      image(11, HO_OUT_COLLECTION, `eu-checklist-photo:out:not-a-uuid:${WALLS_OUT}`, TENANT_ID),
      image(12, GALLERY_COLLECTION, `eu-checklist:out:${WALLS_OUT}`, TENANT_ID),
    ],
  };
}
// Calendar per room (iOS #1600): one shared event for three rooms.
export const ROOM_EVENT_ID = "e9e9e9e9-e9e9-49e9-89e9-e9e9e9e9e9e9";
// iOS #1607: three shared events with requires_response true, false and null (older payload).
// No v2 room rows, so only the item's own flag decides whether a reply is asked for.
export const RR_TRUE_ID = "c7c7c7c7-0000-4000-8000-000000000001";
export const RR_FALSE_ID = "c7c7c7c7-0000-4000-8000-000000000002";
export const RR_NULL_ID = "c7c7c7c7-0000-4000-8000-000000000003";
export function requiresResponseTables() {
  const base = {
    property_id: PROPERTY_ID, tenancy_id: null, maintenance_request_id: null, description: null, item_type: "event",
    category: "other", due_at: null, ends_at: null, all_day: false, visibility: "tenant_shared", status: "active",
    tenant_response: null, tenant_response_comment: null, tenant_responded_at: null,
  };
  const items = [
    { ...base, id: RR_TRUE_ID, title: "Røykvarslertest", starts_at: "2026-11-21T09:00:00Z", requires_response: true },
    { ...base, id: RR_FALSE_ID, title: "Vannet stenges", starts_at: "2026-11-22T09:00:00Z", requires_response: false },
    { ...base, id: RR_NULL_ID, title: "Søppeltømming", starts_at: "2026-11-23T09:00:00Z", requires_response: null },
  ];
  const shared = readyToEndTables();
  return {
    ...shared,
    property_calendar_items: items,
    rpc: { ...shared.rpc, list_calendar_items_for_property: items, list_calendar_item_responses: [], list_calendar_item_responses_v2: [] },
  };
}

export function roomCalendarTables({ requiresResponse = true } = {}) {
  const item = {
    id: ROOM_EVENT_ID, property_id: PROPERTY_ID, tenancy_id: null, maintenance_request_id: null, title: "Felles vask",
    description: null, item_type: "event", category: "other", starts_at: "2026-11-20T09:00:00Z", due_at: null,
    ends_at: "2026-11-20T10:30:00Z", all_day: false, visibility: "tenant_shared", status: "active",
    tenant_response: "declined", tenant_response_comment: "Passer ikke", tenant_responded_at: "2026-11-10T10:00:00Z",
    requires_response: requiresResponse,
  };
  const counts = requiresResponse
    ? { accepted_count: 1, declined_count: 1, unanswered_count: 1, recipient_count: 3 }
    : { accepted_count: 0, declined_count: 0, unanswered_count: 0, recipient_count: 3 };
  const row = (n, decision, comment = null) => ({
    calendar_item_id: ROOM_EVENT_ID, tenancy_id: `a${n}a${n}a${n}a${n}-a${n}a${n}-4a${n}a-8a${n}a-a${n}a${n}a${n}a${n}a${n}a${n}`, unit_label: `Rom ${n}`,
    decision: requiresResponse ? decision : null, comment: requiresResponse ? comment : null, responded_at: null,
    ...counts, requires_response: requiresResponse, audience_restricted: false,
  });
  return {
    property_calendar_items: [item],
    rpc: {
      list_calendar_items_for_property: [item],
      list_calendar_item_responses: [{ calendar_item_id: ROOM_EVENT_ID, decision: "declined", comment: "Passer ikke", responded_at: "2026-11-10T10:00:00Z" }],
      list_calendar_item_responses_v2: [row(2, "declined", "Passer ikke"), row(1, "accepted"), row(3, null)],
    },
  };
}

// «Klar til å avslutte» (iOS #1597): ready tenancies on one property, shared or regular.
export const READY_A = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
export const READY_B = "a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2";
export const READY_C = "a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3";
export const READY_PROCESS_A = "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1";
export const READY_PROCESS_B = "b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2";
export function readyToEndTables({ housingKind = "shared", count = 3 } = {}) {
  const ids = [READY_A, READY_B, READY_C].slice(0, count);
  const tenancy = (id, n) => ({ id, property_id: PROPERTY_ID, unit_id: `c${n}c${n}c${n}c${n}-c${n}c${n}-4c${n}c-8c${n}c-c${n}c${n}c${n}c${n}c${n}c${n}`, status: "active", start_date: "2025-01-01", end_date: null, archived_at: null });
  const tenancies = ids.map((id, i) => tenancy(id, i + 1));
  const member = (n, tenancyId, userId) => ({ id: `d${n}d${n}d${n}d${n}-0000-4000-8000-00000000000${n}`, tenancy_id: tenancyId, user_id: userId, role: "tenant", invitation_status: "accepted", valid_until: null });
  const process = (id, tenancyId, state) => ({ id, tenancy_id: tenancyId, property_id: PROPERTY_ID, scope: housingKind === "shared" ? "one_room" : "whole_tenancy", subject_member_id: null, move_out_on: "2026-10-01", notice_party: "tenant", state, inspection_id: null, notice_given_at: "2026-08-01T10:00:00Z" });
  return {
    properties: properties.map((p) => (p.id === PROPERTY_ID ? { ...p, housing_kind: housingKind } : p)),
    tenancies,
    property_units: tenancies.map((t, i) => ({ id: t.unit_id, property_id: PROPERTY_ID, kind: "room", display_label: `Rom ${i + 1}`, operational_status: "active" })),
    tenancy_members: [
      member(1, READY_A, "e1e1e1e1-0000-4000-8000-000000000001"),
      member(2, READY_A, "e1e1e1e1-0000-4000-8000-000000000002"),
      member(3, READY_B, "e1e1e1e1-0000-4000-8000-000000000003"),
    ].filter((m) => ids.includes(m.tenancy_id)),
    move_out_processes: [
      process(READY_PROCESS_A, READY_A, "deposit"),
      process(READY_PROCESS_B, READY_B, "approved"),
      process("b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3", READY_C, "notice_given"),
    ].filter((p) => ids.includes(p.tenancy_id)),
    deposit_settlements: [{ id: "f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1", status: "accepted", tenancy_id: READY_A, move_out_inspection_id: null, created_at: "2026-10-02T10:00:00Z" }],
    rpc: {
      list_linked_profile_contacts: [
        { user_id: "e1e1e1e1-0000-4000-8000-000000000001", display_name: "Kari Nordmann", email: "kari.n@example.com" },
        { user_id: "e1e1e1e1-0000-4000-8000-000000000002", display_name: "Ola Nordmann", email: "ola.n@example.com" },
        // A national identity number stored as a name is never shown.
        { user_id: "e1e1e1e1-0000-4000-8000-000000000003", display_name: "12345678901", email: null },
      ],
    },
  };
}
// A 1×1 PNG; each path gets its own trailing bytes so the data URLs differ.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
export const handoverImageBytes = (path) => Buffer.concat([PNG, Buffer.from(path)]);

const conversation = {
  conversation_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  property_id: PROPERTY_ID,
  tenancy_id: TENANCY_ID,
  role_snapshot: "landlord",
  is_property_chat: false,
  conversation_status: "active",
  is_writable: true,
  unread_count: 0,
  counterpart_avatars: [],
  member_id: "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm",
  property_display_name: "Testveien 1",
  unit_display_label: "H0101",
};

function cors(req) {
  return {
    "access-control-allow-origin": req.headers().origin || "http://127.0.0.1:4173",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": req.headers()["access-control-request-headers"] || "apikey,authorization,content-type,prefer,accept,x-client-info",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS",
    "access-control-expose-headers": "content-range",
  };
}

function matches(row, url) {
  for (const [key, value] of url.searchParams) {
    if (["select", "order", "limit", "offset", "or"].includes(key)) continue;
    if (value.startsWith("eq.") && String(row[key]) !== value.slice(3)) return false;
    if (value === "is.null" && row[key] != null) return false;
    if (value === "not.is.null" && row[key] == null) return false;
    if (value.startsWith("gte.") && String(row[key] ?? "") < value.slice(4)) return false;
    if (value.startsWith("lte.") && String(row[key] ?? "") > value.slice(4)) return false;
    if (value.startsWith("in.(")) {
      const list = value.slice(4, -1).split(",").map((part) => part.trim());
      if (!list.includes(String(row[key]))) return false;
    }
  }
  return true;
}

function rpcPayload(name, body, options = {}) {
  if (options.handover?.rpc && Object.prototype.hasOwnProperty.call(options.handover.rpc, name)) return options.handover.rpc[name];
  const premium = options.premium;
  const offset = Number(body?.requested_offset ?? 0);
  if (offset > 0) return [];
  const pid = body?.requested_property_id;
  switch (name) {
    case "get_my_complimentary_access":
      return false;
    case "get_property_home_guide_completed":
      return true;
    case "open_deposit_settlement":
      if (!options.handover) return [];
      return { id: options.handover.deposit_settlements[0].id, status: options.handover.deposit_settlements[0].status, deposit_amount_minor: 3_000_000, security_type: "deposit", claims: [] };
    case "list_managed_property_rental_tax_facts":
      return (options.taxFacts ?? []).filter((f) => (body?.requested_property_ids ?? []).includes(f.property_id));
    case "list_calendar_items_for_property":
      return pid === PROPERTY_ID ? [calendarItem] : [];
    case "list_my_property_rental_agreements":
      return pid === PROPERTY_ID ? [{ ...agreement, agreement_status: options.signedAgreement ? "signed" : agreement.agreement_status }] : [];
    case "list_rental_agreement_changes":
      return options.signedAgreement ? [{
        id: "c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1",
        agreement_id: agreement.agreement_id,
        request_kind: "revision",
        status: "completed",
        replacement_agreement_id: null,
        can_respond: false,
      }] : [];
    case "list_tenancy_history":
      return pid === PROPERTY_ID ? [historyEntry] : [];
    case "list_my_chat_conversations_v2":
    case "list_my_chat_conversations": {
      const second = { ...conversation, conversation_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
      const rows = options.omitAvatars ? [conversation, second] : [conversation];
      if (!options.omitAvatars) return rows;
      return rows.map((row) => {
        const copy = { ...row };
        delete copy.counterpart_avatars;
        return copy;
      });
    }
    case "list_chat_counterpart_avatars":
      return [{ user_id: TENANT_ID, avatar_revision: 1 }];
    case "send_chat_message":
      return [{
        id: "99999999-9999-4999-8999-999999999999",
        conversation_id: body?.requested_conversation_id,
        body: body?.requested_body,
        sequence_no: 1,
        sender_user_id: USER_ID,
        created_at: "2026-11-09T12:00:00Z",
      }];
    case "list_linked_profile_contacts":
      return [{ user_id: TENANT_ID, display_name: "Ola Leietaker", email: "ola@example.com" }];
    default:
      if (premium === false && name === "get_my_complimentary_access") return false;
      return [];
  }
}

function json(status, value) {
  return { status, body: JSON.stringify(value) };
}

function respond(url, req, body, options) {
  const fail = options.fail ?? new Set();
  const errorOn = options.errorOn ?? new Set();
  if (url.pathname.startsWith("/auth/v1/")) {
    if (url.pathname.endsWith("/logout")) return { status: 204, body: "" };
    if (url.pathname.endsWith("/token") && url.searchParams.get("grant_type") === "password" && options.abortPassword) {
      return { abort: true };
    }
    if (url.pathname.endsWith("/token") && url.searchParams.get("grant_type") === "password" && options.invalidPassword) {
      return json(400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials", message: "Invalid login credentials" });
    }
    if (url.pathname.endsWith("/user")) return json(200, sessionFor().user);
    return json(200, sessionFor());
  }
  if (url.pathname.includes("/functions/v1/contract-pdf")) {
    return json(200, { pdf_base64: PDF, filename: "utkast.pdf" });
  }
  if (url.pathname.includes("/functions/v1/mileage-route") && options.mileageRoute) {
    const r = typeof options.mileageRoute === "function" ? options.mileageRoute(body) : options.mileageRoute;
    return json(r.status ?? 200, r.body);
  }
  if (url.pathname.includes("/functions/v1/")) return json(200, { ok: true });
  if (options.handover && url.pathname.includes("/storage/v1/object/") && url.pathname.includes("/property-images/handover/")) {
    const path = decodeURIComponent(url.pathname.split("/property-images/")[1]);
    return { status: 200, contentType: "image/png", body: handoverImageBytes(path) };
  }
  if (url.pathname.includes("/storage/")) return json(404, { message: "not found", statusCode: "404" });
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const name = decodeURIComponent(url.pathname.split("/").pop());
    if (options.missingRpc?.includes(name)) {
      return json(404, { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache`, details: null, hint: null });
    }
    if (fail.has(name) || errorOn.has(name)) {
      return json(400, { message: "duplicate key value violates unique constraint \"property_handbook_sections_pkey\"", code: "23505" });
    }
    return json(200, rpcPayload(name, body, options));
  }
  if (url.pathname.startsWith("/rest/v1/")) {
    const table = decodeURIComponent(url.pathname.slice("/rest/v1/".length));
    if (fail.has(table)) return json(400, { message: "forced failure", code: "XX000" });
    if (errorOn.has(table)) {
      return json(400, { message: "duplicate key value violates unique constraint \"property_handbook_sections_pkey\"", code: "23505" });
    }
    if (req.method() === "PATCH" || req.method() === "DELETE") return { status: 204, body: "" };
    if (req.method() === "POST" && table === "properties" && options.propertyCreateError) {
      return json(400, { message: options.propertyCreateError, code: "P0001" });
    }
    if (req.method() === "POST") return json(201, Array.isArray(body) ? body : [body]);
    const supplied = options.gallery && (table === "image_collections" || table === "property_images");
    const known = Object.prototype.hasOwnProperty.call(tables, table) || supplied;
    let source = known && tables[table] ? tables[table] : [];
    if (options.gallery && table === "image_collections") {
      source = [{ id: GALLERY_COLLECTION, property_id: PROPERTY_ID, kind: "general", status: "active" }];
    }
    if (options.gallery && table === "property_images") source = galleryImageRows();
    if (options.handover && Object.prototype.hasOwnProperty.call(options.handover, table)) source = options.handover[table];
    let rows = source.filter((row) => matches(row, url));
    if (options.premium === false && table === "subscription_entitlements") rows = [];
    const wantsObject = (req.headers().accept || "").includes("vnd.pgrst.object");
    if (wantsObject) {
      if (rows.length !== 1) {
        return json(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      }
      return json(200, rows[0]);
    }
    return { ...json(200, rows), unmocked: known ? null : `table ${table}` };
  }
  return { ...json(404, { message: "unmocked" }), unmocked: url.pathname };
}

export async function installSupabase(page, options = {}) {
  const writes = options.writes ?? [];
  const fail = new Set(options.fail ?? []);
  const errorOn = new Set(options.errorOn ?? []);
  const seen = new Set();
  if (options.session !== false) {
    await page.addInitScript((session) => {
      localStorage.setItem("sb-jfrorhixjsuomwtjwqla-auth-token", JSON.stringify(session));
    }, sessionFor());
  }
  await page.routeWebSocket(HOST, (socket) => socket.close());
  await page.route(HOST, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors(req) });
      return;
    }
    let body = null;
    const raw = req.postData();
    if (raw) {
      try { body = JSON.parse(raw); } catch { body = raw; }
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method())) writes.push({ method: req.method(), path: url.pathname, body });
    const result = respond(url, req, body, {
      fail, errorOn, invalidPassword: options.invalidPassword, abortPassword: options.abortPassword,
      premium: options.premium, propertyCreateError: options.propertyCreateError, signedAgreement: options.signedAgreement, omitAvatars: options.omitAvatars, gallery: options.gallery, taxFacts: options.taxFacts, handover: options.handover, missingRpc: options.missingRpc, mileageRoute: options.mileageRoute,
    });
    if (options.requests) options.requests.push({
      method: req.method(), path: url.pathname, select: url.searchParams.get("select"),
      scope: body?.requested_role_scope ?? null,
    });
    if (result.abort) {
      await route.abort("failed");
      return;
    }
    if (result.unmocked && !seen.has(result.unmocked)) {
      seen.add(result.unmocked);
      console.log(`UNMOCKED ${result.unmocked}`);
    }
    const galleryFile = url.pathname.includes("/storage/v1/object/property-images/");
    if (galleryFile && options.stats) {
      options.stats.inflight = (options.stats.inflight ?? 0) + 1;
      options.stats.maxPropertyImages = Math.max(options.stats.maxPropertyImages ?? 0, options.stats.inflight);
    }
    const delay = options.delayRpc?.[decodeURIComponent(url.pathname.split("/").pop())] ?? (galleryFile ? options.delayStorage : 0);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (galleryFile && options.stats) options.stats.inflight -= 1;
    await route.fulfill({
      status: result.status,
      contentType: result.contentType ?? "application/json",
      headers: cors(req),
      body: result.body,
    });
  });
  return writes;
}
