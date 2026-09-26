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
  const text = error?.message ?? "";
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

export function bindPortalViews(supabase, context) {
  const root = document.querySelector("[data-portal]");
  if (!root) return;
  const loaded = new Set();
  let chatId = null;

  const propertyChoices = () => context.properties().map((item) => [item.id, context.propertyName(item.id)]);
  const tenancyChoices = () =>
    context.tenancies().map((item) => [item.id, `${context.propertyName(item.property_id) || "Leieforhold"} · ${item.status}`]);

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
  };

  const syncCategories = () => {
    const form = root.querySelector("[data-economy-form]");
    if (!form) return;
    const keys = form.type.value === "expense" ? EXPENSE : INCOME;
    options(form.category, keys.map((key) => [key, CATEGORY[key]]));
  };

  const show = (name) => {
    fillChoices();
    root.querySelectorAll("[data-view]").forEach((button) => {
      if (button.dataset.view === name) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    root.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== name;
    });
    if (name !== "oversikt") load(name);
  };

  root.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => show(button.dataset.view));
  });
  root.querySelector("[data-economy-form] select[name=type]")?.addEventListener("change", syncCategories);

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
    }[name];
    if (run) await run();
  }
  const reload = (name) => load(name, true);

  async function economy() {
    const panel = root.querySelector('[data-panel="okonomi"]');
    const summary = root.querySelector("[data-economy-summary]");
    const list = root.querySelector("[data-economy-list]");
    const { data, error } = await supabase
      .from("financial_transactions")
      .select("id, property_id, transaction_type, category, amount_minor, transaction_date, description")
      .is("voided_at", null)
      .order("transaction_date", { ascending: false })
      .limit(100);
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
      const button = document.createElement("button");
      button.type = "button";
      button.className = "portal-mini";
      button.textContent = "Annuller";
      button.addEventListener("click", () => voidTransaction(item.id, panel));
      line.append(button);
      return line;
    }, "Ingen økonomiposter ennå.");
  }

  async function voidTransaction(id, panel) {
    const { error } = await supabase.rpc("void_financial_transaction", { requested_transaction_id: id });
    say(panel, error ? explain(error) : "");
    if (!error) reload("okonomi");
  }

  async function maintenance() {
    const list = root.querySelector("[data-maintenance-list]");
    const { data, error } = await supabase
      .from("maintenance_requests")
      .select("id, property_id, title, status, priority")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) return fail(list);
    const panel = root.querySelector('[data-panel="vedlikehold"]');
    fill(list, data ?? [], (item) => {
      const line = row(item.title || "Oppgave", TASK[item.status] || item.status, context.propertyName(item.property_id));
      if (item.status !== "closed") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "portal-mini";
        button.textContent = "Lukk";
        button.addEventListener("click", async () => {
          const { error: closeError } = await supabase.rpc("close_maintenance_request", { requested_request_id: item.id });
          say(panel, closeError ? explain(closeError) : "");
          if (!closeError) reload("vedlikehold");
        });
        line.append(button);
      }
      return line;
    }, "Ingen vedlikeholdsoppgaver.");
  }

  async function calendar() {
    const list = root.querySelector("[data-calendar-list]");
    const { data, error } = await supabase
      .from("property_calendar_items")
      .select("id, property_id, title, starts_at, due_at, status")
      .order("starts_at", { ascending: true })
      .limit(50);
    if (error) return fail(list);
    const panel = root.querySelector('[data-panel="kalender"]');
    fill(list, data ?? [], (item) => {
      const line = row(item.title || "Hendelse", when(item.starts_at || item.due_at), context.propertyName(item.property_id));
      if (item.status === "active") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "portal-mini";
        button.textContent = "Fullfør";
        button.addEventListener("click", async () => {
          const { error: doneError } = await supabase.rpc("complete_calendar_item", { requested_calendar_item_id: item.id });
          say(panel, doneError ? explain(doneError) : "");
          if (!doneError) reload("kalender");
        });
        line.append(button);
      }
      return line;
    }, "Ingen kalenderpunkter.");
  }

  async function handbook() {
    const list = root.querySelector("[data-handbook-list]");
    const { data, error } = await supabase
      .from("property_handbook_sections")
      .select("id, property_id, section_key, body")
      .eq("is_enabled", true)
      .order("section_key");
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
    const { data, error } = await supabase
      .from("documents")
      .select("id, property_id, title, created_at")
      .eq("status", "ready")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return fail(list);
    fill(
      list,
      data ?? [],
      (item) => row(item.title || "Dokument", when(item.created_at), context.propertyName(item.property_id)),
      "Ingen dokumenter å vise. Opplasting krever fortsatt appen.",
    );
  }

  async function conversations() {
    const list = root.querySelector("[data-chat-list]");
    await supabase.rpc("provision_my_chat_conversations");
    const { data, error } = await supabase.rpc("list_my_chat_conversations");
    if (error) return fail(list);
    fill(list, data ?? [], (item) => {
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
    for (const message of messages) {
      thread.append(row(message.sender_display_name_snapshot || "Melding", when(message.sent_at), message.body));
    }
  }

  async function inspections() {
    const list = root.querySelector("[data-inspection-list]");
    const { data, error } = await supabase
      .from("inspections")
      .select("id, property_id, tenancy_id, type, status, updated_at")
      .order("created_at", { ascending: false });
    if (error) return fail(list);
    const panel = root.querySelector('[data-panel="overtakelse"]');
    fill(list, data ?? [], (item) => {
      const line = row(
        item.type === "move_out" ? "Utflytting" : "Innflytting",
        item.status === "finalized" ? "Ferdig" : "Utkast",
        context.propertyName(item.property_id),
      );
      const button = document.createElement("button");
      button.type = "button";
      button.className = "portal-mini";
      button.textContent = "Vis sjekkliste";
      button.addEventListener("click", () => showItems(item, line, panel));
      line.append(button);
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
    const box = document.createElement("div");
    for (const item of data ?? []) {
      const label = document.createElement("p");
      label.className = "portal-item-meta";
      label.textContent = `${AREA[item.area_code] || item.area_code}: ${item.condition}${item.note ? ` · ${item.note}` : ""}`;
      box.append(label);
      if (inspection.status === "draft") {
        const save = document.createElement("button");
        save.type = "button";
        save.className = "portal-mini";
        save.textContent = item.condition === "ok" ? "Merk skade" : "Sett til ok";
        save.addEventListener("click", async () => {
          const { error: saveError } = await supabase.rpc("update_inspection_item", {
            requested_item_id: item.id,
            requested_condition: item.condition === "ok" ? "damage" : "ok",
            requested_note: item.note,
            expected_updated_at: item.updated_at,
          });
          say(panel, saveError ? explain(saveError) : "");
          if (!saveError) reload("overtakelse");
        });
        box.append(save);
      }
    }
    line.append(box);
  }

  async function contracts() {
    const list = root.querySelector("[data-contract-list]");
    const { data, error } = await supabase
      .from("rental_agreements")
      .select("id, property_id, status, updated_at")
      .order("updated_at", { ascending: false });
    if (error) return fail(list);
    const label = { draft: "Utkast", pending_signature: "Venter signatur", signed: "Signert", cancelled: "Avbrutt" };
    fill(
      list,
      data ?? [],
      (item) => row("Leiekontrakt", label[item.status] || item.status, context.propertyName(item.property_id)),
      "Ingen kontrakter å vise.",
    );
  }

  async function invitations() {
    const list = root.querySelector("[data-invite-list]");
    const { data, error } = await supabase.rpc("list_pending_tenancy_invitations");
    if (error) return fail(list);
    const panel = root.querySelector('[data-panel="invitasjoner"]');
    fill(list, data ?? [], (item) => {
      const line = row(item.property_display_name || "Invitasjon", item.email || "", item.property_location || "");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "portal-mini";
      button.textContent = "Avslå";
      button.addEventListener("click", async () => {
        const { error: declineError } = await supabase.rpc("decline_tenancy_invitation", { requested_invitation_id: item.id });
        say(panel, declineError ? explain(declineError) : "");
        if (!declineError) reload("invitasjoner");
      });
      line.append(button);
      return line;
    }, "Ingen ventende invitasjoner.");
  }

  function fail(list, summary) {
    if (summary) summary.textContent = "Kunne ikke hentes.";
    fill(list, [], null, "Prøv å laste siden på nytt. Ingenting er endret.");
  }

  root.querySelector("[data-economy-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const panel = form.closest("[data-panel]");
    const amount = Math.round(Number(form.amount.value) * 100);
    const { error } = await supabase.rpc("create_financial_transaction", {
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
    });
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
    const { error } = await supabase.rpc("create_calendar_item", {
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
    });
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
}
