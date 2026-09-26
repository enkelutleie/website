const CATEGORY = {
  rent: "Husleie",
  reimbursement: "Refusjon",
  other_income: "Annen inntekt",
  maintenance: "Vedlikehold",
  improvement: "Påkostning",
  electricity_heating: "Strøm og oppvarming",
  municipal_fees: "Kommunale avgifter",
  property_tax: "Eiendomsskatt",
  insurance: "Forsikring",
  common_costs: "Felleskostnader",
  letting_management: "Utleieforvaltning",
  financing_costs: "Finanskostnader",
  furnishings_equipment: "Inventar",
  other_expense: "Annen utgift",
};
const INCOME = ["rent", "reimbursement", "other_income"];
const EXPENSE = Object.keys(CATEGORY).filter((key) => !INCOME.includes(key));
const TASK = { reported: "Meldt", in_progress: "Pågår", waiting: "Venter", resolved: "Løst", closed: "Lukket" };
const HANDBOOK = {
  wifi: "Wi-Fi",
  fuse_box: "Sikringsskap",
  stopcock: "Stoppekran",
  waste_sorting: "Avfall",
  keys_access: "Nøkler",
  house_rules: "Husregler",
  emergency: "Nødnumre",
  parking: "Parkering",
  appliances: "Hvitevarer",
  heating_ventilation: "Varme og ventilasjon",
  fire_safety: "Brannsikkerhet",
  common_areas: "Fellesarealer",
  mail_packages: "Post",
  maintenance_tips: "Vedlikeholdstips",
  phone_directory: "Telefonliste",
};
const RENT_STATE = { upcoming: "Kommende", due: "Forfaller", overdue: "Forfalt" };
const ASSET = { furnishings: "Innbo", equipment: "Utstyr", improvement: "Påkostning", other: "Annet" };
const CONTRACT_STATUS = { draft: "Utkast", pending_signature: "Venter signatur", ready_for_review: "Klar til gjennomgang", signed: "Signert", cancelled: "Avbrutt" };
const AREA = {
  entrance: "Entré",
  kitchen: "Kjøkken",
  living_room: "Stue",
  bathroom: "Bad",
  bedroom: "Soverom",
  storage: "Bod",
  windows: "Vinduer",
  floors: "Gulv",
  walls: "Vegger",
  other: "Annet",
};

const money = (minor) =>
  new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" }).format(Number(minor) / 100);
const when = (value) => {
  if (!value) return "";
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
};
const explain = (error) => {
  const text = error?.outcome || error?.message || "";
  const known = {
    forbidden: "Du har ikke tilgang til den handlingen.",
    not_authenticated: "Logg inn på nytt.",
    unauthenticated: "Logg inn på nytt.",
    invalid_request: "Noe mangler i skjemaet.",
    temporary_failure: "Tjenesten svarte ikke. Prøv igjen.",
    temporarily_unavailable: "Tjenesten svarte ikke. Prøv igjen.",
    verification_failed: "Filen ble ikke godkjent. Bruk en ekte PDF, JPEG eller PNG.",
    not_available: "Eksporten er ikke klar ennå.",
    version_conflict: "Kontrakten er endret. Åpne den på nytt.",
  }[text];
  if (known) return known;
  if (/permission|not authorized|42501|row-level|policy/i.test(text)) return "Du har ikke tilgang til den handlingen.";
  return "Handlingen kunne ikke lagres.";
};
const row = (title, meta, sub) => {
  const item = document.createElement("li");
  item.className = "portal-item";
  const top = document.createElement("div");
  top.className = "portal-item-top";
  const heading = document.createElement("p");
  heading.className = "portal-item-title";
  heading.textContent = title;
  top.append(heading);
  if (meta) {
    const chip = document.createElement("span");
    chip.className = "portal-chip";
    chip.textContent = meta;
    top.append(chip);
  }
  item.append(top);
  if (sub) {
    const line = document.createElement("p");
    line.className = "portal-item-meta";
    line.textContent = sub;
    item.append(line);
  }
  return item;
};
const fill = (list, rows, render, empty) => {
  list.replaceChildren();
  if (!rows?.length) {
    list.append(row(empty, "", ""));
    return;
  }
  for (const entry of rows) list.append(render(entry));
};
const say = (panel, text) => {
  const message = panel?.querySelector("[data-form-message]");
  if (!message) return;
  message.hidden = !text;
  message.textContent = text ?? "";
};
const options = (select, entries) => {
  select.replaceChildren();
  for (const [value, label] of entries) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
};
const action = (label, onClick) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "portal-mini";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
};
const yearBounds = (year) => ({ start: `${year}-01-01`, end: `${Number(year) + 1}-01-01` });
const minorOf = (value) => Math.round(Number(value) * 100);
const mimeOf = (file) => {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return "";
};
const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};

export function bindPortalViews(supabase, context) {
  const root = document.querySelector("[data-portal]");
  if (!root) return;
  const loaded = new Set();
  let chatId = null;
  let current = "oversikt";
  const accountViews = new Set(["invitasjoner", "data"]);

  const propertyChoices = () => {
    const selected = context.selectedId?.();
    const all = context.properties().map((item) => [item.id, context.propertyName(item.id)]);
    return selected ? all.filter(([id]) => id === selected) : all;
  };
  const tenancyChoices = () => {
    const selected = context.selectedId?.();
    return context
      .tenancies()
      .filter((item) => !selected || item.property_id === selected)
      .map((item) => [item.id, `${context.propertyName(item.property_id) || "Leieforhold"} · ${item.status}`]);
  };

  const fillChoices = () => {
    const properties = propertyChoices();
    const tenancies = tenancyChoices();
    root.querySelectorAll('select[name="property"]').forEach((select) => {
      const current = select.value;
      options(select, properties.length ? properties : [["", "Ingen bolig ennå"]]);
      if (current) select.value = current;
    });
    root.querySelectorAll('select[name="tenancy"]').forEach((select) => {
      options(select, tenancies.length ? tenancies : [["", "Ingen leieforhold ennå"]]);
    });
    const sections = root.querySelector('select[name="section"]');
    if (sections && !sections.options.length) options(sections, Object.entries(HANDBOOK));
    const category = root.querySelector("[data-economy-form] select[name=category]");
    const type = root.querySelector("[data-economy-form] select[name=type]");
    if (category && type && !category.options.length) syncCategories();
    const date = root.querySelector("[data-economy-form] input[name=date]");
    if (date && !date.value) date.value = new Date().toISOString().slice(0, 10);
    const year = root.querySelector("[data-economy-year]");
    if (year && !year.value) year.value = String(new Date().getFullYear());
    for (const selector of ["[data-mileage-form] input[name=date]", "[data-asset-form] input[name=date]", "[data-contract-form] input[name=start]"]) {
      const field = root.querySelector(selector);
      if (field && !field.value) field.value = new Date().toISOString().slice(0, 10);
    }
  };

  const syncCategories = () => {
    const form = root.querySelector("[data-economy-form]");
    if (!form) return;
    const keys = form.type.value === "expense" ? EXPENSE : INCOME;
    options(form.category, keys.map((key) => [key, CATEGORY[key]]));
  };

  const show = (name) => {
    current = name;
    fillChoices();
    root.querySelectorAll(".portal-tabs [data-view], .property-rail [data-view]").forEach((button) => {
      if (button.dataset.view === name) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    root.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== name;
    });
    const tabs = root.querySelector(".portal-tabs");
    if (tabs) tabs.hidden = !context.selectedId?.() || accountViews.has(name);
    if (!accountViews.has(name) && !context.selectedId?.()) return;
    if (name !== "oversikt") load(name, true);
    else context.onSelect?.();
  };

  const paintRail = () => {
    const rail = root.querySelector("[data-property-rail]");
    if (!rail) return;
    const selected = context.selectedId?.();
    rail.replaceChildren();
    const properties = context.properties();
    if (!properties.length) {
      const empty = document.createElement("p");
      empty.className = "portal-lead";
      empty.textContent = "Ingen boliger ennå";
      rail.append(empty);
      return;
    }
    for (const property of properties) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.propertyId = property.id;
      if (property.id === selected) {
        button.setAttribute("aria-current", "true");
        const mark = document.createElement("span");
        mark.className = "rail-kicker";
        mark.textContent = "Valgt";
        button.append(mark);
      }
      const address = document.createElement("span");
      address.className = "rail-address";
      address.textContent = context.propertyName(property.id);
      button.append(address);
      const place = context.propertyPlace?.(property.id);
      if (place) {
        const line = document.createElement("span");
        line.className = "rail-place";
        line.textContent = place;
        button.append(line);
      }
      button.addEventListener("click", () => chooseProperty(property.id));
      rail.append(button);
    }
    const tabs = root.querySelector(".portal-tabs");
    if (tabs) tabs.hidden = !selected || accountViews.has(current);
    if (selected) root.dataset.property = selected;
    else delete root.dataset.property;
  };

  const chooseProperty = (id) => {
    context.select?.(id);
    loaded.clear();
    chatId = null;
    paintRail();
    context.onSelect?.();
    if (accountViews.has(current)) show("oversikt");
    else show(current || "oversikt");
  };

  root.querySelectorAll(".portal-tabs [data-view], .property-rail [data-view]").forEach((button) => {
    button.addEventListener("click", () => show(button.dataset.view));
  });
  root.querySelector("[data-economy-form] select[name=type]")?.addEventListener("change", syncCategories);
  const forProperty = (query) => {
    const id = context.selectedId?.();
    return id ? query.eq("property_id", id) : query;
  };

  async function load(name, force) {
    if (!force && loaded.has(name)) return;
    loaded.add(name);
    const run = {
      okonomi: economy,
      vedlikehold: maintenance,
      kalender: calendar,
      boligperm: handbook,
      dokumenter: documents,
      samtaler: conversations,
      overtakelse: inspections,
      kontrakt: contracts,
      invitasjoner: invitations,
      kjorebok: mileage,
      eiendeler: assets,
      husleie: expectedRent,
      data: privacy,
    }[name];
    if (run) await run();
  }
  const reload = (name) => load(name, true);

  async function edge(name, body) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      const error = new Error("not_authenticated");
      error.outcome = "not_authenticated";
      throw error;
    }
    const response = await fetch(`/api/edge/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const type = response.headers.get("Content-Type") ?? "";
    if (type.includes("application/zip") || type.includes("application/octet-stream") || type.includes("application/pdf")) {
      if (!response.ok) {
        const error = new Error("download_failed");
        error.outcome = "temporary_failure";
        throw error;
      }
      return { blob: await response.blob(), disposition: response.headers.get("Content-Disposition") ?? "" };
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.outcome || "failed");
      error.outcome = payload?.outcome;
      throw error;
    }
    return payload;
  }

  async function economy() {
    const panel = root.querySelector('[data-panel="okonomi"]');
    const summary = root.querySelector("[data-economy-summary]");
    const list = root.querySelector("[data-economy-list]");
    const { data, error } = await forProperty(
      supabase
        .from("financial_transactions")
        .select("id, property_id, transaction_type, category, amount_minor, transaction_date, description")
        .is("voided_at", null)
        .order("transaction_date", { ascending: false })
        .limit(100),
    );
    if (error) return fail(list, summary);
    const rows = data ?? [];
    const income = rows.filter((item) => item.transaction_type === "income").reduce((sum, item) => sum + Number(item.amount_minor), 0);
    const expense = rows.filter((item) => item.transaction_type === "expense").reduce((sum, item) => sum + Number(item.amount_minor), 0);
    summary.textContent = rows.length
      ? `Inntekt ${money(income)} · utgift ${money(expense)} · resultat ${money(income - expense)}`
      : "Ingen økonomiposter ennå.";
    fill(list, rows, (item) => {
      const line = row(
        item.description || CATEGORY[item.category] || "Post",
        item.transaction_type === "income" ? money(item.amount_minor) : `−${money(item.amount_minor)}`,
        [when(item.transaction_date), context.propertyName(item.property_id), CATEGORY[item.category]].filter(Boolean).join(" · "),
      );
      const button = action("Annuller", () => voidTransaction(item.id, panel));
      line.append(button);
      return line;
    }, "Ingen økonomiposter ennå.");
    await series(panel);
  }

  async function series(panel) {
    const list = root.querySelector("[data-economy-series]");
    const propertyId = root.querySelector("[data-economy-form] select[name=property]")?.value;
    if (!propertyId) return fill(list, [], null, "Velg en bolig for å se faste poster.");
    const { data, error } = await supabase.rpc("list_financial_transaction_series", { requested_property_id: propertyId });
    if (error) return fill(list, [], null, "Faste poster kunne ikke hentes.");
    const rows = (data ?? []).filter((item) => item.status === "active");
    fill(list, rows, (item) => {
      const line = row(
        item.description || CATEGORY[item.category] || "Fast post",
        money(item.amount_minor),
        [item.frequency, item.day_of_month ? `dag ${item.day_of_month}` : ""].filter(Boolean).join(" · "),
      );
      line.append(action("Avslutt", async () => {
        const { error: endError } = await supabase.rpc("end_financial_transaction_series", { requested_series_id: item.id });
        say(panel, endError ? explain(endError) : "Den faste posten er avsluttet.");
        if (!endError) reload("okonomi");
      }));
      return line;
    }, "Ingen aktive faste poster.");
  }

  async function voidTransaction(id, panel) {
    const { error } = await supabase.rpc("void_financial_transaction", { requested_transaction_id: id });
    say(panel, error ? explain(error) : "");
    if (!error) reload("okonomi");
  }

  async function maintenance() {
    const list = root.querySelector("[data-maintenance-list]");
    const { data, error } = await forProperty(
      supabase
        .from("maintenance_requests")
        .select("id, property_id, title, description, status, priority")
        .order("updated_at", { ascending: false })
        .limit(50),
    );
    if (error) return fail(list);
    const panel = root.querySelector('[data-panel="vedlikehold"]');
    fill(list, data ?? [], (item) => {
      const line = row(item.title || "Oppgave", TASK[item.status] || item.status, context.propertyName(item.property_id));
      line.append(action("Åpne", () => openMaintenance(item, panel)));
      if (item.status === "closed") {
        line.append(action("Gjenåpne", () => maintenanceRpc("reopen_maintenance_request", item.id, panel)));
      } else {
        line.append(action("Lukk", () => maintenanceRpc("close_maintenance_request", item.id, panel)));
      }
      return line;
    }, "Ingen vedlikeholdsoppgaver.");
  }

  async function maintenanceRpc(name, id, panel) {
    const { error } = await supabase.rpc(name, { requested_request_id: id });
    say(panel, error ? explain(error) : "");
    if (!error) reload("vedlikehold");
  }

  async function openMaintenance(item, panel) {
    const box = root.querySelector("[data-maintenance-detail]");
    box.hidden = false;
    box.replaceChildren();
    const title = document.createElement("h3");
    title.textContent = item.title || "Oppgave";
    box.append(title);
    if (item.description) {
      const text = document.createElement("p");
      text.className = "portal-lead";
      text.textContent = item.description;
      box.append(text);
    }
    const { data } = await supabase
      .from("maintenance_events")
      .select("id, event_type, comment, new_value, created_at")
      .eq("maintenance_request_id", item.id)
      .order("created_at", { ascending: true });
    const events = document.createElement("ul");
    events.className = "portal-list";
    fill(events, data ?? [], (event) => row(event.comment || event.event_type || "Hendelse", when(event.created_at), event.new_value || ""), "Ingen kommentarer ennå.");
    box.append(events);
    if (item.status !== "closed") {
      for (const [status, label] of [["in_progress", "Pågår"], ["waiting", "Venter"], ["resolved", "Løst"]]) {
        box.append(action(label, async () => {
          const { error } = await supabase.rpc("set_maintenance_request_status", {
            requested_request_id: item.id,
            requested_status: status,
          });
          say(panel, error ? explain(error) : "");
          if (!error) reload("vedlikehold");
        }));
      }
    }
    const form = document.createElement("form");
    form.className = "portal-form";
    const label = document.createElement("label");
    label.textContent = "Kommentar";
    const input = document.createElement("textarea");
    input.name = "comment";
    input.rows = 2;
    input.maxLength = 1000;
    input.required = true;
    label.append(input);
    const submit = document.createElement("button");
    submit.className = "btn";
    submit.type = "submit";
    submit.textContent = "Legg til kommentar";
    form.append(label, submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const { error } = await supabase.rpc("add_maintenance_comment", {
        requested_request_id: item.id,
        requested_comment: input.value.trim(),
      });
      say(panel, error ? explain(error) : "Kommentaren er lagret.");
      if (!error) openMaintenance(item, panel);
    });
    box.append(form);
  }

  async function calendar() {
    const list = root.querySelector("[data-calendar-list]");
    const { data, error } = await forProperty(
      supabase
        .from("property_calendar_items")
        .select("id, property_id, title, starts_at, due_at, status")
        .order("starts_at", { ascending: true })
        .limit(50),
    );
    if (error) return fail(list);
    const panel = root.querySelector('[data-panel="kalender"]');
    const statusLabel = { active: "Aktiv", completed: "Fullført", cancelled: "Avbrutt" };
    fill(list, data ?? [], (item) => {
      const line = row(item.title || "Hendelse", statusLabel[item.status] || when(item.starts_at || item.due_at), [when(item.starts_at || item.due_at), context.propertyName(item.property_id)].filter(Boolean).join(" · "));
      if (item.status === "active") {
        line.append(action("Fullfør", async () => {
          const { error: doneError } = await supabase.rpc("complete_calendar_item", { requested_calendar_item_id: item.id });
          say(panel, doneError ? explain(doneError) : "");
          if (!doneError) reload("kalender");
        }));
        line.append(action("Avbryt", async () => {
          const { error: cancelError } = await supabase.rpc("cancel_calendar_item", { requested_calendar_item_id: item.id });
          say(panel, cancelError ? explain(cancelError) : "");
          if (!cancelError) reload("kalender");
        }));
      }
      return line;
    }, "Ingen kalenderpunkter.");
  }

  async function handbook() {
    const list = root.querySelector("[data-handbook-list]");
    const { data, error } = await forProperty(
      supabase.from("property_handbook_sections").select("id, property_id, section_key, body").eq("is_enabled", true).order("section_key"),
    );
    if (error) return fail(list);
    fill(
      list,
      (data ?? []).filter((item) => item.body?.trim()),
      (item) => row(HANDBOOK[item.section_key] || "Boligperm", context.propertyName(item.property_id), item.body.trim()),
      "Ingen utfylte boligperm-punkter er synlige for deg.",
    );
  }

  async function documents() {
    const list = root.querySelector("[data-document-list]");
    const selected = context.selectedId?.();
    const properties = context.properties().filter((item) => !selected || item.id === selected);
    const rows = [];
    let failed = false;
    for (const property of properties) {
      const { data, error } = await supabase.rpc("list_property_documents", { requested_property_id: property.id });
      if (error) failed = true;
      for (const item of data ?? []) {
        if (item.status === "ready") rows.push(item);
      }
    }
    if (failed && !rows.length) return fail(list);
    const panel = root.querySelector('[data-panel="dokumenter"]');
    fill(list, rows, (item) => {
      const line = row(item.title || "Dokument", when(item.created_at), context.propertyName(item.property_id));
      if (item.storage_path) {
        line.append(action("Last ned", async () => {
          const { data, error } = await supabase.storage.from("documents").download(item.storage_path);
          if (error || !data) return say(panel, "Filen kunne ikke lastes ned.");
          saveBlob(data, item.original_file_name || "dokument");
        }));
      }
      line.append(action("Slett", async () => {
        try {
          await edge("document-lifecycle", { action: "delete", document_id: item.id });
          say(panel, "Dokumentet er slettet.");
          reload("dokumenter");
        } catch (error) {
          say(panel, explain(error));
        }
      }));
      return line;
    }, "Ingen dokumenter å vise.");
  }

  async function uploadFile(form, kind) {
    const panel = form.closest("[data-panel]");
    const file = form.file.files?.[0];
    const mime = file ? mimeOf(file) : "";
    if (!form.property.value) return say(panel, "Velg en bolig.");
    if (!file || !mime || file.size < 1 || file.size > 10_000_000) return say(panel, "Velg en PDF, JPEG eller PNG under 10 MB.");
    if (kind === "pdf" && mime !== "application/pdf") return say(panel, "Dokumentet må være en PDF.");
    const button = form.querySelector("button[type=submit]");
    if (button) button.disabled = true;
    try {
      const reserved = await edge("document-lifecycle", kind === "pdf"
        ? {
            action: "reserve",
            property_id: form.property.value,
            reservation_key: crypto.randomUUID(),
            title: form.title.value.trim(),
            original_file_name: file.name,
            file_size_bytes: file.size,
          }
        : {
            action: "reserve_financial_evidence",
            property_id: form.property.value,
            reservation_key: crypto.randomUUID(),
            title: form.title.value.trim(),
            original_file_name: file.name,
            file_size_bytes: file.size,
            source_mime_type: mime,
            evidence_kind: form.kind.value,
            source_kind: "files",
          });
      if (reserved?.status !== "ready") {
        const bucket = reserved?.upload?.bucket || "documents";
        const { error: uploadError } = await supabase.storage.from(bucket).upload(reserved.storage_path, file, {
          contentType: reserved?.upload?.content_type || mime,
          upsert: false,
        });
        if (uploadError) throw uploadError;
        await edge("document-lifecycle", kind === "pdf"
          ? { action: "finalize", document_id: reserved.document_id }
          : {
              action: "finalize_financial_evidence",
              document_id: reserved.document_id,
              evidence_kind: form.kind.value,
              source_kind: "files",
            });
      }
      say(panel, "Filen er lagret.");
      form.title.value = "";
      form.file.value = "";
      reload("dokumenter");
    } catch (error) {
      say(panel, explain(error));
    } finally {
      if (button) button.disabled = false;
    }
  }

  const PRIVACY_STATE = {
    processing: "Vi gjør klar eksporten.",
    ready: "Eksporten er klar.",
    failed: "Eksporten feilet.",
    expired: "Eksporten er utløpt.",
    downloaded: "Eksporten er lastet ned.",
  };

  async function privacy() {
    const box = root.querySelector("[data-privacy-status]");
    const panel = root.querySelector('[data-panel="data"]');
    const caseId = sessionStorage.getItem("eu-privacy-case");
    box.replaceChildren();
    if (!caseId) return;
    const { data, error } = await supabase.rpc("get_my_privacy_export_delivery_status", { requested_case_id: caseId });
    if (error) return say(panel, explain(error));
    const status = data?.[0];
    const text = document.createElement("p");
    text.className = "portal-lead";
    text.textContent = PRIVACY_STATE[status?.state] || "Status er ukjent.";
    box.append(text);
    if (status?.state === "ready") {
      box.append(action("Last ned", async () => {
        try {
          const file = await edge("privacy-export-delivery", { action: "download", case_id: caseId });
          saveBlob(file.blob, "enkel-utleie-persondata.zip");
          await edge("privacy-export-delivery", { action: "confirm_saved", case_id: caseId });
          sessionStorage.removeItem("eu-privacy-case");
          say(panel, "Eksporten er lastet ned.");
          privacy();
        } catch (downloadError) {
          say(panel, explain(downloadError));
        }
      }));
    }
  }

  async function conversations() {
    const list = root.querySelector("[data-chat-list]");
    await supabase.rpc("provision_my_chat_conversations");
    const { data, error } = await supabase.rpc("list_my_chat_conversations");
    if (error) return fail(list);
    const selected = context.selectedId?.();
    const rows = (data ?? []).filter((item) => !selected || item.property_id === selected);
    fill(list, rows, (item) => {
      const line = row(item.property_display_name || "Samtale", item.unread_count ? `${item.unread_count} ulest` : item.unit_display_label || "", "");
      line.addEventListener("click", () => openChat(item.conversation_id));
      return line;
    }, "Ingen samtaler ennå.");
  }

  async function openChat(id) {
    chatId = id;
    const thread = root.querySelector("[data-chat-thread]");
    const form = root.querySelector("[data-chat-form]");
    form.hidden = false;
    const { data, error } = await supabase.rpc("list_chat_messages_before", {
      requested_conversation_id: id,
      requested_before_sequence_no: null,
      requested_limit: 50,
    });
    thread.replaceChildren();
    if (error) {
      thread.append(row("Kunne ikke hente meldingene.", "", ""));
      return;
    }
    const messages = [...(data ?? [])].reverse();
    if (!messages.length) thread.append(row("Ingen meldinger ennå.", "", ""));
    let latest = null;
    for (const message of messages) {
      thread.append(row(message.sender_display_name_snapshot || "Melding", when(message.sent_at), message.body));
      if (message.sequence_no != null) latest = message.sequence_no;
    }
    if (latest != null) {
      await supabase.rpc("advance_chat_last_seen", {
        requested_conversation_id: id,
        requested_sequence_no: latest,
      });
    }
  }

  async function inspections() {
    const list = root.querySelector("[data-inspection-list]");
    const { data, error } = await forProperty(
      supabase.from("inspections").select("id, property_id, tenancy_id, type, status, updated_at").order("created_at", { ascending: false }),
    );
    if (error) return fail(list);
    const panel = root.querySelector('[data-panel="overtakelse"]');
    fill(list, data ?? [], (item) => {
      const line = row(
        item.type === "move_out" ? "Utflytting" : "Innflytting",
        item.status === "finalized" ? "Ferdig" : "Utkast",
        context.propertyName(item.property_id),
      );
      line.append(action("Vis sjekkliste", () => showItems(item, line, panel)));
      if (item.status === "draft") {
        line.append(action("Ferdigstill", async () => {
          const { error: doneError } = await supabase.rpc("finalize_inspection", {
            requested_inspection_id: item.id,
            expected_updated_at: item.updated_at,
          });
          say(panel, doneError ? explain(doneError) : "Befaringen er ferdigstilt.");
          if (!doneError) reload("overtakelse");
        }));
      }
      return line;
    }, "Ingen befaringer i databasen ennå.");
  }

  async function showItems(inspection, line, panel) {
    const { data, error } = await supabase
      .from("inspection_items")
      .select("id, area_code, condition, note, sort_order, updated_at")
      .eq("inspection_id", inspection.id)
      .order("sort_order");
    if (error) return say(panel, explain(error));
    line.querySelector("[data-items]")?.remove();
    const box = document.createElement("div");
    box.dataset.items = "";
    for (const item of data ?? []) {
      const label = document.createElement("p");
      label.className = "portal-item-meta";
      label.textContent = `${AREA[item.area_code] || item.area_code}: ${item.condition}${item.note ? ` · ${item.note}` : ""}`;
      box.append(label);
      if (inspection.status === "draft") {
        const note = document.createElement("input");
        note.type = "text";
        note.maxLength = 400;
        note.placeholder = "Notat";
        note.value = item.note || "";
        box.append(note);
        box.append(action(item.condition === "ok" ? "Merk skade" : "Sett til ok", async () => {
          const { error: saveError } = await supabase.rpc("update_inspection_item", {
            requested_item_id: item.id,
            requested_condition: item.condition === "ok" ? "damage" : "ok",
            requested_note: note.value.trim() || null,
            expected_updated_at: item.updated_at,
          });
          say(panel, saveError ? explain(saveError) : "");
          if (!saveError) reload("overtakelse");
        }));
      }
    }
    line.append(box);
  }

  async function contracts() {
    const list = root.querySelector("[data-contract-list]");
    const selected = context.selectedId?.();
    const properties = context.properties().filter((item) => !selected || item.id === selected);
    const rows = [];
    let failed = false;
    for (const property of properties) {
      const { data, error } = await supabase.rpc("list_my_property_rental_agreements", { requested_property_id: property.id });
      if (error) failed = true;
      for (const item of data ?? []) rows.push({ ...item, property_id: property.id });
    }
    if (failed && !rows.length) return fail(list);
    const panel = root.querySelector('[data-panel="kontrakt"]');
    fill(list, rows, (item) => {
      const line = row("Leiekontrakt", CONTRACT_STATUS[item.agreement_status] || item.agreement_status, context.propertyName(item.property_id));
      line.append(action("Vis", () => openContract(item.agreement_id, panel)));
      return line;
    }, "Ingen kontrakter å vise.");
  }

  function safeTerms(terms) {
    if (!terms) return {};
    const hidden = new Set(["landlord_national_id", "tenant_national_id", "payment_account", "deposit_account"]);
    return Object.fromEntries(Object.entries(terms).filter(([key]) => !hidden.has(key)));
  }

  async function openContract(id, panel) {
    const box = root.querySelector("[data-contract-detail]");
    const { data, error } = await supabase.rpc("get_rental_agreement", { requested_agreement_id: id });
    if (error) return say(panel, explain(error));
    const payload = data?.[0]?.payload ?? data?.payload ?? data?.[0];
    const agreement = payload?.agreement;
    const version = payload?.version;
    const terms = version?.snapshot?.terms ?? {};
    box.hidden = false;
    box.replaceChildren();
    const shown = safeTerms(terms);
    const rent = shown.rent_amount_minor != null ? money(shown.rent_amount_minor) : "";
    box.append(row("Leiekontrakt", CONTRACT_STATUS[agreement?.status] || agreement?.status || "", [rent, shown.start_date, shown.lease_term_type].filter(Boolean).join(" · ")));
    for (const party of payload?.parties ?? []) {
      box.append(row(party.display_name || "Part", party.party_role || "", ""));
    }
    if (agreement?.status === "draft" && version?.id) {
      box.append(action("Marker klar til gjennomgang", async () => {
        const { error: readyError } = await supabase.rpc("mark_rental_agreement_ready_for_review", {
          requested_agreement_id: id,
          expected_version_id: version.id,
          expected_draft_revision: agreement.draft_revision,
        });
        say(panel, readyError ? explain(readyError) : "Utkastet er markert klart.");
        if (!readyError) {
          reload("kontrakt");
          openContract(id, panel);
        }
      }));
      box.append(action("Avbryt utkast", async () => {
        const { error: cancelError } = await supabase.rpc("cancel_rental_agreement", {
          requested_agreement_id: id,
          expected_draft_revision: agreement.draft_revision,
          requested_operation_id: crypto.randomUUID(),
        });
        say(panel, cancelError ? explain(cancelError) : "Utkastet er avbrutt.");
        if (!cancelError) reload("kontrakt");
      }));
    }
    if (version?.id && (agreement?.status === "draft" || agreement?.status === "ready_for_review")) {
      box.append(action("Forhåndsvis PDF", async () => {
        try {
          const result = await edge("contract-pdf", {
            agreement_id: id,
            version_id: version.id,
            revision: Number(agreement.draft_revision),
            intent: "preview",
          });
          const binary = atob(result.pdf_base64 || "");
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
          saveBlob(new Blob([bytes], { type: "application/pdf" }), result.filename || "Leiekontrakt.pdf");
        } catch (previewError) {
          say(panel, explain(previewError));
        }
      }));
    }
    if (agreement?.status === "ready_for_review" && version?.id) {
      const form = document.createElement("form");
      form.className = "portal-form";
      form.innerHTML = `<label>Navn<input name="signer" type="text" maxlength="120" required></label><label>Sted<input name="place" type="text" maxlength="80"></label><label>Dato<input name="date" type="date" required></label>`;
      const canvas = document.createElement("canvas");
      canvas.className = "sign-pad";
      canvas.width = 600;
      canvas.height = 180;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#1B3A6B";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      let drawing = false;
      let dirty = false;
      const point = (event) => {
        const rect = canvas.getBoundingClientRect();
        return {
          x: ((event.clientX - rect.left) * canvas.width) / rect.width,
          y: ((event.clientY - rect.top) * canvas.height) / rect.height,
        };
      };
      canvas.addEventListener("pointerdown", (event) => {
        drawing = true;
        dirty = true;
        const next = point(event);
        ctx.beginPath();
        ctx.moveTo(next.x, next.y);
        canvas.setPointerCapture(event.pointerId);
      });
      canvas.addEventListener("pointermove", (event) => {
        if (!drawing) return;
        const next = point(event);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
      });
      canvas.addEventListener("pointerup", () => { drawing = false; });
      const submit = document.createElement("button");
      submit.className = "btn";
      submit.type = "submit";
      submit.textContent = "Signer og lagre PDF";
      form.append(canvas, submit);
      form.date.value = new Date().toISOString().slice(0, 10);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!dirty) return say(panel, "Tegn signaturen i feltet.");
        const jpeg = canvas.toDataURL("image/jpeg", 0.72).split(",")[1] || "";
        try {
          const result = await edge("contract-pdf", {
            agreement_id: id,
            version_id: version.id,
            revision: Number(agreement.draft_revision),
            intent: "deliver",
            landlord_ink: {
              jpeg_base64: jpeg,
              width: canvas.width,
              height: canvas.height,
              signer_name: form.signer.value.trim(),
              place: form.place.value.trim(),
              date: form.date.value,
            },
          });
          say(panel, result?.outcome === "ready" ? "Kontrakten er signert og lagret." : "Signaturen er sendt.");
          reload("kontrakt");
          openContract(id, panel);
        } catch (signError) {
          say(panel, explain(signError));
        }
      });
      box.append(form);
    }
  }

  async function invitations() {
    const list = root.querySelector("[data-invite-list]");
    const coList = root.querySelector("[data-colandlord-list]");
    const panel = root.querySelector('[data-panel="invitasjoner"]');
    const { data, error } = await supabase.rpc("list_pending_tenancy_invitations");
    if (error) return fail(list);
    fill(list, data ?? [], (item) => {
      const line = row(item.property_display_name || "Invitasjon", item.email || "", item.property_location || "");
      line.append(action("Avslå", async () => {
        const { error: declineError } = await supabase.rpc("decline_tenancy_invitation", { requested_invitation_id: item.id });
        say(panel, declineError ? explain(declineError) : "");
        if (!declineError) reload("invitasjoner");
      }));
      return line;
    }, "Ingen ventende invitasjoner.");
    const co = await supabase.rpc("list_my_property_co_landlord_invitations");
    if (co.error) return fill(coList, [], null, "Medutleier-invitasjoner kunne ikke hentes.");
    fill(coList, co.data ?? [], (item) => {
      const line = row(item.property_display_name || "Medutleier", item.inviter_display_name || "", item.property_location || "");
      const id = item.invitation_id;
      line.append(action("Godta", async () => {
        const { error: acceptError } = await supabase.rpc("accept_property_co_landlord_invitation_by_id", { requested_invitation_id: id });
        say(panel, acceptError ? explain(acceptError) : "Du er lagt til som medutleier.");
        if (!acceptError) reload("invitasjoner");
      }));
      line.append(action("Avslå", async () => {
        const { error: declineError } = await supabase.rpc("decline_property_co_landlord_invitation", { requested_invitation_id: id });
        say(panel, declineError ? explain(declineError) : "");
        if (!declineError) reload("invitasjoner");
      }));
      return line;
    }, "Ingen medutleier-invitasjoner.");
  }

  async function mileage() {
    const list = root.querySelector("[data-mileage-list]");
    const propertyId = root.querySelector("[data-mileage-form] select[name=property]")?.value;
    if (!propertyId) return fill(list, [], null, "Velg en bolig.");
    const year = root.querySelector("[data-economy-year]")?.value || new Date().getFullYear();
    const bounds = yearBounds(year);
    const { data, error } = await supabase.rpc("list_mileage_trips", {
      requested_property_id: propertyId,
      requested_start_date: bounds.start,
      requested_end_date: bounds.end,
      requested_offset: 0,
      requested_page_size: 100,
    });
    if (error) return fail(list);
    fill(list, (data ?? []).filter((item) => !item.voided_at), (item) => {
      const km = (Number(item.distance_meters) / 1000).toLocaleString("nb-NO", { maximumFractionDigits: 1 });
      return row(item.purpose || "Kjøretur", `${km} km`, [when(item.trip_date), [item.from_place, item.to_place].filter(Boolean).join(" – "), money(item.amount_minor)].filter(Boolean).join(" · "));
    }, "Ingen kjøreturer i år.");
  }

  async function assets() {
    const list = root.querySelector("[data-asset-list]");
    const propertyId = root.querySelector("[data-asset-form] select[name=property]")?.value;
    if (!propertyId) return fill(list, [], null, "Velg en bolig.");
    const { data, error } = await supabase.rpc("list_property_assets", {
      requested_property_id: propertyId,
      requested_offset: 0,
      requested_page_size: 100,
    });
    if (error) return fail(list);
    fill(list, (data ?? []).filter((item) => !item.disposed_at), (item) => row(item.name, ASSET[item.category] || item.category, [when(item.purchase_date), money(item.purchase_amount_minor)].filter(Boolean).join(" · ")), "Ingen eiendeler.");
  }

  async function expectedRent() {
    const list = root.querySelector("[data-rent-list]");
    const tenancyId = root.querySelector("[data-rent-form] select[name=tenancy]")?.value;
    if (!tenancyId) return fill(list, [], null, "Velg et leieforhold.");
    const { data, error } = await supabase.rpc("list_rent_obligations", { requested_tenancy_id: tenancyId });
    if (error) return fail(list);
    fill(list, data ?? [], (item) => row(money(item.amount_minor), RENT_STATE[item.presentation_state] || item.presentation_state, [when(item.due_date), item.lifecycle_state === "active" ? "" : item.lifecycle_state].filter(Boolean).join(" · ")), "Ingen forventede perioder ennå.");
  }

  function fail(list, summary) {
    if (summary) summary.textContent = "Kunne ikke hentes.";
    fill(list, [], null, "Prøv å laste siden på nytt. Ingenting er endret.");
  }

  root.querySelector("[data-economy-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const panel = form.closest("[data-panel]");
    const amount = minorOf(form.amount.value);
    const repeat = form.repeat.value;
    const payload = {
      requested_property_id: form.property.value,
      requested_transaction_type: form.type.value,
      requested_category: form.category.value,
      requested_amount_minor: amount,
      requested_currency_code: "NOK",
      requested_transaction_date: form.date.value,
      requested_description: form.description.value.trim(),
      requested_counterparty: null,
      requested_maintenance_request_id: null,
      requested_client_request_id: crypto.randomUUID(),
      requested_economy_treatment: "ordinary",
    };
    if (repeat !== "none") {
      payload.requested_frequency = repeat;
      payload.requested_day_of_month = repeat === "monthly" && form.day.value ? Number(form.day.value) : null;
    }
    const { error } = await supabase.rpc(repeat === "none" ? "create_financial_transaction" : "create_recurring_financial_transaction", payload);
    say(panel, error ? explain(error) : "Posten er lagret.");
    if (!error) {
      form.description.value = "";
      form.amount.value = "";
      reload("okonomi");
    }
  });

  root.querySelector("[data-maintenance-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const panel = form.closest("[data-panel]");
    const { error } = await supabase.rpc("create_maintenance_request", {
      requested_property_id: form.property.value,
      requested_tenancy_id: null,
      requested_title: form.title.value.trim(),
      requested_description: form.description.value.trim() || null,
      requested_category: form.category.value,
      requested_priority: form.priority.value,
    });
    say(panel, error ? explain(error) : "Oppgaven er meldt inn.");
    if (!error) {
      form.reset();
      reload("vedlikehold");
    }
  });

  root.querySelector("[data-calendar-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const panel = form.closest("[data-panel]");
    const stamp = new Date(form.when.value).toISOString().replace(/\.\d{3}Z$/, "Z");
    const kind = form.kind.value;
    const repeat = form.repeat.value;
    const payload = {
      requested_property_id: form.property.value,
      requested_tenancy_id: null,
      requested_maintenance_request_id: null,
      requested_title: form.title.value.trim(),
      requested_description: null,
      requested_item_type: kind,
      requested_category: "other",
      requested_starts_at: kind === "event" ? stamp : null,
      requested_due_at: kind === "deadline" ? stamp : null,
      requested_ends_at: null,
      requested_all_day: false,
    };
    if (repeat !== "none") {
      if (!form.until.value) return say(panel, "Velg en sluttdato for gjentakelsen.");
      payload.requested_recurrence_frequency = repeat;
      payload.requested_recurrence_until = form.until.value;
    }
    const { error } = await supabase.rpc(repeat === "none" ? "create_calendar_item" : "create_recurring_calendar_items", payload);
    say(panel, error ? explain(error) : "Lagt i kalenderen.");
    if (!error) {
      form.title.value = "";
      reload("kalender");
    }
  });

  root.querySelector("[data-chat-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const panel = form.closest("[data-panel]");
    if (!chatId) return;
    const { error } = await supabase.rpc("send_chat_message", {
      requested_conversation_id: chatId,
      requested_client_request_id: crypto.randomUUID(),
      requested_body: form.body.value.trim(),
    });
    say(panel, error ? explain(error) : "");
    if (!error) {
      form.body.value = "";
      openChat(chatId);
    }
  });

  root.querySelector("[data-inspection-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const panel = form.closest("[data-panel]");
    if (!form.tenancy.value) return say(panel, "Velg et leieforhold.");
    const { error } = await supabase.rpc("create_inspection", {
      requested_tenancy_id: form.tenancy.value,
      requested_type: form.type.value,
    });
    say(panel, error ? explain(error) : "Befaringen er startet.");
    if (!error) reload("overtakelse");
  });

  root.querySelector("[data-handbook-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const panel = form.closest("[data-panel]");
    const { error } = await supabase.from("property_handbook_sections").upsert(
      {
        property_id: form.property.value,
        section_key: form.section.value,
        is_enabled: true,
        body: form.body.value.trim(),
        link_url: null,
      },
      { onConflict: "property_id,section_key" },
    );
    say(panel, error ? explain(error) : "Boligpermen er oppdatert.");
    if (!error) {
      form.body.value = "";
      reload("boligperm");
    }
  });

  root.querySelector("[data-economy-year-btn]")?.addEventListener("click", async () => {
    const panel = root.querySelector('[data-panel="okonomi"]');
    const propertyId = root.querySelector("[data-economy-form] select[name=property]")?.value;
    const year = Number(root.querySelector("[data-economy-year]")?.value);
    if (!propertyId || !year) return say(panel, "Velg bolig og år.");
    const bounds = yearBounds(year);
    const { data, error } = await supabase.rpc("summarize_financial_transactions", {
      requested_property_id: propertyId,
      requested_start_date: bounds.start,
      requested_end_date: bounds.end,
    });
    if (error) return say(panel, explain(error));
    const summary = Array.isArray(data) ? data[0] : data;
    if (!summary) return say(panel, "Ingen tall for det året.");
    say(panel, `${year}: inntekt ${money(summary.income_minor)} · utgift ${money(summary.expense_minor)} · resultat ${money(summary.net_minor)} · ${summary.transaction_count} poster`);
  });

  root.querySelector("[data-economy-materialize]")?.addEventListener("click", async () => {
    const panel = root.querySelector('[data-panel="okonomi"]');
    const propertyId = root.querySelector("[data-economy-form] select[name=property]")?.value;
    if (!propertyId) return say(panel, "Velg en bolig.");
    const { data, error } = await supabase.rpc("materialize_due_financial_transaction_series", {
      requested_property_id: propertyId,
      requested_as_of: new Date().toISOString().slice(0, 10),
    });
    if (error) return say(panel, explain(error));
    const inserted = (Array.isArray(data) ? data[0] : data)?.inserted_count ?? 0;
    say(panel, inserted ? `${inserted} forfalte poster er opprettet.` : "Ingen nye forfalte poster.");
    reload("okonomi");
  });

  root.querySelector("[data-contract-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const panel = form.closest("[data-panel]");
    const tenancy = context.tenancies().find((item) => item.id === form.tenancy.value);
    if (!tenancy) return say(panel, "Velg et leieforhold.");
    const { data: sessionData } = await supabase.auth.getSession();
    const me = sessionData.session?.user?.id;
    const [tenancyMembers, propertyMembers] = await Promise.all([
      supabase.from("tenancy_members").select("user_id, role").eq("tenancy_id", tenancy.id).is("valid_until", null),
      supabase.from("property_members").select("user_id, role").eq("property_id", tenancy.property_id).is("valid_until", null),
    ]);
    const landlords = (propertyMembers.data ?? []).filter((item) => item.role === "owner" || item.role === "co_landlord").map((item) => item.user_id);
    const tenants = (tenancyMembers.data ?? []).filter((item) => item.role === "tenant").map((item) => item.user_id);
    const parties = [];
    for (const id of (landlords.length ? landlords : me ? [me] : [])) {
      parties.push({ user_id: id, party_role: "landlord", required_to_sign: true, signing_order: parties.length + 1 });
    }
    for (const id of tenants) {
      parties.push({ user_id: id, party_role: "tenant", required_to_sign: true, signing_order: parties.length + 1 });
    }
    if (!tenants.length) return say(panel, "Leietaker må være medlem av leieforholdet før utkastet kan lagres.");
    const deposit = minorOf(form.deposit.value || 0);
    const { error } = await supabase.rpc("create_rental_agreement_draft", {
      requested_tenancy_id: tenancy.id,
      requested_legal_rule_version: "pending_l1_l10",
      requested_language_code: "nb",
      requested_operation_id: crypto.randomUUID(),
      requested_parties: parties,
      requested_snapshot: {
        contract_schema_version: 1,
        terms: {
          lease_term_type: "indefinite",
          start_date: form.start.value,
          rent_amount_minor: minorOf(form.rent.value),
          currency_code: "NOK",
          payment_day: Number(form.payday.value),
          deposit_amount_minor: deposit,
          notice_period_months: Number(form.notice.value),
          included_services: [],
          additional_charges: [],
          security_type: deposit > 0 ? "deposit" : "none",
          security_amount_minor: deposit,
        },
      },
    });
    say(panel, error ? explain(error) : "Utkastet er lagret.");
    if (!error) reload("kontrakt");
  });

  root.querySelector("[data-invite-accept]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const panel = form.closest("[data-panel]");
    const token = form.token.value.trim();
    const { data, error } = await supabase.rpc("accept_tenancy_invitation", { requested_token: token });
    if (error) return say(panel, explain(error));
    const outcome = (Array.isArray(data) ? data[0] : data)?.outcome;
    const text = {
      accepted: "Invitasjonen er godtatt.",
      invalid: "Koden er ikke gyldig.",
      expired: "Invitasjonen er utløpt.",
      already_used: "Invitasjonen er allerede brukt.",
      inactive: "Invitasjonen er ikke lenger aktiv.",
      wrong_account: "Koden hører til en annen konto.",
      email_unconfirmed: "Bekreft e-postadressen før du godtar.",
    }[outcome] || "Invitasjonen kunne ikke godtas.";
    say(panel, text);
    if (outcome === "accepted") {
      form.token.value = "";
      reload("invitasjoner");
    }
  });

  root.querySelector("[data-invite-send]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const panel = form.closest("[data-panel]");
    if (!form.tenancy.value) return say(panel, "Velg et leieforhold.");
    const { data, error } = await supabase.rpc("invite_tenant_to_existing_tenancy", {
      requested_tenancy_id: form.tenancy.value,
      requested_tenant_email: form.email.value.trim(),
    });
    if (error) return say(panel, explain(error));
    const invitationId = (Array.isArray(data) ? data[0] : data)?.invitation_id;
    form.email.value = "";
    if (!invitationId) return say(panel, "Invitasjonen er opprettet.");
    try {
      await edge("send-tenancy-invitation", {
        invitation_id: invitationId,
        request_id: crypto.randomUUID(),
        action: "send",
      });
      say(panel, "Invitasjonen er sendt.");
    } catch {
      say(panel, "Invitasjonen er lagret. E-posten kunne ikke sendes herfra.");
    }
  });

  root.querySelector("[data-mileage-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const panel = form.closest("[data-panel]");
    const meters = Math.round(Number(form.km.value) * 1000);
    const { error } = await supabase.rpc("create_mileage_trip", {
      requested_property_id: form.property.value,
      requested_trip_date: form.date.value,
      requested_distance_meters: meters,
      requested_purpose: form.purpose.value.trim() || null,
      requested_from_place: form.from.value.trim() || null,
      requested_to_place: form.to.value.trim() || null,
      requested_client_request_id: crypto.randomUUID(),
    });
    say(panel, error ? explain(error) : "Turen er lagret.");
    if (!error) {
      form.km.value = "";
      form.purpose.value = "";
      reload("kjorebok");
    }
  });

  root.querySelector("[data-asset-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const panel = form.closest("[data-panel]");
    const years = form.years.value ? Number(form.years.value) : null;
    const { error } = await supabase.rpc("create_property_asset", {
      requested_property_id: form.property.value,
      requested_name: form.name.value.trim(),
      requested_category: form.category.value,
      requested_purchase_date: form.date.value,
      requested_purchase_amount_minor: minorOf(form.amount.value),
      requested_useful_life_years: years,
      requested_notes: form.notes.value.trim() || null,
      requested_client_request_id: crypto.randomUUID(),
    });
    say(panel, error ? explain(error) : "Eiendelen er lagret.");
    if (!error) {
      form.name.value = "";
      form.amount.value = "";
      reload("eiendeler");
    }
  });

  root.querySelector("[data-rent-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    reload("husleie");
  });

  root.querySelector("[data-rent-generate]")?.addEventListener("click", async () => {
    const panel = root.querySelector('[data-panel="husleie"]');
    const tenancyId = root.querySelector("[data-rent-form] select[name=tenancy]")?.value;
    if (!tenancyId) return say(panel, "Velg et leieforhold.");
    const { error } = await supabase.rpc("generate_rent_obligations", {
      requested_tenancy_id: tenancyId,
      requested_through_date: new Date().toISOString().slice(0, 10),
      requested_operation_id: crypto.randomUUID(),
    });
    say(panel, error ? explain(error) : "Forventede perioder er oppdatert. De er ikke innbetalinger.");
    if (!error) reload("husleie");
  });

  root.querySelector("[data-document-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await uploadFile(event.currentTarget, "pdf");
  });

  root.querySelector("[data-receipt-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await uploadFile(event.currentTarget, "evidence");
  });

  root.querySelector("[data-privacy-request]")?.addEventListener("click", async () => {
    const panel = root.querySelector('[data-panel="data"]');
    try {
      const result = await edge("privacy-export-delivery", { action: "request" });
      if (!result?.case_id) throw new Error("temporary_failure");
      sessionStorage.setItem("eu-privacy-case", result.case_id);
      say(panel, "Forespørselen er sendt.");
      await privacy();
    } catch (error) {
      say(panel, explain(error));
    }
  });

  return { refresh: paintRail };
}
