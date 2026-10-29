import { supabase } from "./supabase.js";

// Write actions for the portal. Every call mirrors the iOS app (same RPCs,
// edge functions, tables, buckets and enum values) and runs with the user's own
// session, so RLS and the RPCs decide what is allowed.

/* ---------- UI primitives: modal form + confirm ---------- */
const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

export const explain = (error) => {
  const msg = String(error?.message || error?.context?.statusText || "");
  if (/jwt|auth|401/i.test(msg)) return "Økten er utløpt. Logg inn på nytt.";
  if (/permission|not_authorized|unauthorized|42501|403/i.test(msg)) return "Du har ikke tilgang til å gjøre dette.";
  if (/conflict|stale|expected_updated_at|revision/i.test(msg)) return "Noen har endret dette i mellomtiden. Last siden på nytt og prøv igjen.";
  return msg ? `Det gikk ikke: ${msg}` : "Det gikk ikke. Prøv igjen om litt.";
};

export const minorOf = (text) => {
  const clean = String(text ?? "").replace(/\s|kr/gi, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
};
export const kronerOf = (minor) => (minor == null ? "" : (Number(minor) / 100).toFixed(2).replace(".", ","));

/**
 * fields: [{ name, label, type: text|number|money|date|datetime|select|textarea|file|email,
 *            options: [[value,label]], value, required, help, placeholder, accept, maxLength, min, max }]
 * sections: nodes shown above the fields. footer(close): node below the buttons.
 * submitClass replaces the primary style (e.g. "pt-btn-destructive"); submitDisabled locks it.
 * onSubmit(values, form) -> string error | null | undefined
 */
export function openForm({ title, intro, fields, submitLabel = "Lagre", onSubmit, onChange, sections = [], footer, submitClass = "pt-btn-primary", submitDisabled = false }) {
  return new Promise((resolve) => {
    const dialog = h("dialog", "pt-modal");
    const form = h("form", "pt-modal-card");
    form.noValidate = true;
    const head = h("div", "pt-card-head");
    head.append(h("h2", null, title));
    form.append(head);
    if (intro) form.append(h("p", "pt-muted", intro));
    form.append(...sections);
    const body = h("div", "pt-form");
    const inputs = {};
    for (const f of fields) {
      const wrap = h("label", "pt-field");
      wrap.dataset.field = f.name;
      wrap.append(h("span", "pt-field-label", f.label + (f.required ? "" : " (valgfritt)")));
      let input;
      if (f.type === "select") {
        input = h("select", "pt-select");
        for (const [v, l] of f.options ?? []) {
          const o = h("option", null, l);
          o.value = v;
          input.append(o);
        }
      } else if (f.type === "textarea") {
        input = h("textarea", "pt-input pt-textarea");
        input.rows = f.rows ?? 5;
      } else {
        input = h("input", "pt-input");
        input.type = { money: "text", datetime: "datetime-local" }[f.type] ?? f.type ?? "text";
        if (f.type === "money") input.inputMode = "decimal";
        if (f.accept) input.accept = f.accept;
        if (f.min != null) input.min = f.min;
        if (f.max != null) input.max = f.max;
      }
      input.name = f.name;
      if (f.maxLength) input.maxLength = f.maxLength;
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.value != null && f.type !== "file") input.value = f.value;
      inputs[f.name] = input;
      wrap.append(input);
      if (f.help) wrap.append(h("span", "pt-field-help", f.help));
      if (f.hidden) wrap.hidden = true;
      body.append(wrap);
    }
    form.append(body);
    const status = h("p", "pt-form-error");
    status.setAttribute("role", "alert");
    status.hidden = true;
    const actions = h("div", "pt-modal-actions");
    const cancel = h("button", "pt-btn pt-btn-secondary", "Avbryt");
    cancel.type = "button";
    const submit = h("button", `pt-btn ${submitClass}`, submitLabel);
    submit.type = "submit";
    submit.disabled = submitDisabled;
    actions.append(cancel, submit);
    form.append(status, actions);
    dialog.append(form);
    document.body.append(dialog);

    const show = (field, on) => {
      const el = form.querySelector(`[data-field="${field}"]`);
      if (el) el.hidden = !on;
    };
    const close = (result) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    if (footer) form.append(footer(() => close(false)));
    cancel.addEventListener("click", () => close(false));
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      if (!cancel.disabled) close(false);
    });
    form.addEventListener("input", () => onChange?.(inputs, show));
    onChange?.(inputs, show);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.hidden = true;
      const values = {};
      for (const f of fields) {
        const input = inputs[f.name];
        const hidden = input.closest(".pt-field").hidden;
        values[f.name] = f.type === "file" ? input.files?.[0] ?? null : input.value.trim();
        if (f.required && !hidden && !values[f.name]) {
          status.textContent = `Fyll ut «${f.label}».`;
          status.hidden = false;
          input.focus();
          return;
        }
      }
      submit.disabled = true;
      cancel.disabled = true;
      submit.textContent = "Lagrer …";
      let error;
      try {
        error = await onSubmit(values, inputs);
      } catch (err) {
        error = explain(err);
      }
      submit.disabled = submitDisabled;
      cancel.disabled = false;
      submit.textContent = submitLabel;
      if (error) {
        status.textContent = error;
        status.hidden = false;
        return;
      }
      close(true);
    });
    dialog.showModal();
    form.querySelector("input, select, textarea")?.focus();
  });
}

export function confirmAction({ title, text, confirmLabel, destructive = true }) {
  return new Promise((resolve) => {
    const dialog = h("dialog", "pt-modal");
    const card = h("div", "pt-modal-card");
    const head = h("div", "pt-card-head");
    head.append(h("h2", null, title));
    card.append(head, h("p", "pt-muted", text));
    const actions = h("div", "pt-modal-actions");
    const cancel = h("button", "pt-btn pt-btn-secondary", "Avbryt");
    const ok = h("button", `pt-btn ${destructive ? "pt-btn-destructive" : "pt-btn-primary"}`, confirmLabel);
    cancel.type = ok.type = "button";
    actions.append(cancel, ok);
    card.append(actions);
    dialog.append(card);
    document.body.append(dialog);
    const done = (v) => {
      dialog.close();
      dialog.remove();
      resolve(v);
    };
    cancel.addEventListener("click", () => done(false));
    ok.addEventListener("click", () => done(true));
    dialog.addEventListener("cancel", () => done(false));
    dialog.showModal();
    cancel.focus();
  });
}

export function toast(text) {
  const el = h("p", "pt-toast", text);
  el.setAttribute("role", "status");
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

const first = (data) => (Array.isArray(data) ? data[0] : data);

/* ---------- Økonomi (EconomyController.swift) ---------- */
export const INCOME_CATEGORIES = [["rent", "Husleie"], ["reimbursement", "Refusjon"], ["other_income", "Annen inntekt"]];
export const EXPENSE_CATEGORIES = [["other_expense", "Utgift"], ["improvement", "Påkostning"], ["furnishings_equipment", "Møbler og inventar"]];
export const RECURRENCE = [["monthly", "Hver måned"], ["weekly", "Hver uke"], ["yearly", "Hvert år"]];

export async function createTransaction(propertyId, v, activeTenancyId) {
  const payload = {
    requested_property_id: propertyId,
    requested_transaction_type: v.type,
    requested_category: v.category,
    requested_amount_minor: v.amountMinor,
    requested_currency_code: "NOK",
    requested_transaction_date: v.date,
    requested_description: v.description || null,
    requested_counterparty: v.counterparty || null,
    requested_maintenance_request_id: null,
    requested_client_request_id: crypto.randomUUID(),
    requested_economy_treatment: "ordinary",
  };
  if (v.type === "income" && v.category === "rent" && activeTenancyId) payload.requested_tenancy_id = activeTenancyId;
  if (v.recurrence !== "none") {
    payload.requested_frequency = v.recurrence;
    payload.requested_day_of_month = v.recurrence === "monthly" ? Number(v.date.slice(8, 10)) : null;
  }
  return supabase.rpc(v.recurrence === "none" ? "create_financial_transaction" : "create_recurring_financial_transaction", payload);
}

export const updateTransaction = (row, v) =>
  supabase.rpc("update_financial_transaction", {
    requested_transaction_id: row.id,
    requested_expected_updated_at: row.updated_at,
    requested_transaction_type: v.type,
    requested_category: v.category,
    requested_amount_minor: v.amountMinor,
    requested_currency_code: "NOK",
    requested_transaction_date: v.date,
    requested_description: v.description || null,
    requested_counterparty: v.counterparty || null,
    requested_maintenance_request_id: row.maintenance_request_id ?? null,
  });

export const voidTransaction = (id) => supabase.rpc("void_financial_transaction", { requested_transaction_id: id });

/* ---------- Boliger (PropertyListController.swift / RentalProperty.swift) ---------- */
export const HOUSING_KINDS = [["standard", "Hel bolig"], ["rental_unit", "Utleiedel / hybel"]];
export const RENTAL_USE = [
  ["other_home", "Utleie av annen bolig (langtid)"],
  ["own_home", "Del av egen bolig (langtid)"],
  ["holiday_home", "Fritidsbolig"],
];

export const validateProperty = (v) => {
  if (!v.address || v.address.length > 160) return "Adressen må fylles ut (maks 160 tegn).";
  if ((v.unit ?? "").length > 30) return "Enhet kan være maks 30 tegn.";
  if (!/^\d{4}$/.test(v.postal)) return "Postnummeret må være fire siffer.";
  if (!v.city || v.city.length > 100) return "Poststed må fylles ut (maks 100 tegn).";
  if (v.finn && !/^\d{6,12}$/.test(v.finn.replace(/\D/g, ""))) return "Finn-koden skal bare være tall.";
  return null;
};
const profileOf = (use, existing) => ({
  landlord_kind: existing?.landlord_kind ?? "individual",
  legal_form: existing?.legal_form ?? null,
  business_name: existing?.business_name ?? "",
  organization_number: existing?.organization_number ?? "",
  home_use: use,
  rental_duration: existing?.rental_duration && existing.rental_duration !== "unknown" ? existing.rental_duration : "long_term",
});
const finnOf = (raw) => (raw ? raw.replace(/\D/g, "") || null : null);

export async function createProperty(ownerId, v) {
  return supabase.from("properties").insert({
    owner_id: ownerId,
    address_line1: v.address,
    ...(v.unit ? { unit_identifier: v.unit } : {}),
    postal_code: v.postal,
    city: v.city,
    country_code: "NO",
    housing_kind: v.housingKind,
    rental_profile: profileOf(v.use),
    ...(finnOf(v.finn) ? { finn_code: finnOf(v.finn) } : {}),
  }).select("id");
}

export const updateProperty = (p, v) =>
  supabase.from("properties").update({
    address_line1: v.address,
    unit_identifier: v.unit || null,
    postal_code: v.postal,
    city: v.city,
    housing_kind: p.housing_kind,
    rental_profile: profileOf(v.use, p.rental_profile),
    finn_code: finnOf(v.finn),
    payment_account_override: (v.account ?? "").replace(/\D/g, "") || null,
    municipality_number: null,
    municipality_name: null,
  }).eq("id", p.id);

/* ---------- Arkiver bolig (LifecycleB1Controller.swift) ---------- */
// The same SECURITY DEFINER RPCs as the app. There is no hard delete: a closed
// property is archived and keeps its history, documents and economy.
export const CLOSE_REASONS = [
  ["management_ended", "Forvaltningen er avsluttet"],
  ["no_longer_rented", "Boligen skal ikke lenger leies ut"],
  ["property_sold", "Boligen er solgt"],
  ["other_operational", "Annen driftsmessig årsak"],
];
const CLOSE_BLOCKER_CODES = ["not_active", "property_inactive", "non_terminal_tenancy_blocker", "pending_tenant_invitation_blocker", "unfinished_file_operation_blocker"];

export async function inspectPropertyClose(propertyId) {
  const { data, error } = await supabase.rpc("inspect_property_close", { requested_property_id: propertyId });
  if (error) return { error };
  const row = first(data);
  return row ? { data: row } : { error: new Error("empty") };
}

export const closeBlockers = (i) => {
  const n = (k) => Number(i?.[k] ?? 0);
  const files = n("pending_document_operation_count") + n("deleting_document_operation_count") + n("pending_image_operation_count") + n("deleting_image_operation_count");
  const list = [];
  if (n("active_tenancy_count")) list.push(`${n("active_tenancy_count")} aktivt leieforhold må avsluttes først.`);
  if (n("draft_tenancy_count") + n("invited_tenancy_count")) list.push(`${n("draft_tenancy_count") + n("invited_tenancy_count")} utkast eller invitert leieforhold må kanselleres først.`);
  if (n("pending_tenant_invitation_count")) list.push("Ventende invitasjoner må avsluttes først.");
  if (files) list.push(`${files} filoperasjon pågår fortsatt.`);
  return list;
};

export async function closeProperty(propertyId, reason, operationId) {
  const { data, error } = await supabase.rpc("close_property", {
    requested_property_id: propertyId,
    requested_reason_code: reason,
    requested_operation_id: operationId,
  });
  if (!error && first(data)?.property_id) return { ok: true };
  const msg = String(error?.message ?? "");
  if (CLOSE_BLOCKER_CODES.some((c) => msg.includes(c))) {
    return { message: "Boligen eller en blocker ble endret et annet sted. Kontroller den oppdaterte oversikten før du prøver igjen." };
  }
  if (error && /jwt|auth|401/i.test(msg)) return { message: explain(error) };
  return { message: "Boligen kunne ikke avsluttes. Ingen delvis endring ble lagret. Prøv igjen." };
}

export const listClosedProperties = () => supabase.rpc("list_my_closed_property_summaries");

/* ---------- Bilder (ImageController.swift, image-lifecycle) ---------- */
const dataUrlOf = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Filen kunne ikke leses."));
    reader.readAsDataURL(blob);
  });

const toJpeg = (file) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 2560;
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("jpeg"))), "image/jpeg", 0.85);
    };
    img.onerror = () => reject(new Error("Bildet kunne ikke leses."));
    // CSP allows data: images only (img-src 'self' data:), so no blob: URLs.
    dataUrlOf(file).then((url) => { img.src = url; }, reject);
  });

const imageLifecycle = async (body) => {
  const { data, error } = await supabase.functions.invoke("image-lifecycle", { body });
  if (error) {
    try {
      const parsed = await error.context?.json?.();
      if (parsed?.outcome) return parsed;
    } catch { /* ignore */ }
    throw error;
  }
  return data;
};

export async function uploadPropertyPhoto(propertyId, userId, file) {
  const jpeg = await toJpeg(file);
  if (jpeg.size > 12_000_000) return "Velg et bilde på maksimalt 12 MB.";
  let { data: collections, error } = await supabase.from("image_collections")
    .select("id, kind, status").eq("property_id", propertyId).order("created_at", { ascending: true });
  if (error) return explain(error);
  let gallery = (collections ?? []).find((c) => c.kind === "general" && c.status === "active");
  if (!gallery) {
    // Insert without RETURNING, then read back, as the app does (ImageController.ensureGalleryCollection).
    // insert().select() is rejected by RLS on the returned row (42501) even though the insert is allowed.
    const created = await supabase.from("image_collections").insert({
      property_id: propertyId, tenancy_id: null, kind: "general", title: "Boligbilder", created_by: userId,
    });
    if (created.error) return explain(created.error);
    const reread = await supabase.from("image_collections")
      .select("id, kind, status").eq("property_id", propertyId).order("created_at", { ascending: true });
    if (reread.error) return explain(reread.error);
    gallery = (reread.data ?? []).find((c) => c.kind === "general" && c.status === "active");
    if (!gallery) return "Bildealbumet kunne ikke opprettes. Prøv igjen.";
  }
  const reservation = await imageLifecycle({
    action: "reserve", property_id: propertyId, collection_id: gallery.id,
    reservation_key: crypto.randomUUID(), caption: null,
  });
  if (reservation?.outcome === "already_ready") return null;
  if (!["reserved", "already_reserved"].includes(reservation?.outcome) || !reservation.storage_path || !reservation.image_id) {
    return "Bildet kunne ikke klargjøres for opplasting. Prøv igjen.";
  }
  const up = await supabase.storage.from("property-images").upload(reservation.storage_path, jpeg, {
    cacheControl: "0", contentType: "image/jpeg", upsert: false,
  });
  if (up.error && !/exists|duplicate/i.test(up.error.message)) return "Bildet kunne ikke lastes opp. Prøv igjen.";
  const fin = await imageLifecycle({ action: "finalize", image_id: reservation.image_id });
  return fin?.outcome && !/fail|error|invalid/i.test(fin.outcome) ? null : "Bildet ble lastet opp, men kunne ikke ferdigstilles. Prøv igjen.";
}

export async function coverPhotoUrl(propertyId) {
  const { data } = await supabase.from("property_images").select("storage_path, status, created_at")
    .eq("property_id", propertyId).eq("status", "ready").order("created_at", { ascending: false }).limit(1);
  const path = first(data)?.storage_path;
  if (!path) return null;
  const file = await supabase.storage.from("property-images").download(path);
  return file.error ? null : dataUrlOf(file.data);
}

/* ---------- Leieforhold (TenancyController.swift) ---------- */
const sendInvitation = (invitationId) =>
  supabase.functions.invoke("send-tenancy-invitation", {
    body: { invitation_id: invitationId, request_id: crypto.randomUUID(), action: "send" },
  });

// CreateTenancyInvitationPayload: only property, e-mail and (for shared housing) the room.
// The lease terms are set later in the contract, as in the app.
export async function inviteNewTenancy(propertyId, email, unitId) {
  const payload = { requested_property_id: propertyId, requested_tenant_email: email.trim().toLowerCase() };
  if (unitId) payload.requested_unit_id = unitId;
  const { data, error } = await supabase.rpc(unitId ? "create_tenancy_invitation_for_unit" : "create_tenancy_invitation", payload);
  if (error) return { error };
  const id = first(data)?.invitation_id;
  const sent = id ? await sendInvitation(id) : { error: true };
  return { sent: !sent.error };
}

export async function inviteToExisting(tenancyId, email) {
  const { data, error } = await supabase.rpc("invite_tenant_to_existing_tenancy", {
    requested_tenancy_id: tenancyId, requested_tenant_email: email.trim().toLowerCase(),
  });
  if (error) return { error };
  const id = first(data)?.invitation_id;
  const sent = id ? await sendInvitation(id) : { error: true };
  return { sent: !sent.error };
}

// TenancyInvitationUnitPicker: active rooms, each marked when it already has a tenancy.
export async function invitableRooms(propertyId) {
  const [units, tenancies] = await Promise.all([
    supabase.from("property_units").select("id, property_id, kind, display_label, operational_status").eq("property_id", propertyId),
    supabase.from("tenancies").select("unit_id, status").eq("property_id", propertyId).in("status", ["draft", "invited", "active"]).is("archived_at", null),
  ]);
  if (units.error || tenancies.error) return { error: units.error ?? tenancies.error };
  const blocked = new Map();
  for (const t of tenancies.data ?? []) {
    if (!t.unit_id) continue;
    if (t.status === "active") blocked.set(t.unit_id, "Har et aktivt leieforhold");
    else if (!blocked.has(t.unit_id)) blocked.set(t.unit_id, "Har en ventende invitasjon");
  }
  const rooms = (units.data ?? [])
    .filter((u) => u.kind === "room" && u.operational_status === "active")
    .sort((a, b) => (a.display_label ?? "").localeCompare(b.display_label ?? "", "nb", { numeric: true }))
    .map((u) => ({ id: u.id, label: u.display_label || "Rom", blocked: blocked.get(u.id) ?? null }));
  return { data: rooms };
}

/* ---------- Navn (list_linked_profile_contacts, samme RPC som iOS) ---------- */
export async function linkedContactNames(userIds) {
  const names = new Map();
  const ids = [...new Set(userIds)].filter(Boolean);
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.rpc("list_linked_profile_contacts", { requested_user_ids: ids.slice(i, i + 100) });
    if (error) break;
    for (const c of data ?? []) {
      const name = c.display_name?.trim() || c.email?.trim() || null;
      if (name) names.set(c.user_id, name);
    }
  }
  return names;
}

/* ---------- Leiekontrakt (ContractSigningFoundation.swift, contract-pdf) ---------- */
export const listAgreements = (propertyId) =>
  supabase.rpc("list_my_property_rental_agreements", { requested_property_id: propertyId });

export async function createAgreementDraft(tenancy, v) {
  const [tm, pm] = await Promise.all([
    supabase.from("tenancy_members").select("user_id, role").eq("tenancy_id", tenancy.id).is("valid_until", null),
    supabase.from("property_members").select("user_id, role").eq("property_id", tenancy.property_id).is("valid_until", null),
  ]);
  if (tm.error || pm.error) return { error: tm.error || pm.error };
  const landlords = (pm.data ?? []).filter((m) => m.role === "owner" || m.role === "co_landlord").map((m) => m.user_id);
  const tenants = (tm.data ?? []).filter((m) => m.role === "tenant").map((m) => m.user_id);
  if (!tenants.length) return { message: "Leietakeren må ha godtatt invitasjonen før kontrakten kan lages." };
  const parties = [];
  for (const id of landlords) parties.push({ user_id: id, party_role: "landlord", required_to_sign: true, signing_order: parties.length + 1 });
  for (const id of tenants) parties.push({ user_id: id, party_role: "tenant", required_to_sign: true, signing_order: parties.length + 1 });
  // Draft terms are encodeIfPresent in the app: empty fields are left out.
  const digits = (v.account ?? "").replace(/\D/g, "");
  const terms = {
    lease_term_type: v.termType,
    ...(v.start ? { start_date: v.start } : {}),
    ...(v.termType === "fixed" && v.end ? { end_date: v.end } : {}),
    ...(v.rentMinor ? { rent_amount_minor: v.rentMinor } : {}),
    currency_code: "NOK",
    ...(v.payday ? { payment_day: Number(v.payday) } : {}),
    ...(v.depositMinor != null ? { deposit_amount_minor: v.depositMinor, security_type: v.depositMinor > 0 ? "deposit" : "none", security_amount_minor: v.depositMinor } : {}),
    ...(v.notice ? { notice_period_months: Number(v.notice) } : {}),
    included_services: [],
    additional_charges: [],
    ...(v.special ? { special_terms: v.special } : {}),
    ...(digits ? { payment_account: digits } : {}),
    // ContractTenancyKind: a bofellesskap is always shared_housing; otherwise left out.
    ...(v.housingKind === "shared" ? { tenancy_kind: "shared_housing" } : {}),
  };
  return supabase.rpc("create_rental_agreement_draft", {
    requested_tenancy_id: tenancy.id,
    requested_legal_rule_version: "pending_l1_l10",
    requested_language_code: "nb",
    requested_snapshot: { contract_schema_version: 1, terms },
    requested_parties: parties,
    requested_operation_id: crypto.randomUUID(),
  });
}

export const markAgreementReady = (a) =>
  supabase.rpc("mark_rental_agreement_ready_for_review", {
    requested_agreement_id: a.agreement_id,
    expected_version_id: a.current_version_id,
    expected_draft_revision: a.draft_revision,
  });

const PDF_OUTCOME_TEXT = {
  unauthenticated: "Økten er utløpt. Logg inn på nytt og prøv igjen.",
  forbidden: "Bare utleier kan hente PDF av dette utkastet.",
  version_conflict: "Kontrakten er endret eller har en status som ikke kan forhåndsvises. Last siden på nytt.",
  invalid_request: "Forespørselen om PDF var ugyldig. Last siden på nytt og prøv igjen.",
  template_unavailable: "Kontraktsmalen er ikke tilgjengelig akkurat nå.",
  temporary_failure: "PDF-tjenesten svarte ikke. Prøv igjen om litt.",
};

// contract-pdf with intent "preview" answers JSON { outcome: "preview", filename, pdf_base64 }
// (handler.mjs), allowed for agreements in draft or ready_for_review, as in the app.
export async function previewAgreementPdf(a) {
  const revision = Number(a.draft_revision);
  if (!a.agreement_id || !a.current_version_id || !Number.isSafeInteger(revision) || revision < 1) {
    return { message: "Kontrakten mangler versjon. Last siden på nytt." };
  }
  const { data, error } = await supabase.functions.invoke("contract-pdf", {
    body: { agreement_id: a.agreement_id, version_id: a.current_version_id, revision, intent: "preview" },
  });
  if (error) {
    let outcome = null;
    try { outcome = (await error.context?.json?.())?.outcome ?? null; } catch { /* no readable body */ }
    if (outcome) return { message: PDF_OUTCOME_TEXT[outcome] ?? "PDF-en kunne ikke lages akkurat nå." };
    // FunctionsFetchError: the browser blocked or lost the request (e.g. missing CORS headers on the function).
    if (error.name === "FunctionsFetchError" || error.name === "FunctionsRelayError") {
      return { message: "Nettleseren fikk ikke kontakt med PDF-tjenesten. PDF-en kan foreløpig hentes i appen." };
    }
    return { message: "PDF-en kunne ikke lages akkurat nå." };
  }
  const payload = typeof data === "string" ? (() => { try { return JSON.parse(data); } catch { return null; } })() : data;
  if (!payload?.pdf_base64) return { message: PDF_OUTCOME_TEXT[payload?.outcome] ?? "Tjenesten returnerte ingen PDF." };
  const binary = atob(payload.pdf_base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") return { message: "Tjenesten returnerte ikke en gyldig PDF." };
  return { url: URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), filename: payload.filename || "leiekontrakt.pdf" };
}

/* ---------- Kalender (CalendarController.swift) ---------- */
export const CALENDAR_CATEGORIES = [
  ["other", "Annet"], ["maintenance", "Vedlikehold"], ["inspection", "Befaring"],
  ["tenancy", "Leieforhold"], ["payment", "Betaling"], ["document", "Dokument"],
];
const iso = (local) => new Date(local).toISOString().replace(/\.\d{3}Z$/, "Z");
const calendarFields = (v) => {
  const when = v.allDay === "true" ? `${v.date}T00:00` : `${v.date}T${v.time || "09:00"}`;
  return {
    requested_title: v.title,
    requested_description: v.description || null,
    requested_item_type: v.kind,
    requested_category: v.category,
    requested_starts_at: v.kind === "event" ? iso(when) : null,
    requested_due_at: v.kind === "deadline" ? iso(when) : null,
    requested_ends_at: null,
    requested_all_day: v.allDay === "true",
  };
};
export const createCalendarItem = (propertyId, v) =>
  supabase.rpc("create_calendar_item", {
    requested_property_id: propertyId, requested_tenancy_id: null, requested_maintenance_request_id: null,
    ...calendarFields(v), requested_shared_with_property: true,
  });
export const updateCalendarItem = (id, v) =>
  supabase.rpc("update_calendar_item", { requested_calendar_item_id: id, ...calendarFields(v) });
export const cancelCalendarItem = (id) => supabase.rpc("cancel_calendar_item", { requested_calendar_item_id: id });
export const completeCalendarItem = (id) => supabase.rpc("complete_calendar_item", { requested_calendar_item_id: id });

/* ---------- Boligperm (PropertyHandbookController.swift) ---------- */
export const saveHandbookSection = (propertyId, key, body, enabled = true) =>
  supabase.from("property_handbook_sections").upsert(
    { property_id: propertyId, section_key: key, is_enabled: enabled, body, link_url: null },
    { onConflict: "property_id,section_key" },
  );

/* ---------- Premium (subscription_entitlements + get_my_complimentary_access) ---------- */
export async function hasPremium() {
  const [ent, comp] = await Promise.all([
    supabase.from("subscription_entitlements").select("status, expires_at, environment").eq("environment", "production"),
    supabase.rpc("get_my_complimentary_access"),
  ]);
  if (comp.data === true) return { ok: true };
  if (ent.error && comp.error) return { ok: false, unknown: true };
  const now = Date.now();
  const active = (ent.data ?? []).some((r) =>
    ["active", "grace", "canceled"].includes(r.status) && (!r.expires_at || new Date(r.expires_at).getTime() > now));
  return { ok: active };
}
