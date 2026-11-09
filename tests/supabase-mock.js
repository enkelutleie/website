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

function rpcPayload(name, body, premium) {
  const offset = Number(body?.requested_offset ?? 0);
  if (offset > 0) return [];
  const pid = body?.requested_property_id;
  switch (name) {
    case "get_my_complimentary_access":
      return false;
    case "get_property_home_guide_completed":
      return true;
    case "list_calendar_items_for_property":
      return pid === PROPERTY_ID ? [calendarItem] : [];
    case "list_my_property_rental_agreements":
      return pid === PROPERTY_ID ? [agreement] : [];
    case "list_tenancy_history":
      return pid === PROPERTY_ID ? [historyEntry] : [];
    case "list_my_chat_conversations_v2":
    case "list_my_chat_conversations":
      return [conversation];
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
    if (url.pathname.endsWith("/token") && url.searchParams.get("grant_type") === "password" && options.invalidPassword) {
      return json(400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials", message: "Invalid login credentials" });
    }
    if (url.pathname.endsWith("/user")) return json(200, sessionFor().user);
    return json(200, sessionFor());
  }
  if (url.pathname.includes("/functions/v1/contract-pdf")) {
    return json(200, { pdf_base64: PDF, filename: "utkast.pdf" });
  }
  if (url.pathname.includes("/functions/v1/")) return json(200, { ok: true });
  if (url.pathname.includes("/storage/")) return json(404, { message: "not found", statusCode: "404" });
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const name = decodeURIComponent(url.pathname.split("/").pop());
    if (fail.has(name) || errorOn.has(name)) {
      return json(400, { message: "duplicate key value violates unique constraint \"property_handbook_sections_pkey\"", code: "23505" });
    }
    return json(200, rpcPayload(name, body, options.premium));
  }
  if (url.pathname.startsWith("/rest/v1/")) {
    const table = decodeURIComponent(url.pathname.slice("/rest/v1/".length));
    if (fail.has(table)) return json(400, { message: "forced failure", code: "XX000" });
    if (errorOn.has(table)) {
      return json(400, { message: "duplicate key value violates unique constraint \"property_handbook_sections_pkey\"", code: "23505" });
    }
    if (req.method() === "PATCH" || req.method() === "DELETE") return { status: 204, body: "" };
    if (req.method() === "POST") return json(201, Array.isArray(body) ? body : [body]);
    const known = Object.prototype.hasOwnProperty.call(tables, table);
    let rows = known ? tables[table].filter((row) => matches(row, url)) : [];
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
    const result = respond(url, req, body, { fail, errorOn, invalidPassword: options.invalidPassword, premium: options.premium });
    if (result.unmocked && !seen.has(result.unmocked)) {
      seen.add(result.unmocked);
      console.log(`UNMOCKED ${result.unmocked}`);
    }
    await route.fulfill({
      status: result.status,
      contentType: "application/json",
      headers: cors(req),
      body: result.body,
    });
  });
  return writes;
}
