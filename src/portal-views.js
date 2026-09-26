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

const TASK = {
  reported: "Meldt",
  in_progress: "Pågår",
  waiting: "Venter",
  resolved: "Løst",
  closed: "Lukket",
};

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

const money = (minor) =>
  new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" }).format(Number(minor) / 100);

const when = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
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
  if (!rows.length) {
    list.append(row(empty, "", ""));
    return;
  }
  for (const entry of rows) list.append(render(entry));
};

const failed = (list, summary) => {
  if (summary) summary.textContent = "Kunne ikke hentes.";
  fill(list, [], null, "Prøv å laste siden på nytt. Ingenting er endret.");
};

export function bindPortalViews(supabase, propertyName) {
  const root = document.querySelector("[data-portal]");
  if (!root) return;
  const loaded = new Set();

  const show = (name) => {
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

  async function load(name) {
    if (loaded.has(name)) return;
    loaded.add(name);
    if (name === "okonomi") await economy();
    if (name === "vedlikehold") await maintenance();
    if (name === "kalender") await calendar();
    if (name === "boligperm") await handbook();
    if (name === "dokumenter") await documents();
  }

  async function economy() {
    const summary = root.querySelector("[data-economy-summary]");
    const list = root.querySelector("[data-economy-list]");
    const { data, error } = await supabase
      .from("financial_transactions")
      .select("id, property_id, transaction_type, category, amount_minor, transaction_date, description")
      .is("voided_at", null)
      .order("transaction_date", { ascending: false })
      .limit(100);
    if (error) return failed(list, summary);
    const rows = data ?? [];
    const income = rows.filter((item) => item.transaction_type === "income").reduce((sum, item) => sum + Number(item.amount_minor), 0);
    const expense = rows.filter((item) => item.transaction_type === "expense").reduce((sum, item) => sum + Number(item.amount_minor), 0);
    summary.textContent = rows.length
      ? `Inntekt ${money(income)} · utgift ${money(expense)} · resultat ${money(income - expense)}. Bare lesing, ingen nye poster.`
      : "Ingen økonomiposter å vise. Ingenting blir opprettet herfra.";
    fill(
      list,
      rows,
      (item) =>
        row(
          item.description || CATEGORY[item.category] || "Post",
          item.transaction_type === "income" ? money(item.amount_minor) : `−${money(item.amount_minor)}`,
          [when(item.transaction_date), propertyName(item.property_id), CATEGORY[item.category]].filter(Boolean).join(" · "),
        ),
      "Ingen økonomiposter å vise.",
    );
  }

  async function maintenance() {
    const list = root.querySelector("[data-maintenance-list]");
    const { data, error } = await supabase
      .from("maintenance_requests")
      .select("id, property_id, title, status, priority")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) return failed(list);
    fill(
      list,
      data ?? [],
      (item) => row(item.title || "Oppgave", TASK[item.status] || item.status, propertyName(item.property_id)),
      "Ingen vedlikeholdsoppgaver.",
    );
  }

  async function calendar() {
    const list = root.querySelector("[data-calendar-list]");
    const { data, error } = await supabase
      .from("property_calendar_items")
      .select("id, property_id, title, starts_at, due_at, status")
      .order("starts_at", { ascending: true })
      .limit(50);
    if (error) return failed(list);
    fill(
      list,
      data ?? [],
      (item) => row(item.title || "Hendelse", when(item.starts_at || item.due_at), propertyName(item.property_id)),
      "Ingen kalenderpunkter.",
    );
  }

  async function handbook() {
    const list = root.querySelector("[data-handbook-list]");
    const { data, error } = await supabase
      .from("property_handbook_sections")
      .select("id, property_id, section_key, body")
      .eq("is_enabled", true)
      .order("section_key");
    if (error) return failed(list);
    const rows = (data ?? []).filter((item) => item.body?.trim());
    fill(
      list,
      rows,
      (item) => row(HANDBOOK[item.section_key] || "Boligperm", propertyName(item.property_id), item.body.trim()),
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
    if (error) return failed(list);
    fill(
      list,
      data ?? [],
      (item) => row(item.title || "Dokument", when(item.created_at), propertyName(item.property_id)),
      "Ingen dokumenter å vise. Nedlasting kommer sammen med dokumentfasen.",
    );
  }
}
