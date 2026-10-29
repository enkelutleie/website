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
 * sections: nodes shown above the fields; after: nodes below the fields. footer(close): node below the buttons.
 * submitClass replaces the primary style (e.g. "pt-btn-destructive"); submitDisabled locks it.
 * onSubmit(values, form) -> string error | null | undefined
 */
export function openForm({ title, intro, fields, submitLabel = "Lagre", onSubmit, onChange, sections = [], after = [], footer, submitClass = "pt-btn-primary", submitDisabled = false }) {
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
        if (f.multiple) input.multiple = true;
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
    form.append(body, ...after);
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
        values[f.name] = f.type === "file" ? (f.multiple ? [...(input.files ?? [])] : input.files?.[0] ?? null) : input.value.trim();
        if (f.required && !hidden && !values[f.name]) {
          status.textContent = f.requiredMessage ?? `Fyll ut «${f.label}».`;
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
// Picker choices in the app's order (#1511). «Uten kategori» is not an income choice.
export const INCOME_CATEGORIES = [
  ["rent", "Husleie"], ["electricity_heating_income", "Strøm og oppvarming"], ["parking", "Parkering"],
  ["additional_rent", "Tilleggsleie"], ["reimbursement", "Refusjon"], ["other_income", "Annen inntekt"],
];
export const INCOME_CATEGORY_DETAIL = {
  rent: "Månedlig leieinntekt.",
  electricity_heating_income: "Betaling fra leietaker for strøm og oppvarming.",
  parking: "Inntekter fra parkeringsplass eller garasje.",
  additional_rent: "Utleie av bod, møbler eller andre tillegg.",
  reimbursement: "Tilbakebetaling av utlegg.",
  other_income: "Inntekter som ikke passer i de andre kategoriene.",
};
// «Utgift» stays other_expense; «Annen utgift» is miscellaneous_expense. Kjørebok and
// Møbler og inventar are their own pages.
export const EXPENSE_CATEGORIES = [
  ["other_expense", "Utgift"], ["maintenance", "Vedlikehold"], ["municipal_fees", "Kommunale avgifter"],
  ["electricity_heating", "Strøm og oppvarming"], ["insurance", "Forsikring"], ["miscellaneous_expense", "Annen utgift"],
];
const CATEGORY_TITLE = {
  ...Object.fromEntries(INCOME_CATEGORIES), ...Object.fromEntries(EXPENSE_CATEGORIES),
  financing_costs: "Finansieringskostnader",
};
const KNOWN_CATEGORIES = new Set([...Object.keys(CATEGORY_TITLE), "improvement", "furnishings_equipment", "property_tax", "common_costs", "letting_management"]);
const FOLDED_TO_MISC = new Set(["improvement", "furnishings_equipment"]);

// FinancialTransactionCategory.effectiveCategory: Påkostning and Møbler og utstyr show as
// «Annen utgift», also when the server folded them to other_expense with legacy_category.
export function effectiveCategory(category, legacyCategory) {
  if (FOLDED_TO_MISC.has(category)) return "miscellaneous_expense";
  if (["property_tax", "common_costs", "letting_management"].includes(category)) return "other_expense";
  if (category === "other_expense" && FOLDED_TO_MISC.has((legacyCategory ?? "").trim())) return "miscellaneous_expense";
  return category || null;
}
export function categoryTitle(row) {
  const raw = (row.category ?? "").trim();
  if (!raw) return "Uten kategori";
  if (!KNOWN_CATEGORIES.has(raw)) return "Ukjent kategori";
  return CATEGORY_TITLE[effectiveCategory(raw, row.legacy_category)] ?? "Ukjent kategori";
}
// Inventory purchase, also when already folded (category or legacy_category).
export const isFurnishingPurchase = (row) =>
  row?.category === "furnishings_equipment" || row?.legacy_category === "furnishings_equipment";
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

const toJpeg = async (file) => (await toJpegSized(file)).blob;
const toJpegSized = (file) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 2560;
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext("2d");
      // JPEG has no transparency: put PNG receipts on white, not black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => (blob ? resolve({ blob, width: canvas.width, height: canvas.height }) : reject(new Error("jpeg"))), "image/jpeg", 0.85);
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
  return supabase.rpc("create_rental_agreement_draft", {
    requested_tenancy_id: tenancy.id,
    requested_legal_rule_version: "pending_l1_l10",
    requested_language_code: "nb",
    requested_snapshot: { contract_schema_version: 1, terms: termsOf(v) },
    requested_parties: parties,
    requested_operation_id: crypto.randomUUID(),
  });
}

// Draft terms are encodeIfPresent in the app: empty fields are left out.
const termsOf = (v) => {
  const digits = (v.account ?? "").replace(/\D/g, "");
  return {
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
};
// The portal form owns these keys; every other term set in the app is kept as is.
const FORM_TERM_KEYS = ["lease_term_type", "start_date", "end_date", "rent_amount_minor", "payment_day",
  "deposit_amount_minor", "security_type", "security_amount_minor", "notice_period_months", "special_terms", "payment_account"];

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

/* ---------- Kontraktflyt (ContractSigningFoundation / TenantLeaseContractController) ---------- */
// get_rental_agreement -> rows[0].payload { agreement, version, parties, actor_access }.
export async function getAgreement(agreementId) {
  const { data, error } = await supabase.rpc("get_rental_agreement", { requested_agreement_id: agreementId });
  if (error) return { error };
  const payload = first(data)?.payload;
  return payload ? { data: payload } : { error: new Error("Kontrakten finnes ikke.") };
}

export const termsForForm = (terms = {}) => ({
  termType: terms.lease_term_type === "fixed" ? "fixed" : "indefinite",
  start: terms.start_date ?? "",
  end: terms.end_date ?? "",
  rent: terms.rent_amount_minor ? kronerOf(terms.rent_amount_minor) : "",
  payday: terms.payment_day ? String(terms.payment_day) : "",
  deposit: terms.deposit_amount_minor != null ? kronerOf(terms.deposit_amount_minor) : "",
  notice: terms.notice_period_months ? String(terms.notice_period_months) : "",
  account: terms.payment_account ?? "",
  special: terms.special_terms ?? "",
});

// update_rental_agreement_draft replaces the snapshot: keep everything the form does not edit.
export function updateAgreementDraft(detail, v) {
  const snapshot = detail.version?.snapshot ?? {};
  const kept = { ...(snapshot.terms ?? {}) };
  for (const k of FORM_TERM_KEYS) delete kept[k];
  return supabase.rpc("update_rental_agreement_draft", {
    requested_agreement_id: detail.agreement.id,
    expected_version_id: detail.version.id,
    expected_draft_revision: detail.agreement.draft_revision,
    requested_legal_rule_version: detail.version.legal_rule_version ?? "pending_l1_l10",
    requested_language_code: detail.version.language_code ?? "nb",
    // The draft payload allows only these two root keys; the stored snapshot is the server-built one.
    requested_snapshot: { contract_schema_version: 1, terms: { ...termsOf(v), ...kept } },
  });
}

// cancelDraft: «Slett utkast» for draft and ready_for_review.
export const cancelAgreement = (a) =>
  supabase.rpc("cancel_rental_agreement", {
    requested_agreement_id: a.agreement_id,
    expected_draft_revision: a.draft_revision,
    requested_operation_id: crypto.randomUUID(),
  });

const fnOutcome = async (error) => {
  try { return (await error.context?.json?.())?.outcome ?? null; } catch { return null; }
};
const SIGN_OUTCOME_TEXT = {
  version_conflict: "Kontrakten er endret. Last inn på nytt.",
  document_mismatch: "Kontrakten er endret. Last inn på nytt.",
  forbidden: "Du har ikke tilgang til å signere denne kontrakten.",
  unauthenticated: "Økten er utløpt. Logg inn på nytt og prøv igjen.",
  invalid_request: "Tegn signaturen på nytt.",
};
const signResult = async ({ data, error }, okOutcomes) => {
  let body = data;
  if (typeof data === "string") { try { body = JSON.parse(data); } catch { body = null; } }
  const outcome = error ? await fnOutcome(error) : body?.outcome;
  if (okOutcomes.includes(outcome)) return { outcome };
  if (error && !outcome && (error.name === "FunctionsFetchError" || error.name === "FunctionsRelayError")) {
    return { message: "Nettleseren fikk ikke kontakt med signeringstjenesten. Prøv igjen om litt." };
  }
  return { message: SIGN_OUTCOME_TEXT[outcome] ?? "Signaturen ble ikke registrert på kontrakten. Last inn på nytt og prøv igjen." };
};

// signApprovedContract: contract-pdf intent "deliver" with landlord_ink, only from ready_for_review.
export async function signAsLandlord(a, ink) {
  const res = await supabase.functions.invoke("contract-pdf", {
    body: { agreement_id: a.agreement_id, version_id: a.current_version_id, revision: Number(a.draft_revision), intent: "deliver", landlord_ink: ink },
  });
  return signResult(res, ["ready"]);
}

// TenantLeaseContractController.submitSignature: contract-pdf intent "sign" with tenant_ink.
export async function signAsTenant(lease, ink) {
  const res = await supabase.functions.invoke("contract-pdf", {
    body: { agreement_id: lease.agreement_id, version_id: lease.version_id, intent: "sign", tenant_ink: ink },
  });
  return signResult(res, ["signature_recorded", "signed", "already_signed"]);
}

export const rejectAgreement = (lease, reason) =>
  supabase.rpc("reject_rental_agreement", {
    requested_agreement_id: lease.agreement_id,
    requested_version_id: lease.version_id,
    requested_reason: reason,
  });

// Lease pointer + signature rows: by tenancy for tenants, by agreement for managers.
export async function myTenancyLease(tenancyId) {
  const [lease, parties] = await Promise.all([
    supabase.rpc("get_my_tenancy_lease", { requested_tenancy_id: tenancyId }),
    supabase.rpc("list_my_tenancy_lease_parties", { requested_tenancy_id: tenancyId }),
  ]);
  if (lease.error) return { error: lease.error };
  return { data: first(lease.data) ?? null, parties: parties.data ?? [] };
}
export async function agreementLease(agreementId) {
  const [lease, parties] = await Promise.all([
    supabase.rpc("get_rental_agreement_lease_by_id", { requested_agreement_id: agreementId }),
    supabase.rpc("list_rental_agreement_lease_parties_by_id", { requested_agreement_id: agreementId }),
  ]);
  if (lease.error) return { error: lease.error };
  return { data: first(lease.data) ?? null, parties: parties.data ?? [] };
}

// downloadLeasePDF: documents row (status ready) -> documents bucket, under RLS.
export async function documentPdf(documentId) {
  const { data, error } = await supabase.from("documents").select("storage_path, status, original_file_name, title")
    .eq("id", documentId).limit(1);
  const row = data?.[0];
  if (error || !row || row.status !== "ready" || !row.storage_path) return { message: "PDF-en kunne ikke vises. Prøv igjen." };
  const file = await supabase.storage.from("documents").download(row.storage_path);
  if (file.error || !file.data) return { message: "PDF-en kunne ikke vises. Prøv igjen." };
  const blob = new Blob([await file.data.arrayBuffer()], { type: "application/pdf" });
  return { url: URL.createObjectURL(blob), filename: row.original_file_name || "Leiekontrakt.pdf" };
}

// ContractChanges.swift
export const listChanges = (agreementId) =>
  supabase.rpc("list_rental_agreement_changes", { requested_agreement_id: agreementId });
export const requestRevision = (a) =>
  supabase.rpc("request_rental_agreement_change", {
    requested_agreement_id: a.agreement_id,
    expected_version_id: a.signed_version_id ?? a.current_version_id,
    requested_kind: "revision",
    requested_operation_id: crypto.randomUUID(),
  });
export const respondChange = (requestId, accept) =>
  supabase.rpc("respond_rental_agreement_change", { requested_request_id: requestId, requested_response: accept ? "accepted" : "rejected" });
export const CHANGE_STATUS = { draft: "Utkast", pending: "Venter på at leietaker signerer", accepted: "Godkjent – venter på signaturer", rejected: "Avslått", declined: "Avslått", completed: "Fullført", cancelled: "Avbrutt" };

/* ---------- Leieforhold (LifecycleB1Controller / TenancyController) ---------- */
export const TERMINATION_REASONS = [["lease_completed", "Avtalt leieperiode er ferdig"], ["mutual_agreement", "Partene er enige"],
  ["manager_terminated", "Avsluttet av utleier"], ["tenant_moved_out", "Leietaker har flyttet ut"], ["other_operational", "Annen driftsmessig årsak"]];
export const CANCELLATION_REASONS = [["never_started", "Leieforholdet startet aldri"], ["invitation_withdrawn", "Invitasjonen trekkes tilbake"],
  ["agreement_abandoned", "Avtalen ble ikke gjennomført"], ["manager_cancelled", "Kansellert av utleier"], ["other_operational", "Annen driftsmessig årsak"]];
export const terminateTenancy = (tenancyId, reason, endDate, operationId) =>
  supabase.rpc("terminate_tenancy", { requested_tenancy_id: tenancyId, requested_reason_code: reason, requested_operation_id: operationId, p_end_date: endDate || null });
export const cancelTenancy = (tenancyId, reason, operationId) =>
  supabase.rpc("cancel_tenancy", { requested_tenancy_id: tenancyId, requested_reason_code: reason, requested_operation_id: operationId });
export const LIFECYCLE_ERROR_TEXT = {
  end_date_before_start_date: "Sluttdato kan ikke være før startdato.",
  tenancy_not_active: "Leieforholdet er ikke aktivt lenger. Last siden på nytt.",
  tenancy_not_cancellable: "Leieforholdet kan ikke kanselleres. Last siden på nytt.",
  manager_access_required: "Du har ikke tilgang til å gjøre dette.",
};
export const lifecycleError = (res) => {
  if (!res?.error) {
    const out = first(res?.data)?.outcome;
    return out && !["tenancy_terminated", "tenancy_cancelled", "tenancy_ended"].includes(out) && LIFECYCLE_ERROR_TEXT[out] ? LIFECYCLE_ERROR_TEXT[out] : null;
  }
  const code = Object.keys(LIFECYCLE_ERROR_TEXT).find((k) => String(res.error.message).includes(k));
  return code ? LIFECYCLE_ERROR_TEXT[code] : explain(res.error);
};
// PropertyTenancyListing: tenant invitations on the property's tenancies.
export const pendingInvitations = (tenancyIds) =>
  supabase.from("invitations").select("id, tenancy_id, email, status, created_at")
    .in("tenancy_id", tenancyIds).eq("intended_role", "tenant").eq("status", "pending").order("created_at", { ascending: true });
export const cancelInvitation = (invitationId) =>
  supabase.rpc("cancel_tenancy_invitation", { requested_invitation_id: invitationId });

/* ---------- Signatur på skjerm (ContractScreenSignature) ---------- */
// The ink is a JPEG (contract-pdf screen-ink.mjs: 32 B–350 KB, ≤ 4000 px) plus name, place and date.
export function signatureForm({ title, intro, name, submitLabel, onSubmit }) {
  const pad = h("div", "pt-signature");
  const canvas = h("canvas", "pt-signature-canvas");
  canvas.width = 720;
  canvas.height = 240;
  canvas.setAttribute("aria-label", "Tegn signaturen");
  const ctx = canvas.getContext("2d");
  const blank = () => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#1b3a6b";
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  };
  blank();
  let drawing = false;
  let points = 0;
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
  };
  canvas.addEventListener("pointerdown", (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    ctx.beginPath();
    ctx.moveTo(...at(e));
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    ctx.lineTo(...at(e));
    ctx.stroke();
    points += 1;
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  const clear = h("button", "pt-btn pt-btn-secondary pt-btn-small", "Tøm");
  clear.type = "button";
  clear.addEventListener("click", () => { blank(); points = 0; });
  pad.append(h("span", "pt-field-label", "Signatur"), canvas, clear);
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return openForm({
    title, intro, submitLabel,
    sections: [pad],
    fields: [
      { name: "name", label: "Navn", type: "text", value: name ?? "", required: true, maxLength: 120 },
      { name: "place", label: "Sted for signatur", type: "text", maxLength: 80, help: "Maks 80 tegn" },
      { name: "date", label: "Dato", type: "date", value: iso, required: true },
    ],
    onSubmit: async (v) => {
      if (points < 8) return "Tegn signaturen før du lagrer.";
      const jpeg = canvas.toDataURL("image/jpeg", 0.82).split(",")[1] ?? "";
      if (jpeg.length < 200 || jpeg.length > 466_000) return "Signaturen kunne ikke brukes. Tegn den på nytt.";
      return onSubmit({ jpeg_base64: jpeg, width: canvas.width, height: canvas.height, signer_name: v.name, place: v.place, date: v.date });
    },
  });
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

/* ---------- Kvitteringer (FinancialTransactionReceiptController / EconomyController) ---------- */
// Receipts on an existing post use the document lifecycle (PDF in "documents") plus
// link_financial_transaction_document, as the app's saveAttachment. Images become a one-page PDF.
export const RECEIPT_FILTERS = [["all", "Alle"], ["withReceipt", "Med kvittering"], ["withoutReceipt", "Uten kvittering"]];
const MAX_DOCUMENT_BYTES = 10_000_000;
export const transactionDocLinks = (propertyId) =>
  supabase.from("financial_transaction_documents").select("transaction_id, document_id, linked_at").eq("property_id", propertyId);
export const linkableDocuments = (propertyId) => supabase.rpc("list_property_documents", { requested_property_id: propertyId });
export const receiptDocuments = (ids) =>
  supabase.from("documents").select("id, title, original_file_name, status, created_at").in("id", ids);
export const linkReceipt = (transactionId, documentId) =>
  supabase.rpc("link_financial_transaction_document", { requested_transaction_id: transactionId, requested_document_id: documentId });
export const unlinkReceipt = (transactionId, documentId) =>
  supabase.rpc("unlink_financial_transaction_document", { requested_transaction_id: transactionId, requested_document_id: documentId });

const ascii = (str) => new TextEncoder().encode(str);
// Minimal PDF 1.4: one page the size of the image, the JPEG embedded as DCTDecode.
export function jpegToPdf(jpeg, width, height) {
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (chunk) => { parts.push(chunk); length += chunk.length; };
  const obj = (n, body, stream) => {
    offsets[n] = length;
    push(ascii(`${n} 0 obj\n${body}\n`));
    if (stream) { push(ascii("stream\n")); push(stream); push(ascii("\nendstream\n")); }
    push(ascii("endobj\n"));
  };
  const content = ascii(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`);
  push(ascii("%PDF-1.4\n"));
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  obj(5, `<< /Length ${content.length} >>`, content);
  const xref = length;
  push(ascii(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of parts) { out.set(c, at); at += c.length; }
  return out;
}

const RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png"];
async function receiptPdfBytes(file) {
  if (!file || !RECEIPT_TYPES.includes(file.type)) return { message: "Filtypen støttes ikke. Bruk PDF, JPEG eller PNG." };
  let bytes;
  if (file.type === "application/pdf") bytes = new Uint8Array(await file.arrayBuffer());
  else {
    const { blob, width, height } = await toJpegSized(file);
    bytes = jpegToPdf(new Uint8Array(await blob.arrayBuffer()), width, height);
  }
  const head = new TextDecoder().decode(bytes.slice(0, 5));
  if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES || head !== "%PDF-") return { message: "Kvitteringen kunne ikke importeres." };
  return { bytes };
}

const documentLifecycle = async (body) => {
  const { data, error } = await supabase.functions.invoke("document-lifecycle", { body });
  if (error) {
    try {
      const parsed = await error.context?.json?.();
      if (parsed?.outcome) return parsed;
    } catch { /* ignore */ }
    throw error;
  }
  return data;
};

// prepareAttachment: reserve -> upload -> finalize, then link the ready document to the post.
export async function attachReceipt(propertyId, transactionId, file) {
  const SAVE_FAILED = "Kunne ikke lagre kvitteringen. Prøv igjen.";
  try {
    const pdf = await receiptPdfBytes(file);
    if (pdf.message) return pdf.message;
    const reservation = await documentLifecycle({
      action: "reserve", property_id: propertyId, reservation_key: crypto.randomUUID(),
      title: "Kvittering", original_file_name: "receipt.pdf", file_size_bytes: pdf.bytes.length,
    });
    if (!["reserved", "already_reserved"].includes(reservation?.outcome) || !reservation.document_id || !reservation.storage_path || reservation.status !== "pending") return SAVE_FAILED;
    const up = await supabase.storage.from("documents").upload(reservation.storage_path, new Blob([pdf.bytes], { type: "application/pdf" }), { cacheControl: "0", contentType: "application/pdf", upsert: false });
    if (up.error) return SAVE_FAILED;
    const done = await documentLifecycle({ action: "finalize", document_id: reservation.document_id });
    if (!["ready", "already_ready"].includes(done?.outcome) || done.document_id !== reservation.document_id || done.status !== "ready") return SAVE_FAILED;
    const link = await linkReceipt(transactionId, reservation.document_id);
    return link.error ? "Kunne ikke koble dokumentet. Prøv igjen." : null;
  } catch {
    return SAVE_FAILED;
  }
}

/* ---------- Meldinger (ChatRemote / ChatAttachmentRemote) ---------- */
// The inbox uses the _v2 lists (v1 columns + counterpart_avatars, iOS #1509). If a _v2 call
// fails, that list falls back to v1; «function not found» is remembered for the session.
export const CHAT_MAX_CHARS = 4000;
export const CHAT_DELETE_WINDOW_MS = 30_000;
export const DELETED_MARKER = "eu-deleted v1";
export const provisionChats = () => supabase.rpc("provision_my_chat_conversations");
// The inbox: «Alle i boligen» first, then tenancy chats. A failing property list never hides the room chats.
const missingV2 = new Set();
async function listWithInlineAvatars(v2, v1) {
  if (!missingV2.has(v2)) {
    const res = await supabase.rpc(v2);
    if (!res.error) return res;
    if (["PGRST202", "42883"].includes(res.error.code)) missingV2.add(v2);
  }
  return supabase.rpc(v1);
}
export async function listChatConversations() {
  const [tenancy, prop] = await Promise.all([
    listWithInlineAvatars("list_my_chat_conversations_v2", "list_my_chat_conversations"),
    listWithInlineAvatars("list_my_property_chat_conversations_v2", "list_my_property_chat_conversations"),
  ]);
  if (tenancy.error) return { error: tenancy.error };
  const known = new Set((tenancy.data ?? []).map((c) => c.conversation_id));
  const property = (prop.data ?? []).filter((c) => !known.has(c.conversation_id)).map((c) => ({ ...c, is_property_chat: true }));
  return { data: [...property, ...(tenancy.data ?? [])] };
}
export const listChatMessagesBefore = (conversationId, beforeSequenceNo = null, limit = 50) =>
  supabase.rpc("list_chat_messages_before", { requested_conversation_id: conversationId, requested_before_sequence_no: beforeSequenceNo, requested_limit: limit });
export const listChatPeerCursors = (conversationId) =>
  supabase.rpc("list_chat_peer_read_cursors", { requested_conversation_id: conversationId });
export const advanceChatSeen = (conversationId, sequenceNo) =>
  supabase.rpc("advance_chat_last_seen", { requested_conversation_id: conversationId, requested_sequence_no: sequenceNo });
export const deleteChatMessage = (conversationId, messageId) =>
  supabase.rpc("delete_chat_message", { requested_conversation_id: conversationId, requested_message_id: messageId });
export const chatTenantMembers = (tenancyIds) =>
  supabase.from("tenancy_members").select("tenancy_id, user_id").in("tenancy_id", tenancyIds).eq("role", "tenant").eq("invitation_status", "accepted");
export const linkedContacts = (userIds) => supabase.rpc("list_linked_profile_contacts", { requested_user_ids: userIds });
export const myTenancies = () => supabase.rpc("list_my_tenancies");
// Rows without counterpart_avatars (v1 server) get one list_chat_counterpart_avatars call each.
export const chatCounterpartAvatars = (conversationId) =>
  supabase.rpc("list_chat_counterpart_avatars", { requested_conversation_id: conversationId });
// Profile photo from the private "profile-avatars" bucket ({user_id}/avatar.jpg), as a data: URL (CSP).
const avatarUrls = new Map();
export function avatarDataUrl(userId, revision) {
  const key = `${userId}:${revision}`;
  if (!avatarUrls.has(key)) {
    avatarUrls.set(key, supabase.storage.from("profile-avatars").download(`${userId}/avatar.jpg`)
      .then((r) => (r.error ? null : dataUrlOf(r.data))).catch(() => null));
  }
  return avatarUrls.get(key);
}

// Composer validation as ChatController: trimmed, not empty, at most 4 000 characters, no NUL.
export function chatBodyError(body) {
  if (!body.trim()) return "Skriv en melding først.";
  if ([...body].length > CHAT_MAX_CHARS) return "Meldingen kan inneholde opptil 4 000 tegn.";
  if (body.includes("\u0000")) return "Meldingen inneholder et tegn som ikke kan sendes.";
  return null;
}
export const replyBody = (target, text) => `eu-reply v1\n${target.message_id}\n${target.sequence_no}\n${text}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Message bodies: plain text, or the app's eu-reply / eu-file / eu-doc / eu-deleted markers.
export function parseChatBody(body) {
  if (body === DELETED_MARKER) return { kind: "deleted" };
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] === "eu-reply v1" && lines.length >= 4 && UUID_RE.test(lines[1]) && Number(lines[2]) > 0) {
    const text = lines.slice(3).join("\n");
    if (text.trim()) return { kind: "reply", replyTo: lines[1], replySeq: Number(lines[2]), text };
  }
  if (lines[0] === "eu-file v1" && lines.length >= 4 && UUID_RE.test(lines[1]) && ["image", "file"].includes(lines[2])) {
    const title = lines.slice(3).join("\n").trim();
    if (title && title.length <= 160 && !title.includes("\n")) return { kind: "file", attachmentId: lines[1], fileKind: lines[2], title };
  }
  if (lines[0] === "eu-doc v1" && lines.length >= 3 && UUID_RE.test(lines[1])) {
    const title = lines.slice(2).join("\n").trim();
    if (title && title.length <= 160 && !title.includes("\n")) return { kind: "doc", documentId: lines[1], title };
  }
  return { kind: "text", text: body };
}

export async function sendChatMessage(conversationId, requestId, body) {
  const { data, error } = await supabase.rpc("send_chat_message", { requested_conversation_id: conversationId, requested_client_request_id: requestId, requested_body: body });
  if (error || !data?.[0]) return { error: error ?? new Error("missing") };
  return { data: data[0] };
}

const cardTitle = (s, fallback) => s.replace(/\s+/g, " ").trim().slice(0, 160) || fallback;
const safeName = (raw, fallback, ext) => {
  const last = raw.split(/[\\/]/).pop() ?? "";
  const stem = last.replace(/\.[^.]*$/, "");
  const cleaned = stem.replace(/[^\p{L}\p{N}_-]/gu, "-").split("-").filter(Boolean).join("-");
  return `${(cleaned || fallback).slice(0, 80)}.${ext}`;
};
// ChatAttachmentCodec + send: images become JPEG, PDFs must start with %PDF-; max 10 MB.
export async function sendChatAttachment(conversationId, file) {
  const FAILED = "Meldingen ble ikke sendt.";
  if (!file) return FAILED;
  try {
    let bytes, mime, kind, name;
    const head = new TextDecoder().decode(new Uint8Array(await file.slice(0, 5).arrayBuffer()));
    if (head === "%PDF-") {
      bytes = new Uint8Array(await file.arrayBuffer());
      mime = "application/pdf"; kind = "file"; name = safeName(file.name, "dokument", "pdf");
    } else if (["image/jpeg", "image/png"].includes(file.type)) {
      bytes = new Uint8Array(await (await toJpeg(file)).arrayBuffer());
      mime = "image/jpeg"; kind = "image"; name = safeName(file.name, "bilde", "jpg");
    } else return "Filen kunne ikke åpnes.";
    if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES) return "Filen kunne ikke åpnes.";
    const res = await supabase.rpc("reserve_chat_attachment", {
      requested_conversation_id: conversationId, requested_reservation_key: crypto.randomUUID(),
      requested_original_file_name: name, requested_mime_type: mime, requested_file_size_bytes: bytes.length,
    });
    const r = res.data?.[0];
    if (res.error || !["reserved", "already_reserved"].includes(r?.outcome) || !r.attachment_id || !r.storage_path) return FAILED;
    const up = await supabase.storage.from("chat-attachments").upload(r.storage_path, new Blob([bytes], { type: mime }), { cacheControl: "0", contentType: mime, upsert: false });
    if (up.error && !/exists|Duplicate/i.test(up.error.message ?? "")) return FAILED;
    const fin = await supabase.rpc("finalize_chat_attachment", { requested_attachment_id: r.attachment_id });
    if (fin.error || !["ready", "already_ready"].includes(fin.data?.[0]?.outcome)) return FAILED;
    const title = cardTitle(name.replace(/\.[^.]*$/, ""), kind === "image" ? "Bilde" : "Fil");
    const sent = await sendChatMessage(conversationId, crypto.randomUUID(), `eu-file v1\n${r.attachment_id}\n${kind}\n${title}`);
    return sent.error ? FAILED : null;
  } catch {
    return FAILED;
  }
}

// get_chat_attachment, then the bytes from "chat-attachments". Images come back as a data: URL (CSP).
export async function loadChatAttachment(attachmentId) {
  const res = await supabase.rpc("get_chat_attachment", { requested_attachment_id: attachmentId });
  const row = res.data?.[0];
  if (res.error || !row || row.status !== "ready") return { message: "Filen kunne ikke åpnes." };
  const file = await supabase.storage.from("chat-attachments").download(row.storage_path);
  if (file.error) return { message: "Filen kunne ikke åpnes." };
  const blob = new Blob([file.data], { type: row.mime_type });
  if (row.kind === "image") return { dataUrl: await dataUrlOf(blob), filename: row.original_file_name };
  return { url: URL.createObjectURL(blob), filename: row.original_file_name || "dokument.pdf" };
}

// ChatRealtimeRemote.changes(conversationID): RLS decides what arrives; the UI reloads, never trusts payloads.
export function subscribeChat(conversationId, onChange) {
  const filter = `conversation_id=eq.${conversationId}`;
  const channel = supabase.channel(`chat:${conversationId}:${crypto.randomUUID()}`);
  for (const table of ["chat_messages", "chat_member_read_cursors"]) {
    channel.on("postgres_changes", { event: "INSERT", schema: "public", table, filter }, () => onChange(table));
    channel.on("postgres_changes", { event: "UPDATE", schema: "public", table, filter }, () => onChange(table));
  }
  channel.subscribe();
  return () => supabase.removeChannel(channel);
}

/* ---------- Vedlikehold (MaintenanceController.swift, MaintenanceRealtimeRemote) ---------- */
export const MAINTENANCE_STATUS = { reported: "Innmeldt", in_progress: "Under behandling", waiting: "Venter", resolved: "Løst", closed: "Lukket" };
export const MAINTENANCE_PRIORITIES = [["low", "Lav"], ["normal", "Normal"], ["high", "Høy"], ["urgent", "Haster"]];
// MaintenanceStatus.allowedNextStatuses
export const MAINTENANCE_NEXT = {
  reported: ["in_progress", "waiting", "resolved"],
  in_progress: ["waiting", "resolved"],
  waiting: ["in_progress", "resolved"],
  resolved: ["in_progress"],
  closed: ["in_progress"],
};
export const MAINTENANCE_CATEGORIES = [["water", "Vann og rør"], ["electricity", "Strøm"], ["heating", "Varme og ventilasjon"], ["appliances", "Hvitevarer"], ["damage", "Bygg og skade"], ["access", "Lås og adgang"], ["pests", "Skadedyr"], ["other", "Annet"]];
export const MAINTENANCE_IMAGE_LIMIT = 5;
export const MAINTENANCE_DOCUMENT_LIMIT = 5;
export const COMMENT_PHOTO_LIMIT = 4;
export const COMMENT_PHOTO_ONLY = "📷 Bilde";
export const isFinishedMaintenance = (r) => r?.status === "resolved" || r?.status === "closed";
const MAINTENANCE_COLUMNS = "id, property_id, tenancy_id, created_by, title, description, category, priority, status, resolved_at, closed_at, last_activity_at, created_at, updated_at, submitted_at";

// RLS decides what each role sees; unsubmitted drafts are hidden as in the app.
export const listMaintenance = (propertyId) =>
  supabase.from("maintenance_requests").select(MAINTENANCE_COLUMNS).eq("property_id", propertyId)
    .not("submitted_at", "is", null).order("last_activity_at", { ascending: false });
export const getMaintenance = (requestId) =>
  supabase.from("maintenance_requests").select(MAINTENANCE_COLUMNS).eq("id", requestId).maybeSingle();
export const listMaintenanceEvents = (requestId) =>
  supabase.from("maintenance_events").select("id, maintenance_request_id, actor_id, event_type, old_value, new_value, comment, comment_attachments, created_at")
    .eq("maintenance_request_id", requestId).order("created_at", { ascending: true }).order("id", { ascending: true });
// Who reported the case: a tenant on the case's tenancy (MaintenanceController.reporterIsTenant).
export async function maintenanceReporterIsTenant(request) {
  if (!request?.tenancy_id || !request.created_by) return false;
  const { data } = await supabase.from("tenancy_members").select("user_id")
    .eq("tenancy_id", request.tenancy_id).eq("user_id", request.created_by).eq("role", "tenant").limit(1);
  return (data ?? []).length > 0;
}

// MaintenanceController.setStatus: a finished case goes back to «Under behandling» via reopen.
export const setMaintenanceStatus = (request, status) =>
  status === "in_progress" && isFinishedMaintenance(request)
    ? supabase.rpc("reopen_maintenance_request", { requested_request_id: request.id })
    : supabase.rpc("set_maintenance_request_status", { requested_request_id: request.id, requested_status: status });
export const setMaintenancePriority = (requestId, priority) =>
  supabase.rpc("set_maintenance_request_priority", { requested_request_id: requestId, requested_priority: priority });
export const shareMaintenance = (requestId, tenancyId) =>
  supabase.rpc("share_maintenance_request_with_tenancy", { requested_request_id: requestId, requested_tenancy_id: tenancyId });

// create -> upload images -> submit, as the app's create flow does.
export async function createMaintenance(propertyId, v, images = []) {
  const res = await supabase.rpc("create_maintenance_request", {
    requested_property_id: propertyId, requested_tenancy_id: v.tenancyId || null,
    requested_title: v.title, requested_description: v.description,
    requested_category: v.category, requested_priority: v.priority,
  });
  if (res.error) return { message: explain(res.error) };
  const requestId = first(res.data)?.maintenance_request_id;
  if (!requestId) return { message: "Kunne ikke opprette vedlikeholdssaken. Prøv igjen." };
  let imageError = null;
  for (const file of images.slice(0, MAINTENANCE_IMAGE_LIMIT)) {
    imageError = (await uploadMaintenanceImage(requestId, file)) ?? imageError;
  }
  const sub = await supabase.rpc("submit_maintenance_request", { requested_request_id: requestId });
  if (sub.error) return { requestId, message: explain(sub.error) };
  return { requestId, imageError };
}

export const listMaintenanceImages = (requestId) =>
  supabase.rpc("list_maintenance_request_images", { requested_request_id: requestId });
export async function maintenanceImageUrl(storagePath) {
  const file = await supabase.storage.from("property-images").download(storagePath);
  return file.error ? null : dataUrlOf(file.data);
}
export async function uploadMaintenanceImage(requestId, file) {
  const FAILED = "Bildet kunne ikke lastes opp. Prøv igjen.";
  try {
    const jpeg = await toJpeg(file);
    if (jpeg.size > 12_000_000) return "Velg et bilde på maksimalt 12 MB.";
    const r = await imageLifecycle({ action: "reserve_maintenance", maintenance_request_id: requestId, reservation_key: crypto.randomUUID(), caption: null });
    if (r?.outcome === "attachment_limit_reached") return `En sak kan ha maksimalt ${MAINTENANCE_IMAGE_LIMIT} bilder.`;
    if (r?.outcome === "already_ready" || r?.status === "ready") return null;
    if (!["reserved", "already_reserved"].includes(r?.outcome) || !r.image_id || !r.storage_path) return FAILED;
    const up = await supabase.storage.from("property-images").upload(r.storage_path, jpeg, { cacheControl: "0", contentType: "image/jpeg", upsert: false });
    if (up.error && !/exists|duplicate/i.test(up.error.message)) return FAILED;
    const fin = await imageLifecycle({ action: "finalize_maintenance", image_id: r.image_id });
    return ["ready", "already_ready"].includes(fin?.outcome) ? null : FAILED;
  } catch {
    return FAILED;
  }
}

export const listMaintenanceDocuments = (requestId) =>
  supabase.rpc("list_maintenance_request_documents", { requested_request_id: requestId });
export async function uploadMaintenanceDocument(requestId, file) {
  const FAILED = "Dokumentet kunne ikke lastes opp. Prøv igjen.";
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return "Velg en PDF på maksimalt 10 MB.";
    const name = file.name || "dokument.pdf";
    const r = await documentLifecycle({
      action: "reserve_maintenance", maintenance_request_id: requestId, reservation_key: crypto.randomUUID(),
      title: name.replace(/\.pdf$/i, "").slice(0, 160) || "Dokument", original_file_name: name, file_size_bytes: bytes.length,
    });
    if (r?.outcome === "attachment_limit_reached") return `En sak kan ha maksimalt ${MAINTENANCE_DOCUMENT_LIMIT} dokumenter.`;
    if (!["reserved", "already_reserved"].includes(r?.outcome) || !r.document_id || !r.storage_path) return FAILED;
    if (r.status !== "ready") {
      const up = await supabase.storage.from("documents").upload(r.storage_path, new Blob([bytes], { type: "application/pdf" }), { cacheControl: "0", contentType: "application/pdf", upsert: false });
      if (up.error && !/exists|duplicate/i.test(up.error.message)) return FAILED;
    }
    const fin = await documentLifecycle({ action: "finalize_maintenance", document_id: r.document_id });
    return ["ready", "already_ready"].includes(fin?.outcome) ? null : FAILED;
  } catch {
    return FAILED;
  }
}

// Comment photos: maintenance-comment-images/{property}/{request}/{image}.jpg (lowercase), max 4.
export async function addMaintenanceComment(request, text, photos = []) {
  const attachments = [];
  try {
    for (const file of photos.slice(0, COMMENT_PHOTO_LIMIT)) {
      const jpeg = await toJpeg(file);
      if (jpeg.size > 10_000_000) return "Hvert bilde kan være maksimalt 10 MB.";
      const id = crypto.randomUUID().toLowerCase();
      const path = `${request.property_id}/${request.id}/${id}.jpg`.toLowerCase();
      const up = await supabase.storage.from("maintenance-comment-images").upload(path, jpeg, { cacheControl: "0", contentType: "image/jpeg", upsert: false });
      if (up.error) return "Bildet kunne ikke lastes opp. Prøv igjen.";
      attachments.push({ id, storage_path: path, mime_type: "image/jpeg" });
    }
  } catch {
    return "Bildet kunne ikke leses.";
  }
  const comment = text.trim() || (attachments.length ? COMMENT_PHOTO_ONLY : "");
  if (!comment) return "Skriv en kommentar før du sender. Lukkede saker må gjenåpnes først.";
  const res = await supabase.rpc("add_maintenance_comment", { requested_request_id: request.id, requested_comment: comment, requested_attachments: attachments });
  return res.error ? explain(res.error) : null;
}
export async function commentPhotoUrl(storagePath) {
  const file = await supabase.storage.from("maintenance-comment-images").download(storagePath);
  return file.error ? null : dataUrlOf(file.data);
}

// Planned visit (MaintenanceView.scheduleSection): one calendar event, no deadline.
export const maintenanceCalendarItems = (requestId) =>
  supabase.from("property_calendar_items").select("id, property_id, tenancy_id, maintenance_request_id, title, description, item_type, category, starts_at, due_at, ends_at, all_day, visibility, status, tenant_response, tenant_response_comment, tenant_responded_at")
    .eq("maintenance_request_id", requestId).order("starts_at", { ascending: true });
export const calendarResponses = (propertyId) =>
  supabase.rpc("list_calendar_item_responses", { requested_property_id: propertyId });
export const scheduleMaintenanceVisit = (request, startsAt) =>
  supabase.rpc("create_calendar_item", {
    requested_property_id: request.property_id, requested_tenancy_id: request.tenancy_id ?? null,
    requested_maintenance_request_id: request.id, requested_title: request.title.slice(0, 160),
    requested_description: null, requested_item_type: "event", requested_category: "maintenance",
    requested_starts_at: iso(startsAt), requested_due_at: null, requested_ends_at: null,
    requested_all_day: false, requested_shared_with_property: false,
  });
// Reschedule keeps the item and its duration; the server resets the tenant's answer.
export function rescheduleMaintenanceVisit(item, startsAt) {
  const start = new Date(startsAt);
  const ends = item.ends_at && item.starts_at ? new Date(start.getTime() + (new Date(item.ends_at) - new Date(item.starts_at))) : null;
  return supabase.rpc("update_calendar_item", {
    requested_calendar_item_id: item.id, requested_title: item.title, requested_description: item.description,
    requested_item_type: item.item_type, requested_category: item.category,
    requested_starts_at: iso(startsAt), requested_due_at: item.due_at,
    requested_ends_at: ends ? ends.toISOString().replace(/\.\d{3}Z$/, "Z") : null, requested_all_day: item.all_day,
  });
}
// One calendar item for #kalender/<id> (CalendarView detail). RLS decides who may read it.
export const calendarItem = (itemId) =>
  supabase.from("property_calendar_items").select("id, property_id, tenancy_id, maintenance_request_id, title, description, item_type, category, starts_at, due_at, ends_at, all_day, visibility, status, tenant_response, tenant_response_comment, tenant_responded_at")
    .eq("id", itemId).maybeSingle();
export const respondToCalendarItem = (itemId, decision, comment) =>
  supabase.rpc("respond_to_calendar_item", { requested_calendar_item_id: itemId, requested_decision: decision, requested_comment: comment || null });

// iOS #1506: channel maintenance:<request>:<uuid>, INSERT on maintenance_events for this request.
// Reconnects with backoff (1 s → 30 s) and asks for a reload after every resubscribe.
export function subscribeMaintenance(requestId, { onEvent, onResync }) {
  const rid = String(requestId).toLowerCase();
  let channel = null;
  let stopped = false;
  let attempt = 0;
  let timer = null;
  let hadConnection = false;
  const connect = () => {
    if (stopped) return;
    const ch = supabase.channel(`maintenance:${rid}:${crypto.randomUUID()}`);
    channel = ch;
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "maintenance_events", filter: `maintenance_request_id=eq.${rid}` }, (payload) => {
      const row = payload?.new;
      if (!row?.id) return;
      if (row.maintenance_request_id && String(row.maintenance_request_id).toLowerCase() !== rid) return;
      onEvent(row);
    });
    ch.subscribe((status) => {
      if (stopped || ch !== channel) return;
      if (status === "SUBSCRIBED") {
        if (hadConnection || attempt > 0) onResync?.();
        hadConnection = true;
        attempt = 0;
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        channel = null;
        supabase.removeChannel(ch);
        const delay = Math.min(30_000, 1000 * 2 ** attempt);
        attempt += 1;
        clearTimeout(timer);
        timer = setTimeout(connect, delay);
      }
    });
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    if (channel) supabase.removeChannel(channel);
    channel = null;
  };
}

/* ---------- Varsler (NotificationsRemote) ---------- */
export const NOTIFICATION_PAGE_SIZE = 30;
// Keyset paging like iOS: the cursor is the last row's (relevant_at, notification_id).
export const listNotifications = (scope, before = null) =>
  supabase.rpc("list_my_notifications", {
    requested_role_scope: scope,
    requested_before_relevant_at: before?.relevant_at ?? null,
    requested_before_notification_id: before?.notification_id ?? null,
    requested_limit: NOTIFICATION_PAGE_SIZE,
  });
export const markNotificationRead = (scope, notificationId) =>
  supabase.rpc("mark_my_notification_read", { requested_role_scope: scope, requested_notification_id: notificationId });
export const markAllNotificationsRead = (scope) =>
  supabase.rpc("mark_my_notifications_read", { requested_role_scope: scope });

// NotificationsRealtimeRemote: one channel, the same tables as iOS. Payloads are never
// read; every change only asks for a refetch through list_my_notifications (RLS).
export function subscribeNotifications(onChange) {
  let channel = null;
  let stopped = false;
  let attempt = 0;
  let timer = null;
  let hadConnection = false;
  const wake = () => { if (!stopped) onChange(); };
  const connect = () => {
    if (stopped) return;
    const ch = supabase.channel(`notifications-domain:${crypto.randomUUID()}`);
    channel = ch;
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "maintenance_events" }, wake)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "property_calendar_items" }, wake)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "property_calendar_items" }, wake)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tenancy_members", filter: "invitation_status=eq.accepted" }, wake)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tenancy_members", filter: "invitation_status=eq.accepted" }, wake)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notification_inbox_wakes" }, wake);
    ch.subscribe((status) => {
      if (stopped || ch !== channel) return;
      if (status === "SUBSCRIBED") {
        if (hadConnection || attempt > 0) wake();
        hadConnection = true;
        attempt = 0;
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        channel = null;
        supabase.removeChannel(ch);
        const delay = Math.min(30_000, 1000 * 2 ** attempt);
        attempt += 1;
        clearTimeout(timer);
        timer = setTimeout(connect, delay);
      }
    });
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    if (channel) supabase.removeChannel(channel);
    channel = null;
  };
}

/* ---------- Inn- og utflytting (InspectionRemote, MoveOutProcessRemote, DepositSettlementRemote) ---------- */
export const INSPECTION_AREAS = [["entrance", "Entré"], ["kitchen", "Kjøkken"], ["bathroom", "Bad"], ["living_room", "Stue"],
  ["bedroom", "Soverom"], ["floors", "Gulv"], ["walls_ceiling", "Vegger og tak"], ["windows_doors", "Vinduer og dører"],
  ["inventory", "Inventar"], ["other", "Annet"]];
export const INSPECTION_CONDITIONS = [["ok", "Ingen merknad"], ["note", "Merknad"], ["damage", "Skade"]];
export const INSPECTION_NOTE_LIMIT = 8000;
const one = (res) => (res.error ? res : { data: Array.isArray(res.data) ? res.data[0] ?? null : res.data });

export const listInspections = (tenancyId) =>
  supabase.from("inspections").select("*").eq("tenancy_id", tenancyId).order("created_at", { ascending: true });
export const listInspectionItems = (inspectionId) =>
  supabase.from("inspection_items").select("*").eq("inspection_id", inspectionId).order("sort_order", { ascending: true });
export const listInspectionComments = (inspectionId) =>
  supabase.from("inspection_comments").select("id, author_id, author_role, body, created_at").eq("inspection_id", inspectionId).order("created_at", { ascending: true });
export const createMoveIn = (tenancyId) =>
  supabase.rpc("create_inspection", { requested_tenancy_id: tenancyId, requested_type: "move_in" }).then(one);
export const setTenantMayFill = (inspectionId, enabled) =>
  supabase.rpc("set_inspection_tenant_may_fill", { p_inspection_id: inspectionId, p_enabled: enabled });
export const markTenantFillDone = (inspectionId) => supabase.rpc("mark_move_in_tenant_fill_done", { p_inspection_id: inspectionId });
export const approveMoveIn = (inspectionId) => supabase.rpc("approve_move_in_protocol", { p_inspection_id: inspectionId });
export const addProtocolComment = (inspectionId, body) =>
  supabase.rpc("add_inspection_protocol_comment", { p_inspection_id: inspectionId, p_body: body });

// The "other" note carries the app's shared handover data after the visible text:
// "[[eu-handover:{json}]]" (PropertyHandoverSharedNote). The portal edits only the
// visible text and the done flag of a checklist point; the rest is copied as stored.
const HANDOVER_PREFIX = "[[eu-handover:";
const HANDOVER_SUFFIX = "]]";
export const visibleNote = (note) => {
  const text = note ?? "";
  const at = text.indexOf(HANDOVER_PREFIX);
  return (at < 0 ? text : text.slice(0, at)).trim();
};
const markerOf = (note) => {
  const text = note ?? "";
  const at = text.indexOf(HANDOVER_PREFIX);
  return at < 0 ? "" : text.slice(at);
};
export function handoverData(note) {
  const marker = markerOf(note);
  if (!marker) return null;
  const end = marker.indexOf(HANDOVER_SUFFIX, HANDOVER_PREFIX.length);
  if (end < 0) return null;
  try {
    const obj = JSON.parse(marker.slice(HANDOVER_PREFIX.length, end));
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}
export const withVisibleNote = (existing, visible) => {
  const marker = markerOf(existing);
  const text = (visible ?? "").trim();
  if (!marker) return text || null;
  return text ? `${text}\n${marker}` : marker;
};
// Toggles `d` on one point of the "in"/"out" list; every other field is kept.
export function withChecklistDone(existing, list, index, done) {
  const obj = handoverData(existing);
  if (!obj || !Array.isArray(obj[list]) || !obj[list][index]) return null;
  obj[list][index] = { ...obj[list][index], d: done };
  const marker = markerOf(existing);
  const rest = marker.slice(marker.indexOf(HANDOVER_SUFFIX, HANDOVER_PREFIX.length) + HANDOVER_SUFFIX.length);
  const visible = visibleNote(existing);
  const next = `${HANDOVER_PREFIX}${JSON.stringify(obj)}${HANDOVER_SUFFIX}${rest}`;
  return visible ? `${visible}\n${next}` : next;
}
export const updateInspectionItem = (item, condition, note) =>
  supabase.rpc("update_inspection_item", {
    requested_item_id: item.id, requested_condition: condition,
    requested_note: note && note.trim() ? note : null, expected_updated_at: item.updated_at,
  }).then(one);

// iOS PropertyHandoverLifecycle.finalizeStoredInspection + MoveInSendStatus (same as Android #250):
// read the row fresh, send the move-in right before the lock only when it is an unsent draft,
// then finalize that fresh row. A retry never sends twice or finalizes an older version.
const freshInspection = async (id) => {
  const r = await supabase.from("inspections").select("*").eq("id", id).maybeSingle();
  return r.error || !r.data ? null : r.data;
};
const moveInNeedsSend = (i) => i.type === "move_in" && i.status === "draft" && !i.sent_for_review_at;
// SupabaseInspectionRemote.purgeFinalizedChecklistPhotos: best effort, errors are ignored.
async function purgeFinalizedChecklistPhotos(inspectionId) {
  const listed = await supabase.rpc("list_soft_deleted_checklist_photo_paths", { requested_inspection_id: inspectionId });
  const paths = (listed.data ?? []).map((r) => r?.storage_path).filter(Boolean);
  if (listed.error || !paths.length) return;
  const removed = await supabase.storage.from("property-images").remove(paths);
  const names = (removed.data ?? []).map((f) => f.name).filter((n) => paths.includes(n));
  if (names.length) await supabase.rpc("complete_soft_deleted_checklist_photos", { requested_paths: names });
}
const finalizeRow = (row, deleteIncomplete) =>
  supabase.rpc("finalize_inspection", {
    requested_inspection_id: row.id, expected_updated_at: row.updated_at, p_delete_incomplete: deleteIncomplete,
  }).then(one);
export async function finalizeInspection(inspection, { sendMoveIn = false, deleteIncomplete = false } = {}) {
  let current = await freshInspection(inspection.id);
  if (!current) return { error: { message: "missing" } };
  if (current.status === "finalized") {
    await purgeFinalizedChecklistPhotos(inspection.id);
    return { data: current };
  }
  let result;
  try {
    if (sendMoveIn && moveInNeedsSend(current)) {
      const sent = await supabase.rpc("send_move_in_for_review", { p_inspection_id: current.id }).then(one);
      if (sent.error) throw sent.error;
      current = sent.data?.updated_at ? sent.data : (await freshInspection(current.id)) ?? current;
    }
    result = await finalizeRow(current, deleteIncomplete);
    if (result.error) throw result.error;
  } catch (error) {
    if (!sendMoveIn) return { error };
    // MoveInSendStatus.recoverFinalize: a lost reply can hide a send or lock that worked.
    // Finalized: no error. Sent but still a draft: lock it once, never send again.
    let stored = await freshInspection(inspection.id);
    if (stored && stored.type === "move_in" && stored.status === "draft" && stored.sent_for_review_at) {
      await finalizeRow(stored, deleteIncomplete).catch(() => null);
      stored = (await freshInspection(inspection.id)) ?? stored;
    }
    if (stored?.status !== "finalized") return { error };
    result = { data: stored };
  }
  await purgeFinalizedChecklistPhotos(inspection.id);
  return result;
}
// CancelMoveInChecklist: the RPC returns the stored photo paths; the app removes them, then confirms.
export async function cancelMoveIn(tenancyId) {
  const res = await supabase.rpc("cancel_move_in_checklist", { requested_tenancy_id: tenancyId });
  if (res.error) return res;
  const paths = (res.data ?? []).map((r) => r?.storage_path).filter(Boolean);
  if (!paths.length) return res;
  const removed = await supabase.storage.from("property-images").remove(paths);
  const names = (removed.data ?? []).map((f) => f.name).filter((n) => paths.includes(n));
  if (names.length) await supabase.rpc("complete_cancelled_move_in_photos", { requested_paths: names });
  return res;
}
export const INSPECTION_ERROR_TEXT = {
  move_in_not_sent_for_review: "Venter på at utleier sender protokollen.",
  move_in_comment_not_available: "Kommentarer kan bare legges til før protokollen er ferdigstilt.",
  inspection_image_lifecycle_unsettled: "Et bilde er ikke ferdig lastet opp. Vent litt, eller slett bildet og ta det på nytt.",
  inspection_items_incomplete: "Sjekklisten er ufullstendig. Åpne den på nytt og fyll ut punktene før du ferdigstiller.",
  inspection_checklist_note_missing: "Sjekklisten er ufullstendig. Åpne den på nytt og fyll ut punktene før du ferdigstiller.",
  inspection_version_conflict: "Gjennomgangen ble endret et annet sted. Den nyeste versjonen er lastet inn; kontroller den og prøv igjen.",
  inspection_item_version_conflict: "Gjennomgangen ble endret et annet sted. Den nyeste versjonen er lastet inn; kontroller den og prøv igjen.",
};
export const inspectionError = (res) => {
  const msg = String(res?.error?.message ?? "");
  const key = Object.keys(INSPECTION_ERROR_TEXT).find((k) => msg.includes(k));
  return key ? INSPECTION_ERROR_TEXT[key] : res?.error ? explain(res.error) : null;
};

export const MOVE_OUT_STATE = { notice_given: "Oppsigelsen er registrert", checklist_open: "Pågår", review: "Pågår", approved: "Ferdigstilt", deposit: "Depositumsoppgjør", ended: "Ferdig", cancelled: "Avbrutt" };
export const OPEN_MOVE_OUT = ["notice_given", "checklist_open", "review", "approved", "deposit"];
export const listMoveOutProcesses = (tenancyIds) =>
  supabase.from("move_out_processes").select("id, tenancy_id, property_id, scope, subject_member_id, move_out_on, notice_party, state, inspection_id, notice_given_at")
    .in("tenancy_id", tenancyIds).order("notice_given_at", { ascending: true });
export const registerMoveOutNotice = (tenancyId, scope, subjectUserId, moveOutOn) =>
  supabase.rpc("register_move_out_notice", { p_tenancy_id: tenancyId, p_scope: scope, p_subject_user_id: subjectUserId ?? null, p_move_out_on: moveOutOn });
export const openMoveOutChecklist = (processId) => supabase.rpc("open_move_out_checklist", { p_process_id: processId });
export const cancelMoveOut = (processId) => supabase.rpc("cancel_move_out_process", { p_process_id: processId });
export const completeMoveOut = (processId) => supabase.rpc("complete_move_out", { p_process_id: processId });
export const MOVE_OUT_ERROR_TEXT = {
  scope_not_whole_home: "Feil omfang for denne boligtypen. Velg ett rom eller hele boligen.",
  scope_not_a_room: "Feil omfang for denne boligtypen. Velg ett rom eller hele boligen.",
  move_out_date_in_past: "Utflyttingsdatoen kan ikke være før i dag.",
  move_out_already_open: "Det finnes allerede en åpen utflytting for dette leieforholdet.",
  tenancy_not_active: "Leieforholdet er ikke aktivt.",
  tenant_not_active_member: "Leietakeren er ikke et aktivt medlem av leieforholdet.",
  invalid_move_out_request: "Ugyldig oppsigelse. Sjekk dato og omfang.",
  deposit_not_finished: "Depositumsoppgjøret må være godtatt før utflyttingen kan fullføres",
};
export const moveOutError = (res) => {
  const msg = String(res?.error?.message ?? "");
  const key = Object.keys(MOVE_OUT_ERROR_TEXT).find((k) => msg.includes(k));
  return key ? MOVE_OUT_ERROR_TEXT[key] : res?.error ? explain(res.error) : null;
};

export const DEPOSIT_STATUS = { open: "Ikke sendt", claims_pending: "Venter på leietaker", accepted: "Godkjent av begge parter", declined: "Avslått", full_refund: "Godkjent uten krav", disputed: "Uenighet" };
export const DEPOSIT_CLAIM_LIMIT = 20;
export const depositPointer = (tenancyId) =>
  supabase.from("deposit_settlements").select("id, status, tenancy_id, move_out_inspection_id")
    .eq("tenancy_id", tenancyId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
// The inspection id is passed only when there is no settlement id yet.
export const openDepositSettlement = (tenancyId, settlementId, inspectionId) =>
  supabase.rpc("open_deposit_settlement", {
    requested_inspection_id: settlementId ? null : inspectionId ?? null,
    requested_settlement_id: settlementId ?? null, requested_tenancy_id: tenancyId,
  });
export const addDepositClaim = (settlementId, description, amountMinor) =>
  supabase.rpc("add_deposit_settlement_claim", { requested_settlement_id: settlementId, requested_description: description, requested_amount_minor: amountMinor });
export const updateDepositClaim = (claimId, description, amountMinor) =>
  supabase.rpc("update_deposit_settlement_claim", { requested_claim_id: claimId, requested_description: description, requested_amount_minor: amountMinor });
export const removeDepositClaim = (claimId) => supabase.rpc("remove_deposit_settlement_claim", { requested_claim_id: claimId });
export const submitDepositClaims = (settlementId) => supabase.rpc("submit_deposit_settlement_claims", { requested_settlement_id: settlementId });
export const approveDepositFullRefund = (settlementId) => supabase.rpc("approve_deposit_full_refund", { requested_settlement_id: settlementId });
export const reviseDisputedDeposit = (settlementId) => supabase.rpc("revise_disputed_deposit_settlement", { requested_settlement_id: settlementId });
export const respondDeposit = (settlementId, accept) =>
  supabase.rpc("respond_deposit_settlement", { requested_settlement_id: settlementId, requested_accept: accept });
export const disputeDeposit = (settlementId, reason) =>
  supabase.rpc("dispute_deposit_settlement", { requested_settlement_id: settlementId, requested_reason: reason });
export const DEPOSIT_ERROR_TEXT = {
  exceed: "Kravene kan ikke være større enn depositumet.",
  deposit_claim_limit: "Du kan legge inn opptil 20 krav.",
  deposit_dispute_reason_required: "Skriv en begrunnelse for å bestride.",
};
export const depositError = (res) => {
  const msg = String(res?.error?.message ?? "");
  const key = Object.keys(DEPOSIT_ERROR_TEXT).find((k) => msg.includes(k));
  return key ? DEPOSIT_ERROR_TEXT[key] : res?.error ? explain(res.error) : null;
};

/* ---------- Dokumenter (DocumentController / DocumentsView) ---------- */
// list_property_documents, document_tenancy_access (managers), the "document-lifecycle"
// edge function and the private "documents" bucket, exactly as the app.
export const listPropertyDocuments = (propertyId) => supabase.rpc("list_property_documents", { requested_property_id: propertyId });
export const listDocumentAccess = (propertyId) =>
  supabase.from("document_tenancy_access").select("document_id, tenancy_id").eq("property_id", propertyId);

// reserve -> upload -> finalize. A stable reservationKey makes retries reuse the same row.
async function storeDocumentPdf(propertyId, bytes, title, fileName, reservationKey) {
  const reservation = await documentLifecycle({
    action: "reserve", property_id: propertyId, reservation_key: reservationKey,
    title, original_file_name: fileName, file_size_bytes: bytes.length,
  });
  if (!["reserved", "already_reserved"].includes(reservation?.outcome) || !reservation.document_id) return { stage: "reserve" };
  if (reservation.status === "ready") return { id: reservation.document_id };
  if (reservation.status !== "pending" || !reservation.storage_path) return { stage: "reserve" };
  const up = await supabase.storage.from("documents").upload(reservation.storage_path, new Blob([bytes], { type: "application/pdf" }), { cacheControl: "0", contentType: "application/pdf", upsert: false });
  if (up.error && !/exists|duplicate/i.test(up.error.message ?? "")) return { stage: "upload" };
  const done = await documentLifecycle({ action: "finalize", document_id: reservation.document_id });
  if (!["ready", "already_ready"].includes(done?.outcome) || done.document_id !== reservation.document_id) return { stage: "finalize", id: reservation.document_id };
  return { id: reservation.document_id };
}

export async function uploadDocumentPdf(propertyId, file) {
  const PICK = "Velg en PDF på maksimalt 10 MB.";
  if (!file) return { message: PICK };
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name ?? "");
  if (!isPdf || !file.size || file.size > MAX_DOCUMENT_BYTES) return { message: PICK };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return { message: PICK };
  const fileName = (file.name ?? "").split(/[\\/]/).pop() || "dokument.pdf";
  const title = fileName.replace(/\.[^.]+$/, "").trim() || "Dokument";
  try {
    const saved = await storeDocumentPdf(propertyId, bytes, title, fileName, crypto.randomUUID());
    if (saved.stage === "reserve") return { message: "Dokumentet kunne ikke klargjøres for opplasting. Prøv igjen." };
    if (saved.stage === "finalize") return { message: "Filen ble lastet opp, men kunne ikke ferdigstilles ennå. Prøv igjen senere." };
    if (saved.stage) return { message: "Dokumentet kunne ikke lastes opp. Ingen tilgang ble delt. Prøv igjen." };
    return { id: saved.id, notice: "Dokumentet er lastet opp. Del det med et aktivt leieforhold når du er klar." };
  } catch {
    return { message: "Dokumentet kunne ikke lastes opp. Ingen tilgang ble delt. Prøv igjen." };
  }
}

export async function deleteDocument(documentId) {
  try {
    const res = await documentLifecycle({ action: "delete", document_id: documentId });
    return ["deleted", "already_deleted"].includes(res?.outcome) ? null : "Dokumentet kunne ikke slettes. Prøv igjen.";
  } catch {
    return "Dokumentet kunne ikke slettes. Prøv igjen.";
  }
}

// Grant / revoke a tenancy's read access (RLS: managers, can_share_document).
export async function setDocumentAccess(documentId, tenancyId, propertyId, grantedBy, granted) {
  const res = granted
    ? await supabase.from("document_tenancy_access").insert({ document_id: documentId, tenancy_id: tenancyId, property_id: propertyId, granted_by: grantedBy })
    : await supabase.from("document_tenancy_access").delete().eq("document_id", documentId).eq("tenancy_id", tenancyId);
  if (res.error && !(granted && res.error.code === "23505")) return "Kunne ikke oppdatere dokumentdelingen. Prøv igjen.";
  return null;
}

// Open a listed (ready) document from its storage path.
export async function openListedDocument(doc) {
  if (!doc?.storage_path || doc.status !== "ready") return { message: "Dokumentet finnes ikke lenger eller er ikke tilgjengelig." };
  const { data, error } = await supabase.storage.from("documents").download(doc.storage_path);
  if (error || !data) return { message: "Kunne ikke åpne dokumentet. Prøv igjen." };
  return { url: URL.createObjectURL(new Blob([data], { type: "application/pdf" })), filename: doc.original_file_name || "dokument.pdf" };
}

/* ---------- Maler (LandlordDocumentDelivery) ---------- */
// Save the letter, grant the tenancy, post an «eu-doc v1» card in its chat and ask
// "landlord-template-email" to send it. Keys stay the same for retries of one letter.
const templateEmail = async (documentId, tenancyId) => {
  try {
    const { data, error } = await supabase.functions.invoke("landlord-template-email", { body: { document_id: documentId, tenancy_id: tenancyId } });
    let payload = data;
    if (error) {
      try { payload = await error.context?.json?.(); } catch { payload = null; }
    }
    const outcome = payload?.outcome;
    if (outcome === "sent") return "sent";
    if (outcome === "email_not_configured") return "notConfigured";
    if (outcome === "no_recipient") return "noRecipient";
    return "failed";
  } catch {
    return "failed";
  }
};

async function postDocumentCard(tenancyId, documentId, title, requestId) {
  const find = async () => {
    const res = await listChatConversations();
    return (res.data ?? []).find((c) => c.tenancy_id === tenancyId && !c.is_property_chat && c.conversation_status === "active" && c.is_writable);
  };
  let conv = await find();
  if (!conv) {
    await provisionChats();
    conv = await find();
  }
  if (!conv) return false;
  const body = `eu-doc v1\n${documentId.toLowerCase()}\n${cardTitle(title, "Dokument")}`;
  const sent = await sendChatMessage(conv.conversation_id, requestId, body);
  return !sent.error;
}

export function templateNotice(shared, email) {
  if (shared && email === "sent") return { ok: true, text: "Dokumentet er sendt til leietaker i appen og på e-post." };
  if (shared && email === "notConfigured") return { ok: true, text: "Dokumentet er delt i appen. E-post er ikke satt opp på serveren ennå." };
  if (shared && email === "noRecipient") return { ok: true, text: "Dokumentet er delt i appen. Leietaker har ingen bekreftet e-post." };
  if (shared) return { ok: true, text: "Dokumentet er delt i appen. E-post ble ikke sendt." };
  if (email === "sent") return { ok: true, text: "E-post er sendt. Dokumentet ble ikke delt i appen." };
  return { ok: false, text: "Handlingen ble ikke fullført. Prøv igjen." };
}

/** keys: { reservationKey, chatRequestId, documentId? } (documentId is set after a save). */
export async function sendTemplateLetter({ propertyId, tenancyId, grantedBy, title, fileName, bytes, keys }) {
  try {
    if (!keys.documentId) {
      const saved = await storeDocumentPdf(propertyId, bytes, title, fileName, keys.reservationKey);
      if (!saved.id || saved.stage) return templateNotice(false, "failed");
      keys.documentId = saved.id;
    }
    const grant = await setDocumentAccess(keys.documentId, tenancyId, propertyId, grantedBy, true);
    const shared = !grant;
    const [, email] = await Promise.all([
      shared ? postDocumentCard(tenancyId, keys.documentId, title, keys.chatRequestId).catch(() => false) : Promise.resolve(false),
      templateEmail(keys.documentId, tenancyId),
    ]);
    return templateNotice(shared, email);
  } catch {
    return templateNotice(false, "failed");
  }
}

// App logo (not the mascot) as a white-backed JPEG for the letter header.
let letterLogo = null;
export function letterLogoJpeg() {
  if (!letterLogo) {
    letterLogo = new Promise((resolve) => {
      const img = new Image();
      img.onload = async () => {
        try {
          const size = 160;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(img, 0, 0, size, size);
          const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92));
          resolve(blob ? { jpeg: new Uint8Array(await blob.arrayBuffer()), width: size, height: size } : null);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = "/brand/app-logo-160.png";
    });
  }
  return letterLogo;
}

// Ink pad for template signatures: strokes as normalized 0..1 points (max 40 strokes, 240 points each).
export function inkPad() {
  const wrap = h("div", "pt-signature");
  const canvas = h("canvas", "pt-signature-canvas");
  canvas.width = 720;
  canvas.height = 240;
  canvas.setAttribute("aria-label", "Signaturfelt");
  const clear = h("button", "pt-btn pt-btn-secondary pt-btn-small", "Tøm signatur");
  clear.type = "button";
  wrap.append(h("span", "pt-field-label", "Signatur (utleier)"), canvas, clear);
  const ctx = canvas.getContext("2d");
  const strokes = [];
  let current = null;
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#1b3a6b";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of strokes) {
      ctx.beginPath();
      s.forEach((p, i) => (i ? ctx.lineTo(p.x * canvas.width, p.y * canvas.height) : ctx.moveTo(p.x * canvas.width, p.y * canvas.height)));
      if (s.length === 1) ctx.lineTo(s[0].x * canvas.width + 1, s[0].y * canvas.height);
      ctx.stroke();
    }
  };
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (strokes.length >= 40) return;
    canvas.setPointerCapture(e.pointerId);
    current = [point(e)];
    strokes.push(current);
    draw();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!current || current.length >= 240) return;
    current.push(point(e));
    draw();
  });
  const end = () => { current = null; wrap.dispatchEvent(new Event("input", { bubbles: true })); };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  clear.addEventListener("click", () => { strokes.length = 0; draw(); wrap.dispatchEvent(new Event("input", { bubbles: true })); });
  return { node: wrap, strokes: () => strokes.map((s) => s.map((p) => ({ ...p }))) };
}

/* ---------- Kjørebok (MileageController.swift, MileageLedger.swift) ---------- */
// MileageRateCatalog.json: Skatteetaten's rate for yrkeskjøring med privatbil, also elbil.
export const MILEAGE_RATES = {
  2025: { orePerKm: 350, authority: "Skatteetaten" },
  2026: { orePerKm: 350, authority: "Skatteetaten" },
};
// MileageLedger.stateCarAllowanceOrePerKm: shown as a footnote only, never used.
export const STATE_CAR_ALLOWANCE = { 2025: 500, 2026: 530 };
// SetAsideEstimateManifest.json: ordinary rate and the tiltakssone rate, in basis points.
export const SET_ASIDE_BPS = { 2025: [2200, 1850], 2026: [2200, 1850] };
export const MILEAGE_MIN_METERS = 100;
export const MILEAGE_MAX_METERS = 2000000;

// MileageLedger.meters(fromKilometerInput:): "25,5" -> 25500, 0,1–2000 km.
export const mileageMeters = (input) => {
  const compact = String(input ?? "").replace(/[\u00a0\s]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(compact) && !/^\.\d+$/.test(compact)) return null;
  const meters = Math.round(Number(compact) * 1000);
  return meters >= MILEAGE_MIN_METERS && meters <= MILEAGE_MAX_METERS ? meters : null;
};
// MileageLedger.amountMinor: rounded to whole øre, like mileage_amount_minor on the server.
export const mileageAmountMinor = (meters, orePerKm) =>
  meters > 0 && orePerKm > 0 ? Math.floor((meters * orePerKm + 500) / 1000) : null;
// MileageLedger.kilometerText: one decimal, comma, no trailing ",0".
export const kilometerText = (meters) => String(Math.round(Number(meters) / 100) / 10).replace(".", ",");
export const orePerKmText = (ore) => (ore / 100).toFixed(2).replace(".", ",");
export const percentText = (bps) => {
  const whole = Math.floor(bps / 100);
  const rest = bps % 100;
  return `${rest === 0 ? whole : rest % 10 === 0 ? `${whole},${rest / 10}` : `${whole},${String(rest).padStart(2, "0")}`} %`;
};
// MileageLedger.storedPlaceText: collapse whitespace, at most 120 characters, cut at a word.
export const storedPlaceText = (raw) => {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= 120) return text;
  const prefix = text.slice(0, 120);
  const space = prefix.lastIndexOf(" ");
  return space > 0 ? prefix.slice(0, space).trim() || prefix : prefix;
};
// MileageTripListPresentation.displayPlace: no trailing ", Norge".
export const displayPlace = (raw) => {
  const text = String(raw ?? "").trim().replace(/,\s*(Norge|Norway)$/i, "").trim();
  return text || null;
};
// EconomyTransactionPresentation.mileageFields: create_mileage_trip books
// «Kjørebok · fra – til · formål · 25.5 km». Null when the row is not a trip expense.
const isRoutePart = (part) => part.includes(" – ") || part.includes(" - ") || /, (norge|norway)/i.test(part) || /,\s*\d{4}\b/.test(part);
export const mileageFields = (row) => {
  if (row?.transaction_type !== "expense") return null;
  const text = String(row.description ?? "").trim();
  if (!text.startsWith("Kjørebok")) return null;
  const parts = text.split(" · ").map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  if (!/km$/i.test(last)) return null;
  const km = Number(last.slice(0, -2).trim().replace(",", "."));
  if (!(km > 0)) return null;
  const rest = parts.slice(1, -1);
  const purpose = [...rest].reverse().find((p) => !isRoutePart(p)) ?? null;
  return { purpose, meters: Math.round(km * 1000) };
};
export const isMileageExpense = (row) => mileageFields(row) !== null;

// SupabaseMileageRemote.list: pages of 200 until an empty page. End date is exclusive.
export async function listMileageTrips(propertyId, startDate, endDate) {
  const rows = [];
  for (;;) {
    const { data, error } = await supabase.rpc("list_mileage_trips", {
      requested_property_id: propertyId, requested_start_date: startDate, requested_end_date: endDate,
      requested_offset: rows.length, requested_page_size: 200,
    });
    if (error) return { error };
    if (!data?.length) return { data: rows.filter((t) => !t.voided_at) };
    rows.push(...data);
  }
}
const tripPayload = (v) => ({
  requested_trip_date: v.date,
  requested_distance_meters: v.meters,
  requested_purpose: v.purpose?.trim() || null,
  requested_from_place: storedPlaceText(v.from),
  requested_to_place: storedPlaceText(v.to),
});
// The server replays the same trip for the same client request id (safe retry).
export async function createMileageTrip(propertyId, v, clientRequestId) {
  const { data, error } = await supabase.rpc("create_mileage_trip", {
    requested_property_id: propertyId, ...tripPayload(v), requested_client_request_id: clientRequestId,
  });
  return error ? { error } : { data: first(data) };
}
export async function correctMileageTrip(tripId, v, clientRequestId) {
  const { data, error } = await supabase.rpc("correct_mileage_trip", {
    requested_trip_id: tripId, ...tripPayload(v), requested_client_request_id: clientRequestId,
  });
  return error ? { error } : { data: first(data) };
}
// ProfileRepository: tax_residence_tiltakssone picks 18,5 % instead of 22 %.
export async function taxResidenceInTiltakssone(userId) {
  const { data } = await supabase.from("profiles").select("tax_residence_tiltakssone").eq("id", userId).maybeSingle();
  return data?.tax_residence_tiltakssone === true;
}

/* ---------- Medutleiere (PropertyMembersController.swift, IncomingCoLandlordInvitations.swift) ---------- */
export async function propertyManagers(propertyId) {
  return supabase.rpc("list_property_managers", { requested_property_id: propertyId });
}

export async function coLandlordInvitations(propertyId) {
  return supabase.rpc("list_property_co_landlord_invitations", { requested_property_id: propertyId });
}

const sendCoLandlordInvitation = (invitationId, action) =>
  supabase.functions.invoke("send-co-landlord-notification", {
    body: { invitation_id: invitationId, request_id: crypto.randomUUID(), action },
  });

// PropertyCoLandlordAddErrorPolicy: same messages as the app.
export const coLandlordAddError = (error) => {
  const msg = String(error?.message ?? error ?? "").toLowerCase();
  if (msg.includes("account not found")) return "Kunne ikke sende invitasjonen. Prøv igjen.";
  if (msg.includes("invalid email")) return "Skriv inn en gyldig e-postadresse.";
  if (msg.includes("account already has access")) return "Denne brukeren har allerede tilgang til boligen.";
  if (msg.includes("property_co_landlord") && /not found|does not exist|schema cache|pgrst202/.test(msg)) return "Med-utleierfunksjonen er ikke aktivert på serveren ennå.";
  return "Kunne ikke invitere med-utleier. Prøv igjen.";
};

// create_property_co_landlord_invitation, then the e-mail only when the row is new (was_created).
export async function inviteCoLandlord(propertyId, email) {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabase.rpc("create_property_co_landlord_invitation", {
    requested_property_id: propertyId, requested_email: normalized,
  });
  if (error) return { error };
  const row = first(data);
  if (!row?.invitation_id) return { error: new Error("missing invitation") };
  if (!row.was_created) return { invitation: row, sent: null };
  const sent = await sendCoLandlordInvitation(row.invitation_id, "send");
  return { invitation: row, sent: !sent.error };
}

export async function resendCoLandlordInvitation(invitationId) {
  const res = await sendCoLandlordInvitation(invitationId, "resend");
  return { sent: !res.error };
}

export async function cancelCoLandlordInvitation(invitationId) {
  return supabase.rpc("cancel_property_co_landlord_invitation", { requested_invitation_id: invitationId });
}

export async function removeCoLandlord(propertyId, userId) {
  return supabase.rpc("remove_property_co_landlord", { requested_property_id: propertyId, requested_user_id: userId });
}

// InvitationShareLink(kind: .coLandlord): a fresh link to share by hand when the e-mail failed.
export async function coLandlordShareLink(invitationId) {
  const { data, error } = await supabase.rpc("issue_co_landlord_invitation_share_link", { p_invitation_id: invitationId });
  if (error || typeof data !== "string" || !data.includes("/co-landlord-invite#token=")) return null;
  return data;
}

export async function myCoLandlordInvitations() {
  return supabase.rpc("list_my_property_co_landlord_invitations");
}

export async function acceptCoLandlordInvitation(invitationId) {
  const { data, error } = await supabase.rpc("accept_property_co_landlord_invitation_by_id", { requested_invitation_id: invitationId });
  if (error) return { error };
  return { result: first(data) ?? null };
}

export async function declineCoLandlordInvitation(invitationId) {
  return supabase.rpc("decline_property_co_landlord_invitation", { requested_invitation_id: invitationId });
}
