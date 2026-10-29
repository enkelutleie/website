import { supabase, setAuthState, signOut } from "./supabase.js";
import { ICONS } from "./portal-icons.js";
import * as act from "./portal-actions.js";

// Desktop portal. Every query and write runs with the user's own session, so RLS
// and the app's RPCs decide what is allowed. Writes live in portal-actions.js.

const root = document.querySelector("[data-portal]");
const content = root?.querySelector("[data-content]");
const toLogin = () => location.replace("/logg-inn/");

const VISIBLE_TENANCY_STATUSES = ["draft", "invited", "active"];
const OPEN_TASK_STATUSES = ["reported", "in_progress", "waiting"];
const TENANCY_LABEL = { draft: "Utkast", invited: "Invitert", active: "Aktivt" };
const CATEGORY = {
  rent: "Husleie", reimbursement: "Refusjon", other_income: "Annen inntekt", maintenance: "Vedlikehold",
  improvement: "Påkostning", electricity_heating: "Strøm og oppvarming",
  other_expense: "Utgift", furnishings_equipment: "Møbler og inventar",
};
const HANDBOOK_TILES = [
  ["wifi", "Wi-Fi", "wifi", "is-success"],
  ["fuse_box", "Sikringsskap", "fuse", "is-warning"],
  ["stopcock", "Stoppekran", "drop", ""],
  ["waste_sorting", "Søppel og kildesortering", "trash", "is-success"],
  ["keys_access", "Nøkler og adgang", "key", "is-warning"],
  ["house_rules", "Husregler", "rules", ""],
  ["emergency", "Nødinfo", "sos", "is-danger"],
  ["parking", "Parkering og lading", "car", ""],
  ["appliances", "Hvitevarer", "house", ""],
  ["heating_ventilation", "Varme og ventilasjon", "bolt", "is-warning"],
  ["fire_safety", "Brannsikkerhet", "sos", "is-danger"],
  ["common_areas", "Fellesarealer", "building", ""],
  ["mail_packages", "Post", "doc", ""],
  ["maintenance_tips", "Vedlikeholdstips", "wrench", ""],
];

// Sidebar. landlordOnly items are hidden for tenants (no Økonomi for leietaker).
const NAV = [
  { group: null, items: [
    { id: "oversikt", label: "Oversikt", icon: "house" },
    { id: "boliger", label: "Boliger", tenantLabel: "Min bolig", icon: "building" },
    { id: "okonomi", label: "Økonomi", icon: "chart", landlordOnly: true },
  ] },
  { group: "Bolig", items: [
    { id: "om-boligen", label: "Om boligen", icon: "info" },
    { id: "boligperm", label: "Boligperm", icon: "book" },
    { id: "kalender", label: "Kalender", icon: "calendar" },
    { id: "vedlikehold", label: "Vedlikehold", icon: "wrench" },
    { id: "bilder", label: "Bilder", icon: "photo" },
  ] },
  { group: "Leieforhold", items: [
    { id: "inn-utflytting", label: "Inn- og utflytting", icon: "handover" },
    { id: "leiekontrakt", label: "Leiekontrakt", icon: "contract" },
    { id: "dokumenter", label: "Dokumenter", tenantLabel: "Delte dokumenter", icon: "folder" },
    { id: "meldinger", label: "Meldinger", icon: "chat" },
    { id: "historikk", label: "Leiehistorikk", icon: "history", landlordOnly: true },
  ] },
  { group: "Konto", items: [{ id: "innstillinger", label: "Innstillinger", icon: "gear" }] },
];

const state = {
  user: null, name: null, properties: [], tenancies: [], roles: new Map(), tenantOf: new Set(),
  propertyId: null, openTasks: new Map(), cache: new Map(),
};

/* ---------- helpers ---------- */
const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
const icon = (name, cls = "pt-icon-circle") => {
  const el = h("span", cls);
  el.innerHTML = ICONS[name] ?? "";
  return el;
};
const money = (minor) =>
  new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", currencyDisplay: "code" })
    .format(Number(minor) / 100).replace("NOK", "").trim() + " kr";
const dateText = (value) => {
  if (!value) return "";
  const d = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
};
const addressOf = (p) => ({
  line: [p.address_line1, p.address_line2].filter(Boolean).join(", ") || "Bolig uten adresse",
  place: [p.postal_code, p.city].filter(Boolean).join(" "),
});
const property = () => state.properties.find((p) => p.id === state.propertyId) ?? null;
const roleOf = (id) => {
  const r = state.roles.get(id);
  if (r === "owner") return "Utleier";
  if (r === "co_landlord") return "Medutleier";
  if (state.tenancies.some((t) => t.property_id === id && state.tenantOf.has(t.id))) return "Leietaker";
  return null;
};
const isLandlord = () => {
  const r = property() ? roleOf(state.propertyId) : null;
  if (r) return r !== "Leietaker";
  return state.roles.size > 0;
};
const cached = (key, fn) => {
  if (!state.cache.has(key)) state.cache.set(key, fn().catch(() => ({ error: true })));
  return state.cache.get(key);
};

const card = (title, iconName, link) => {
  const c = h("section", "pt-card");
  const head = h("div", "pt-card-head");
  if (iconName) head.append(icon(iconName));
  head.append(h("h2", null, title));
  if (link) {
    const a = h("a", null, link[0]);
    a.href = link[1];
    head.append(a);
  }
  c.append(head);
  return c;
};
const emptyPage = (iconName, title, text) => {
  const c = h("section", "pt-card pt-empty");
  c.append(icon(iconName), h("h2", null, title), h("p", null, text));
  return c;
};
const inline = (text) => h("p", "pt-empty-inline", text);

/* ---------- data (read-only) ---------- */
const transactions = (pid) =>
  cached(`tx:${pid}`, async () => {
    const yearStart = `${new Date().getFullYear()}-01-01`;
    return supabase.from("financial_transactions")
      .select("id, transaction_type, category, amount_minor, transaction_date, description, counterparty, maintenance_request_id, updated_at")
      // As in the app (#1468): future-dated posts (e.g. a recurring series) are not shown yet.
      .eq("property_id", pid).is("voided_at", null).gte("transaction_date", yearStart).lte("transaction_date", todayISO())
      .order("transaction_date", { ascending: false }).limit(1000);
  });
const calendarItems = (pid) =>
  cached(`cal:${pid}`, async () =>
    supabase.from("property_calendar_items").select("id, title, description, item_type, category, all_day, starts_at, due_at, status")
      .eq("property_id", pid).order("starts_at", { ascending: true }).limit(200));
const handbook = (pid) =>
  cached(`hb:${pid}`, async () =>
    supabase.from("property_handbook_sections").select("section_key, body").eq("property_id", pid).eq("is_enabled", true));
const inspections = (pid) =>
  cached(`insp:${pid}`, async () =>
    supabase.from("inspections").select("id, type, status").eq("property_id", pid));
const tenancyPeople = (pid) =>
  cached(`people:${pid}`, async () => {
    const ids = state.tenancies.filter((t) => t.property_id === pid).map((t) => t.id);
    if (!ids.length) return { data: [] };
    const members = await supabase.from("tenancy_members").select("tenancy_id, user_id, role")
      .in("tenancy_id", ids).is("valid_until", null);
    if (members.error) return members;
    const userIds = [...new Set((members.data ?? []).map((m) => m.user_id))];
    const names = await act.linkedContactNames(userIds);
    return { data: (members.data ?? []).map((m) => ({ ...m, name: names.get(m.user_id) ?? null })) };
  });

/* ---------- sections ---------- */
const band = () => {
  const p = property();
  const b = h("section", "pt-band");
  const text = h("div");
  if (p) {
    const a = addressOf(p);
    text.append(h("h2", null, p.unit_identifier ? `${a.line} (${p.unit_identifier})` : a.line), h("p", null, a.place || " "));
  } else {
    text.append(h("h2", null, state.name ? `Hei, ${state.name}` : "Hei!"), h("p", null, "Velkommen til Enkel Utleie"));
  }
  const img = document.createElement("img");
  img.src = "/brand/house-mascot-happy.png?v=2";
  img.alt = "";
  img.width = 120;
  img.height = 120;
  b.append(text, img);
  return b;
};

// PropertyHomeNextStep.swift: Bolig -> Leietaker -> Kontrakt -> Innflytting.
// Completion is stored per property (get/mark_property_home_guide_completed).
const onboarding = async () => {
  const p = property();
  if (!isManager(p.id)) return null;
  const stored = await supabase.rpc("get_property_home_guide_completed", { requested_property_id: p.id });
  if (stored.error || stored.data === true) return null;
  const own = state.tenancies.filter((t) => t.property_id === p.id && !t.archived_at);
  const active = own.filter((t) => t.status === "active");
  const [people, agreements, insp] = await Promise.all([tenancyPeople(p.id), act.listAgreements(p.id), inspections(p.id)]);
  if (people.error || agreements.error || insp.error) return null;
  const hasTenant = (people.data ?? []).some((m) => m.role === "tenant");
  const tenantPending = !hasTenant && own.some((t) => t.status === "invited");
  const byTenancy = (statuses) => new Set((agreements.data ?? []).filter((a) => statuses.includes(a.agreement_status)).map((a) => a.tenancy_id));
  const signedIds = byTenancy(["signed"]);
  const waitingIds = byTenancy(["awaiting_signatures", "partially_signed"]);
  const signed = active.length > 0 && active.every((t) => signedIds.has(t.id));
  const contractWaiting = hasTenant && !signed && active.length > 0 && active.every((t) => signedIds.has(t.id) || waitingIds.has(t.id));
  const moveInStarted = (insp.data ?? []).some((i) => i.type !== "move_out");
  const done = [true, hasTenant, signed, signed && moveInStarted];
  if (done.every(Boolean)) {
    await supabase.rpc("mark_property_home_guide_completed", { requested_property_id: p.id });
    return null;
  }
  const current = done.indexOf(false);
  const wrap = h("section", "pt-onboarding");
  wrap.append(h("p", "pt-label", "Kom i gang"));
  const steps = h("ol", "pt-steps");
  ["Bolig", "Leietaker", "Kontrakt", "Innflytting"].forEach((label, i) => {
    const li = h("li", `pt-step${done[i] ? " is-done" : i === current ? " is-current" : ""}`);
    const dot = h("span", "pt-step-dot");
    if (done[i]) dot.innerHTML = ICONS.check;
    else dot.textContent = String(i + 1);
    li.append(dot, h("span", null, label));
    steps.append(li);
  });
  wrap.append(steps);
  const waiting = (current === 1 && tenantPending) || (current === 2 && contractWaiting);
  if (waiting) {
    wrap.append(h("p", "pt-onboarding-text", current === 1 ? "Venter på at leietaker godtar invitasjonen" : "Venter på leietakers godkjenning og signering"));
    return wrap;
  }
  if (current === 1) wrap.append(button("Inviter leietaker", "pt-btn-primary", () => inviteForm(p.id)));
  else {
    const [label, href] = current === 2 ? ["Skriv leiekontrakt", "#leiekontrakt"] : ["Start innflytting", "#inn-utflytting"];
    const link = h("a", "pt-btn pt-btn-primary", label);
    link.href = href;
    wrap.append(link);
  }
  return wrap;
};

const kpis = async (pid) => {
  const grid = h("section", "pt-kpis");
  const res = await transactions(pid);
  const rows = res.error ? null : res.data ?? [];
  const sum = (type) => (rows ?? []).filter((r) => r.transaction_type === type).reduce((a, r) => a + Number(r.amount_minor), 0);
  const has = rows && rows.length > 0;
  const note = res.error ? "Kunne ikke hentes" : has ? `Hittil i ${new Date().getFullYear()}` : "Ingen poster ennå";
  const income = sum("income");
  const expense = sum("expense");
  const tiles = [
    ["Inntekt", "income", "is-success", "is-income", has ? money(income) : "–", note],
    ["Utgift", "expense", "is-danger", "is-expense", has ? money(expense) : "–", note],
    ["Netto", "net", "", "", has ? money(income - expense) : "–", note],
  ];
  for (const [label, ic, tone, bg, value, n] of tiles) {
    const c = h("section", `pt-card pt-kpi ${bg}`.trim());
    const top = h("div", "pt-kpi-top");
    top.append(icon(ic, `pt-icon-circle ${tone}`.trim()), h("span", null, label));
    c.append(top, h("p", "pt-kpi-value", value), h("p", "pt-kpi-note", n));
    grid.append(c);
  }
  return grid;
};

const calendarCard = async (pid, full = false) => {
  const c = card("Kalender", "calendar", full ? null : ["Se alle", "#kalender"]);
  const res = await calendarItems(pid);
  const items = res.error ? [] : (res.data ?? []).filter((i) => i.status !== "cancelled");
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const eventDays = new Set(items.map((i) => new Date(i.starts_at || i.due_at)).filter((d) => d.getFullYear() === y && d.getMonth() === m).map((d) => d.getDate()));
  c.append(h("p", "pt-cal-title", now.toLocaleDateString("nb-NO", { month: "long", year: "numeric" })));
  const grid = h("div", "pt-cal");
  ["Ma", "Ti", "On", "To", "Fr", "Lø", "Sø"].forEach((d) => grid.append(h("span", "pt-cal-dow", d)));
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  for (let i = 0; i < offset; i++) grid.append(h("span"));
  const days = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    grid.append(h("span", `pt-cal-day${d === now.getDate() ? " is-today" : ""}${eventDays.has(d) ? " has-event" : ""}`, String(d)));
  }
  c.append(grid);
  const upcoming = items.filter((i) => new Date(i.starts_at || i.due_at) >= new Date(y, m, now.getDate())).slice(0, full ? 50 : 3);
  const list = h("ul", "pt-list");
  for (const i of upcoming) {
    const li = h("li", "pt-row");
    const main = h("div", "pt-row-main");
    main.append(h("strong", null, i.title || "Hendelse"), h("span", null, dateText(i.starts_at || i.due_at)));
    li.append(icon("calendar"), main);
    if (full && isManager(pid) && i.status === "active") {
      li.append(
        button("Endre", "pt-btn-soft pt-btn-small", () => calendarForm(pid, i)),
        button("Fullfør", "pt-btn-secondary pt-btn-small", async () => {
          const err = rpcError(await act.completeCalendarItem(i.id));
          if (err) act.toast(err); else refresh("Hendelsen er fullført.");
        }),
        button("Avlys", "pt-btn-quiet-destructive pt-btn-small", async () => {
          if (!(await act.confirmAction({ title: "Avlyse hendelsen?", text: `«${i.title || "Hendelse"}» blir avlyst for alle på boligen.`, confirmLabel: "Avlys" }))) return;
          const err = rpcError(await act.cancelCalendarItem(i.id));
          if (err) act.toast(err); else refresh("Hendelsen er avlyst.");
        }),
      );
    }
    list.append(li);
  }
  if (isManager(pid)) c.append(actionsRow(button("+ Ny hendelse", "pt-btn-primary pt-btn-small", () => calendarForm(pid))));
  if (res.error) c.append(inline("Kalenderen kunne ikke hentes akkurat nå."));
  else if (!upcoming.length) c.append(inline("Ingen kommende hendelser."));
  else c.append(list);
  return c;
};

const tenancyCard = async (pid) => {
  const c = card("Leieforhold", "person");
  const own = state.tenancies.filter((t) => t.property_id === pid);
  if (!own.length) {
    c.append(inline("Ingen leieforhold på denne boligen ennå."));
    if (isManager(pid)) c.append(actionsRow(button("Inviter leietaker", "pt-btn-primary pt-btn-small", () => inviteForm(pid))));
    return c;
  }
  const res = await tenancyPeople(pid);
  for (const t of own) {
    const sub = h("div");
    const head = h("p", "pt-label", "Leietaker");
    const status = h("span", `pt-chip${t.status === "active" ? " is-success" : " is-warning"}`, TENANCY_LABEL[t.status] ?? t.status);
    sub.append(head);
    const list = h("ul", "pt-list");
    const tenants = (res.data ?? []).filter((m) => m.tenancy_id === t.id && m.role === "tenant");
    if (!tenants.length) {
      const li = h("li", "pt-row");
      const main = h("div", "pt-row-main");
      main.append(h("strong", null, "Ingen leietaker registrert"), h("span", null, [dateText(t.start_date) && `fra ${dateText(t.start_date)}`].filter(Boolean).join("")));
      li.append(main, status);
      list.append(li);
    }
    tenants.forEach((m, i) => {
      const li = h("li", "pt-row");
      const name = m.name || "Leietaker";
      li.append(h("span", "pt-avatar pt-avatar-sm", name.charAt(0).toUpperCase()));
      const main = h("div", "pt-row-main");
      main.append(h("strong", null, name), h("span", null, [dateText(t.start_date) && `fra ${dateText(t.start_date)}`, dateText(t.end_date) && `til ${dateText(t.end_date)}`].filter(Boolean).join(" ")));
      li.append(main);
      if (i === 0) li.append(status.cloneNode(true));
      list.append(li);
    });
    sub.append(list);
    if (isManager(pid) && !tenants.length) sub.append(actionsRow(button("Inviter leietaker", "pt-btn-soft pt-btn-small", () => inviteForm(pid, t))));
    c.append(sub);
  }
  // A whole home has one active tenancy; shared housing can invite per room.
  const shared = state.properties.find((x) => x.id === pid)?.housing_kind === "shared";
  if (isManager(pid) && (shared || !own.some((t) => t.status === "active"))) {
    c.append(actionsRow(button("Inviter leietaker", "pt-btn-secondary pt-btn-small", () => inviteForm(pid))));
  }
  return c;
};

const propertiesTable = () => {
  const c = card(isLandlord() ? "Boliger" : "Min bolig", "building");
  const canCreate = isLandlord() || !state.tenantOf.size;
  if (canCreate) c.append(actionsRow(button("Ny bolig", "pt-btn-primary pt-btn-small", () => propertyForm())));
  if (!state.properties.length) {
    c.append(inline("Ingen boliger ennå."));
    return c;
  }
  const wrap = h("div", "pt-table-wrap");
  const table = h("table", "pt-table");
  const thead = h("thead");
  const hr = h("tr");
  ["Adresse", "Postnr. og sted", "Rolle", "Leieforhold", "Åpne saker"].forEach((t, i) => hr.append(h("th", i === 4 ? "is-num" : null, t)));
  thead.append(hr);
  const tbody = h("tbody");
  for (const p of state.properties) {
    const a = addressOf(p);
    const tr = h("tr");
    const addr = h("td");
    const link = h("a", null, p.unit_identifier ? `${a.line} (${p.unit_identifier})` : a.line);
    link.href = "#om-boligen";
    link.addEventListener("click", () => selectProperty(p.id, false));
    addr.append(link);
    const own = state.tenancies.filter((t) => t.property_id === p.id);
    const roleTd = h("td");
    const role = roleOf(p.id);
    if (role) roleTd.append(h("span", "pt-chip", role));
    const open = state.openTasks.get(p.id);
    tr.append(addr, h("td", null, a.place || "–"), roleTd,
      h("td", null, own.length ? own.map((t) => TENANCY_LABEL[t.status] ?? t.status).join(", ") : "Ingen"),
      h("td", "is-num", open == null ? "–" : String(open)));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  c.append(wrap);
  return c;
};

const MONTH_FORMAT = new Intl.DateTimeFormat("nb-NO", { month: "long" });
const transactionRow = (pid, r) => {
  const inc = r.transaction_type === "income";
  const li = h("li", "pt-row");
  const main = h("div", "pt-row-main");
  main.append(h("strong", null, r.description || CATEGORY[r.category] || (inc ? "Inntekt" : "Utgift")), h("span", null, [dateText(r.transaction_date), CATEGORY[r.category]].filter(Boolean).join(" · ")));
  li.append(icon(inc ? "income" : "expense", `pt-icon-circle ${inc ? "is-success" : "is-danger"}`), main,
    h("span", `pt-amount ${inc ? "is-income" : "is-expense"}`, `${inc ? "" : "−"}${money(r.amount_minor)}`));
  if (isManager(pid)) {
    li.append(
      button("Endre", "pt-btn-soft pt-btn-small", () => transactionForm(pid, r.transaction_type, r)),
      button("Slett", "pt-btn-quiet-destructive pt-btn-small", async () => {
        if (!(await act.confirmAction({ title: "Slette posten?", text: `${inc ? "Inntekten" : "Utgiften"} på ${money(r.amount_minor)} blir annullert, som i appen.`, confirmLabel: "Slett" }))) return;
        const err = rpcError(await act.voidTransaction(r.id));
        if (err) act.toast(err); else refresh("Posten er slettet.");
      }),
    );
  }
  return li;
};

// EconomyTransactionMonthCards: one card per month, newest first, with an uppercase month header.
const transactionList = async (pid) => {
  const c = card("Transaksjoner i år", "banknote");
  if (isManager(pid)) {
    c.append(actionsRow(
      button("Ny inntekt", "pt-btn-primary pt-btn-small", () => transactionForm(pid, "income")),
      button("Ny utgift", "pt-btn-secondary pt-btn-small", () => transactionForm(pid, "expense")),
    ));
  }
  const res = await transactions(pid);
  if (res.error) {
    c.append(inline("Transaksjonene kunne ikke hentes."));
    return [c];
  }
  const rows = res.data ?? [];
  if (!rows.length) {
    c.append(inline("Ingen transaksjoner ennå."));
    return [c];
  }
  const months = new Map();
  for (const r of rows) {
    const key = r.transaction_date.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(r);
  }
  const cards = [c];
  for (const [key, list] of months) {
    const m = h("section", "pt-card pt-month");
    m.append(h("h3", "pt-month-title", MONTH_FORMAT.format(new Date(`${key}-01T12:00:00`)).toLocaleUpperCase("nb-NO")));
    const ul = h("ul", "pt-list");
    for (const r of list) ul.append(transactionRow(pid, r));
    m.append(ul);
    cards.push(m);
  }
  return cards;
};

const button = (label, cls, onClick) => {
  const b = h("button", `pt-btn ${cls}`, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
};
const actionsRow = (...buttons) => {
  const row = h("div", "pt-links");
  row.append(...buttons.filter(Boolean));
  return row;
};
const isManager = (pid = state.propertyId) => ["owner", "co_landlord"].includes(state.roles.get(pid));
const isOwner = (pid = state.propertyId) => state.roles.get(pid) === "owner";
let session = null;
const refresh = async (message) => {
  state.cache.clear();
  await load(session, true);
  if (message) act.toast(message);
};
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const rpcError = (res) => (res?.error ? act.explain(res.error) : null);

/* ---------- forms ---------- */
const recurrenceCaption = (frequency, date) =>
  frequency === "monthly" ? `Beløpet registreres automatisk den ${Number((date || todayISO()).slice(8, 10))}. hver måned.`
    : frequency === "weekly" ? "Beløpet registreres automatisk hver uke." : "Beløpet registreres automatisk hvert år.";

// FinancialTransactionComposer: type-specific labels, and income needs a description (#1486).
const transactionForm = (pid, type, row) => {
  const income = type === "income";
  const cats = income ? act.INCOME_CATEGORIES : act.EXPENSE_CATEGORIES;
  const activeTenancy = state.tenancies.find((t) => t.property_id === pid && t.status === "active");
  return act.openForm({
    title: row ? "Endre post" : income ? "Ny inntekt" : "Ny utgift",
    submitLabel: row ? "Lagre endringer" : "Lagre",
    fields: [
      { name: "category", label: "Kategori", type: "select", options: cats, value: row?.category && cats.some(([v]) => v === row.category) ? row.category : cats[0][0], required: true },
      { name: "amount", label: "Beløp", type: "money", value: row ? act.kronerOf(row.amount_minor) : "", required: true, placeholder: "0,00" },
      { name: "date", label: "Dato", type: "date", value: row?.transaction_date ?? todayISO(), required: true },
      income
        ? { name: "description", label: "Hva gjelder inntekten?", type: "text", value: row?.description ?? "", maxLength: 500, required: true, placeholder: "Husleie for oktober" }
        : { name: "description", label: "Hva gjelder utgiften?", type: "text", value: row?.description ?? "", maxLength: 500, placeholder: "Reparasjon av vaskemaskin" },
      { name: "counterparty", label: income ? "Betalt av" : "Butikk eller leverandør", type: "text", value: row?.counterparty ?? "", maxLength: 200 },
      ...(row ? [] : [
        { name: "repeats", label: "Er dette en gjentakende betaling?", type: "select", options: [["no", "Nei"], ["yes", "Ja"]], value: "no", required: true },
        { name: "recurrence", label: "Hvor ofte", type: "select", options: act.RECURRENCE, value: "monthly", required: true, hidden: true, help: " " },
      ]),
    ],
    onChange: (inputs, show) => {
      if (row) return;
      if (inputs.category.value === "rent" && !inputs.repeats.dataset.touched) inputs.repeats.value = "yes";
      inputs.repeats.addEventListener("change", () => { inputs.repeats.dataset.touched = "1"; }, { once: true });
      show("recurrence", inputs.repeats.value === "yes");
      const caption = inputs.recurrence.closest(".pt-field").querySelector(".pt-field-help");
      if (caption) caption.textContent = recurrenceCaption(inputs.recurrence.value, inputs.date.value);
    },
    onSubmit: async (v) => {
      const amountMinor = act.minorOf(v.amount);
      if (!amountMinor || amountMinor <= 0) return "Skriv et gyldig beløp større enn 0.";
      const values = { ...v, type, amountMinor, recurrence: v.repeats === "yes" ? v.recurrence : "none" };
      const res = row ? await act.updateTransaction(row, values) : await act.createTransaction(pid, values, activeTenancy?.id);
      if (res.error) return act.explain(res.error);
      await refresh(row ? "Posten er oppdatert." : "Posten er lagret.");
      return null;
    },
  });
};

const propertyForm = (p) => {
  const use = p?.rental_profile?.home_use;
  // As in the app: only the owner sees «Arkiver bolig», below the save button.
  const footer = p && isOwner(p.id) ? (close) => {
    const box = h("div", "pt-archive-entry");
    box.append(
      button("Arkiver bolig", "pt-btn-quiet-destructive pt-btn-small", () => { close(); archiveDialog(p); }),
      h("p", "pt-field-help", "Når boligen avsluttes, arkiveres den samtidig og fjernes fra operative oversikter. Historikk og lagrede filer slettes ikke."),
    );
    return box;
  } : undefined;
  return act.openForm({
    footer,
    title: p ? "Rediger informasjon" : "Ny bolig",
    submitLabel: p ? "Lagre endringer" : "Opprett bolig",
    fields: [
      { name: "address", label: "Adresse", type: "text", value: p?.address_line1 ?? "", required: true, maxLength: 160 },
      { name: "unit", label: "Leilighet / enhet", type: "text", value: p?.unit_identifier ?? "", maxLength: 30, help: "For eksempel H0201" },
      { name: "postal", label: "Postnummer", type: "text", value: p?.postal_code ?? "", required: true, maxLength: 4 },
      { name: "city", label: "Poststed", type: "text", value: p?.city ?? "", required: true, maxLength: 100 },
      ...(p ? [] : [{ name: "housingKind", label: "Type bolig", type: "select", options: act.HOUSING_KINDS, value: "standard", required: true, help: "Bofellesskap med rom opprettes i appen." }]),
      { name: "use", label: "Hva leies ut", type: "select", options: act.RENTAL_USE, value: act.RENTAL_USE.some(([v]) => v === use) ? use : "other_home", required: true },
      { name: "finn", label: "Finn-kode", type: "text", value: p?.finn_code ?? "", maxLength: 12 },
      ...(p ? [{ name: "account", label: "Kontonummer for husleie", type: "text", value: p.payment_account_override ?? "", maxLength: 20, help: "Tomt betyr kontonummeret fra profilen din." }] : []),
    ],
    onSubmit: async (v) => {
      const invalid = act.validateProperty(v);
      if (invalid) return invalid;
      if (v.account && v.account.replace(/\D/g, "").length !== 11) return "Kontonummeret må ha 11 siffer.";
      if (!p) {
        const managed = state.properties.filter((x) => isManager(x.id)).length;
        if (managed >= 4) return "Premium dekker inntil fire boliger. Arkiver en bolig under «Rediger informasjon» for å legge til en ny.";
        const res = await act.createProperty(state.user.id, v);
        if (res.error) return act.explain(res.error);
        const id = res.data?.[0]?.id;
        if (id) try { sessionStorage.setItem("pt-property", id); } catch { /* ignore */ }
        await refresh("Boligen er opprettet.");
        location.hash = "#om-boligen";
        return null;
      }
      const res = await act.updateProperty(p, v);
      if (res.error) return act.explain(res.error);
      await refresh("Informasjonen er lagret.");
      return null;
    },
  });
};

const closeSection = (title, rows, note) => {
  const sec = h("section", "pt-sheet-section");
  sec.append(h("h3", "pt-sheet-title", title));
  const ul = h("ul", "pt-sheet-list");
  for (const r of rows) ul.append(h("li", null, r));
  sec.append(ul);
  if (note) sec.append(h("p", "pt-field-help", note));
  return sec;
};

// PropertyCloseConfirmationSheet: inspect first, then close_property with one
// operation id per sheet so a retry is idempotent.
const archiveDialog = async (p) => {
  const res = await act.inspectPropertyClose(p.id);
  if (res.error) return act.toast("Boligen kunne ikke kontrolleres akkurat nå. Prøv igjen.");
  const i = res.data;
  const n = (k) => Number(i[k] ?? 0);
  const blockers = act.closeBlockers(i);
  const sections = [closeSection("Bolig", [addressOf(p).line])];
  if (blockers.length) sections.push(closeSection("Dette må gjøres først", blockers));
  const consequences = ["Boligen arkiveres og skjules fra den aktive listen."];
  if (n("pending_co_landlord_invitation_count")) consequences.push(`${n("pending_co_landlord_invitation_count")} invitasjon til medeier venter fortsatt.`);
  consequences.push("Historikk, dokumenter og økonomi blir liggende.");
  sections.push(closeSection("Dette skjer", consequences));
  sections.push(closeSection("Dette beholdes", [
    `Vedlikehold: ${n("open_maintenance_count")}`,
    `Kalender: ${n("active_calendar_count")}`,
    `Dokumenter: ${n("ready_document_count")}`,
    `Bilder: ${n("ready_image_count")}`,
    `Økonomi: ${n("non_voided_economy_count")}`,
  ], "Disse opplysningene blir værende etter at boligen er arkivert."));
  const operationId = crypto.randomUUID();
  return act.openForm({
    title: "Arkiver bolig",
    intro: "Arkiver boligen når alle leieforhold er avsluttet.",
    sections,
    submitLabel: "Arkiver bolig",
    submitClass: "pt-btn-destructive",
    submitDisabled: blockers.length > 0,
    fields: [{ name: "reason", label: "Årsak", type: "select", options: act.CLOSE_REASONS, value: "management_ended", required: true }],
    onSubmit: async (v) => {
      const out = await act.closeProperty(p.id, v.reason, operationId);
      if (!out.ok) return out.message;
      try { sessionStorage.removeItem("pt-property"); } catch { /* ignore */ }
      await refresh("Boligen er avsluttet og arkivert. Historikken er bevart.");
      location.hash = "#boliger";
      return null;
    },
  });
};

const CLOSE_REASON_LABEL = Object.fromEntries(act.CLOSE_REASONS);
const archivedCard = async () => {
  const c = card("Avsluttede og arkiverte boliger", "history");
  c.append(h("p", "pt-muted", "Se boliger du har avsluttet og arkivert."));
  const res = await act.listClosedProperties();
  if (res.error) {
    c.append(inline("Kunne ikke hente arkivet"));
    return c;
  }
  const rows = res.data ?? [];
  if (!rows.length) {
    c.append(inline("Ingen arkiverte boliger ennå. Når du avslutter en bolig, finner du den her."));
    return c;
  }
  const list = h("ul", "pt-list");
  for (const r of rows) {
    const li = h("li", "pt-row");
    const main = h("div", "pt-row-main");
    main.append(h("strong", null, r.display_address || "Bolig"),
      h("span", null, [r.closed_at ? `Avsluttet ${dateText(r.closed_at)}` : null, `Årsak: ${CLOSE_REASON_LABEL[r.close_reason_code] ?? "Registrert årsak"}`].filter(Boolean).join(" · ")));
    li.append(icon("building"), main, h("span", "pt-chip", "Avsluttet og arkivert"));
    list.append(li);
  }
  c.append(list);
  return c;
};

const photoForm = (p) =>
  act.openForm({
    title: "Last opp bilde",
    intro: "Bildet lagres i boligens album, som i appen. Det gjøres om til JPEG før opplasting.",
    submitLabel: "Last opp",
    fields: [{ name: "file", label: "Bilde", type: "file", accept: "image/*", required: true }],
    onSubmit: async (v) => {
      if (!v.file?.type?.startsWith("image/")) return "Velg en bildefil.";
      const err = await act.uploadPropertyPhoto(p.id, state.user.id, v.file);
      if (err) return err;
      await refresh("Bildet er lastet opp.");
      return null;
    },
  });

const INVITE_PRIVACY = "Leietakeren får sin egen side i appen og har ikke tilgang til din økonomi eller annen privat informasjon.";
const inviteDone = (res) => refresh(res.sent ? "Invitasjonen er sendt." : "Invitasjonen er opprettet, men e-postutsendingen ble ikke bekreftet.");
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const inviteError = (error) => (/active_tenancy|already.*active/i.test(String(error?.message ?? "")) ? "Boligen har allerede et aktivt leieforhold." : act.explain(error));

// TenancyInvitationSheet: only the tenant's e-mail, plus the room for shared housing.
const inviteForm = async (pid, tenancy) => {
  const emailField = { name: "email", label: "E-post", type: "email", required: true, maxLength: 254, placeholder: "leietaker@eksempel.no", help: INVITE_PRIVACY };
  if (tenancy) {
    return act.openForm({
      title: "Inviter leietaker",
      intro: "Legg til leietaker i dette leieforholdet",
      submitLabel: "Send invitasjon",
      fields: [emailField],
      onSubmit: async (v) => {
        if (!validEmail(v.email)) return "Skriv en gyldig e-postadresse.";
        const res = await act.inviteToExisting(tenancy.id, v.email);
        if (res.error) return inviteError(res.error);
        await inviteDone(res);
        return null;
      },
    });
  }
  const p = state.properties.find((x) => x.id === pid);
  let rooms = null;
  if (p?.housing_kind === "shared") {
    const res = await act.invitableRooms(pid);
    if (res.error) return act.toast("Rommene kunne ikke hentes akkurat nå. Prøv igjen.");
    rooms = res.data;
    if (!rooms.length) return act.toast("Ingen rom ennå. Legg til det første rommet.");
    if (rooms.every((r) => r.blocked)) return act.toast("Alle enheter har allerede et aktivt leieforhold. Legg til et rom for å invitere en ny leietaker.");
  }
  const free = rooms?.filter((r) => !r.blocked) ?? [];
  return act.openForm({
    title: "Inviter leietaker",
    submitLabel: "Send invitasjon",
    fields: [
      ...(rooms ? [{
        name: "unit", label: "Utleieenhet", type: "select", required: true, value: free[0]?.id,
        help: "Velg hvilket rom invitasjonen gjelder",
        options: rooms.filter((r) => !r.blocked).map((r) => [r.id, r.label]),
      }] : []),
      emailField,
    ],
    onSubmit: async (v) => {
      if (!validEmail(v.email)) return "Skriv en gyldig e-postadresse.";
      const res = await act.inviteNewTenancy(pid, v.email, rooms ? v.unit : null);
      if (res.error) return inviteError(res.error);
      await inviteDone(res);
      return null;
    },
  });
};

// ContractDraftAuthoringView: every term is optional in a draft (start date too,
// migration contract_draft_without_start_date); the tenancy is untouched until signed.
const contractForm = (pid) => {
  const tenancies = state.tenancies.filter((t) => t.property_id === pid);
  const p = state.properties.find((x) => x.id === pid);
  return act.openForm({
    title: "Ny leiekontrakt",
    intro: "Utkastet lagres med samme felter som i appen. Du kan fylle ut resten senere. Signering skjer i appen.",
    submitLabel: "Lagre utkast",
    fields: [
      { name: "tenancy", label: "Leieforhold", type: "select", required: true, options: tenancies.map((t) => [t.id, `${TENANCY_LABEL[t.status] ?? t.status}${t.start_date ? ` · fra ${dateText(t.start_date)}` : ""}`]) },
      { name: "termType", label: "Avtaletype", type: "select", options: [["indefinite", "Løpende"], ["fixed", "Fast periode"]], value: "indefinite", required: true },
      { name: "start", label: "Startdato", type: "date", value: tenancies[0]?.start_date ?? "" },
      { name: "end", label: "Sluttdato", type: "date", hidden: true },
      { name: "rent", label: "Månedsleie", type: "money" },
      { name: "payday", label: "Betalingsdag (1–31)", type: "number", min: 1, max: 31 },
      { name: "deposit", label: "Depositum", type: "money", help: "Maks seks måneders husleie." },
      { name: "notice", label: "Oppsigelsestid (måneder)", type: "number", min: 1, max: 12, value: "3" },
      { name: "account", label: "Kontonummer for husleie", type: "text", maxLength: 20 },
      { name: "special", label: "Særlige avtaler", type: "textarea", maxLength: 4000 },
    ],
    onChange: (inputs, show) => show("end", inputs.termType.value === "fixed"),
    onSubmit: async (v) => {
      const tenancy = tenancies.find((t) => t.id === v.tenancy);
      if (!tenancy) return "Velg et leieforhold.";
      const rentMinor = v.rent ? act.minorOf(v.rent) : null;
      const depositMinor = v.deposit ? act.minorOf(v.deposit) : null;
      if (v.rent && !rentMinor) return "Skriv en gyldig månedsleie.";
      if (v.deposit && depositMinor == null) return "Skriv et gyldig depositum.";
      if (rentMinor && depositMinor && depositMinor > rentMinor * 6) return "Depositumet kan ikke være mer enn seks måneders husleie.";
      if (v.termType === "fixed" && v.start && v.end && v.end <= v.start) return "Sluttdatoen må være etter startdatoen.";
      if (v.payday && !(Number(v.payday) >= 1 && Number(v.payday) <= 31)) return "Betalingsdagen må være mellom 1 og 31.";
      if (v.notice && !(Number(v.notice) >= 1 && Number(v.notice) <= 12)) return "Oppsigelsestiden må være mellom 1 og 12 måneder.";
      if (v.account && v.account.replace(/\D/g, "").length !== 11) return "Kontonummer må være 11 siffer";
      const res = await act.createAgreementDraft(tenancy, { ...v, rentMinor, depositMinor, housingKind: p?.housing_kind });
      if (res.message) return res.message;
      if (res.error) return act.explain(res.error);
      await refresh("Utkastet er lagret.");
      return null;
    },
  });
};

const localParts = (value) => {
  if (!value) return { date: todayISO(), time: "09:00" };
  const d = new Date(value);
  return {
    date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
  };
};
const calendarForm = (pid, item) => {
  const when = localParts(item?.starts_at || item?.due_at);
  return act.openForm({
    title: item ? "Endre hendelse" : "Ny hendelse",
    submitLabel: item ? "Lagre endringer" : "Legg i kalenderen",
    fields: [
      { name: "title", label: "Tittel", type: "text", value: item?.title ?? "", required: true, maxLength: 200 },
      { name: "kind", label: "Type", type: "select", options: [["event", "Hendelse"], ["deadline", "Frist"]], value: item?.item_type ?? "event", required: true },
      { name: "category", label: "Kategori", type: "select", options: act.CALENDAR_CATEGORIES, value: item?.category ?? "other", required: true },
      { name: "date", label: "Dato", type: "date", value: when.date, required: true },
      { name: "allDay", label: "Hele dagen", type: "select", options: [["false", "Nei"], ["true", "Ja"]], value: item?.all_day ? "true" : "false", required: true },
      { name: "time", label: "Klokkeslett", type: "time", value: when.time },
      { name: "description", label: "Beskrivelse", type: "textarea", value: item?.description ?? "", maxLength: 2000, rows: 3 },
    ],
    onChange: (inputs, show) => show("time", inputs.allDay.value !== "true"),
    onSubmit: async (v) => {
      const res = item ? await act.updateCalendarItem(item.id, v) : await act.createCalendarItem(pid, v);
      if (res.error) return act.explain(res.error);
      await refresh(item ? "Hendelsen er oppdatert." : "Lagt i kalenderen.");
      return null;
    },
  });
};

const handbookForm = (pid, key, label, body) =>
  act.openForm({
    title: label,
    intro: "Teksten blir synlig for leietakerne i boligpermen.",
    submitLabel: "Lagre",
    fields: [{ name: "body", label: "Innhold", type: "textarea", value: body ?? "", maxLength: 4000, rows: 8, required: true }],
    onSubmit: async (v) => {
      const res = await act.saveHandbookSection(pid, key, v.body);
      if (res.error) return act.explain(res.error);
      await refresh("Boligpermen er oppdatert.");
      return null;
    },
  });

const noProperty = () => emptyPage("building", "Ingen bolig valgt", "Når du har en bolig i appen, kan du se den her.");

const PAGES = {
  async oversikt() {
    const out = [band()];
    const p = property();
    if (!p) {
      out.push(propertiesTable());
      return out;
    }
    if (isLandlord()) {
      const ob = await onboarding();
      if (ob) out.push(ob);
      out.push(await kpis(p.id));
    }
    const grid = h("div", "pt-grid-2");
    grid.append(await calendarCard(p.id), await tenancyCard(p.id));
    out.push(grid, propertiesTable());
    return out;
  },
  async boliger() { return [propertiesTable()]; },
  async okonomi() {
    const p = property();
    if (!p) return [noProperty()];
    return [await kpis(p.id), ...(await transactionList(p.id))];
  },
  async "om-boligen"() {
    const p = property();
    if (!p) return [noProperty()];
    const a = addressOf(p);
    const c = card("Om boligen", "house");
    const dl = h("dl", "pt-facts");
    [["Adresse", a.line], ["Postnummer og sted", a.place || "–"], ["Enhet", p.unit_identifier || "–"]].forEach(([k, v]) => {
      const d = h("div");
      d.append(h("dt", null, k), h("dd", null, v));
      dl.append(d);
    });
    const links = h("div", "pt-links");
    [["Boligperm", "#boligperm"], ["Dokumenter og maler", "#dokumenter"], ["Vedlikeholdshistorikk", "#vedlikehold"]].forEach(([t, href]) => {
      const l = h("a", "pt-btn pt-btn-soft pt-btn-small", t);
      l.href = href;
      links.append(l);
    });
    c.append(dl, links);
    const out = [band()];
    const photo = await act.coverPhotoUrl(p.id).catch(() => null);
    if (photo) {
      const img = document.createElement("img");
      img.className = "pt-photo";
      img.src = photo;
      img.alt = `Bilde av ${a.line}`;
      c.prepend(img);
    }
    if (isManager(p.id)) {
      c.append(actionsRow(
        button("Rediger informasjon", "pt-btn-soft pt-btn-small", () => propertyForm(p)),
        button("Last opp bilde", "pt-btn-secondary pt-btn-small", () => photoForm(p)),
      ));
    }
    if (p.finn_code) {
      const d = h("div");
      dl.append(d);
      d.append(h("dt", null, "Finn-kode"), h("dd", null, p.finn_code));
    }
    out.push(c, await tenancyCard(p.id));
    return out;
  },
  async boligperm() {
    const p = property();
    if (!p) return [noProperty()];
    const res = await handbook(p.id);
    const bodies = new Map((res.data ?? []).filter((s) => s.body?.trim()).map((s) => [s.section_key, s.body.trim()]));
    const intro = h("section", "pt-card");
    intro.append(h("p", "pt-muted", isLandlord()
      ? "Boligpermen samler praktisk informasjon om boligen for leietakeren. Trykk Rediger på et kort for å fylle det ut."
      : "All informasjon om boligen, samlet på ett sted."));
    if (res.error) intro.append(inline("Boligpermen kunne ikke hentes akkurat nå."));
    const tiles = h("section", "pt-tiles");
    for (const [key, label, ic, tone] of HANDBOOK_TILES) {
      const t = h("article", "pt-tile");
      t.append(icon(ic, `pt-icon-circle ${tone}`.trim()), h("strong", null, label), h("p", null, bodies.get(key) ?? "Ikke fylt ut"));
      if (isManager(p.id)) t.append(actionsRow(button("Rediger", "pt-btn-soft pt-btn-small", () => handbookForm(p.id, key, label, bodies.get(key)))));
      tiles.append(t);
    }
    return [intro, tiles];
  },
  async kalender() {
    const p = property();
    return p ? [await calendarCard(p.id, true)] : [noProperty()];
  },
  async vedlikehold() {
    const open = state.openTasks.get(state.propertyId);
    return [emptyPage("wrench", "Vedlikehold", `${open != null ? `Åpne saker på boligen: ${open}. ` : ""}Saksliste og detaljer kommer på nettsiden. Til da håndteres vedlikehold i appen.`)];
  },
  async bilder() { return [emptyPage("photo", "Bilder", "Bildealbum for boligen kommer på nettsiden. Til da finner du bildene i appen.")]; },
  async "inn-utflytting"() {
    const p = property();
    if (!p) return [noProperty()];
    const res = await inspections(p.id);
    const rows = res.error ? null : res.data ?? [];
    const status = (type) => {
      if (!rows) return null;
      const list = rows.filter((i) => (type === "move_out" ? i.type === "move_out" : i.type !== "move_out"));
      if (!list.length) return ["Ikke startet", ""];
      return list.some((i) => i.status === "finalized") ? ["Ferdigstilt", " is-success"] : ["Pågår", " is-warning"];
    };
    const info = card("Dokumenter boligens tilstand", "info");
    info.append(h("p", "pt-muted", "Sjekklister ved inn- og utflytting gir en trygg oversikt og kan brukes som dokumentasjon ved depositumsoppgjør."));
    const tiles = h("section", "pt-tiles");
    [["Innflytting", "checklist", "is-success", "Sjekkliste og dokumentasjon", status("move_in")],
      ["Utflytting", "handover", "is-warning", "Sjekkliste og sammenligning med innflytting", status("move_out")],
      ["Depositumsoppgjør", "key", "", "Oppsummering og eventuelle trekk", null]].forEach(([l, ic, tone, txt, st]) => {
      const t = h("article", "pt-tile");
      t.append(icon(ic, `pt-icon-circle ${tone}`.trim()), h("strong", null, l), h("p", null, txt));
      if (st) t.append(h("span", `pt-chip${st[1]}`, st[0]));
      tiles.append(t);
    });
    const out = [info, tiles];
    if (res.error) out.push(inline("Statusen kunne ikke hentes akkurat nå."));
    if (isManager(p.id)) out.push(h("p", "pt-muted", "Innflytting og utflytting er valgfritt. Du kan hoppe over det. Leietaker ser sjekklistene først når du har startet."));
    return out;
  },
  async leiekontrakt() {
    const p = property();
    if (!p) return [noProperty()];
    if (!isManager(p.id)) return [emptyPage("contract", "Leiekontrakt", "Du leser og signerer leiekontrakten i appen.")];
    const c = card("Leiekontrakter", "contract");
    const hasTenancy = state.tenancies.some((t) => t.property_id === p.id);
    c.append(actionsRow(hasTenancy
      ? button("Opprett leiekontrakt", "pt-btn-primary pt-btn-small", () => contractForm(p.id))
      : button("Inviter leietaker først", "pt-btn-secondary pt-btn-small", () => inviteForm(p.id))));
    const res = await act.listAgreements(p.id);
    if (res.error) {
      c.append(inline("Kontraktene kunne ikke hentes akkurat nå."));
      return [c];
    }
    const rows = res.data ?? [];
    if (!rows.length) {
      c.append(inline("Ingen leiekontrakter ennå."));
      return [c];
    }
    const STATUS = { draft: "Utkast", ready_for_review: "Klar til gjennomgang", awaiting_signatures: "Venter på signatur", signed: "Signert", cancelled: "Avbrutt", rejected: "Avvist" };
    const list = h("ul", "pt-list");
    for (const a of rows) {
      const li = h("li", "pt-row");
      const main = h("div", "pt-row-main");
      const t = state.tenancies.find((x) => x.id === a.tenancy_id);
      main.append(h("strong", null, "Leiekontrakt"), h("span", null, t?.start_date ? `Leieforhold fra ${dateText(t.start_date)}` : "Leieforhold"));
      li.append(icon("contract"), main, h("span", `pt-chip${a.agreement_status === "signed" ? " is-success" : ""}`, STATUS[a.agreement_status] ?? a.agreement_status));
      // #1417: drafts and proposals are view-only (no download); signed contracts are downloaded in the app.
      if (a.current_version_id && (a.agreement_status === "draft" || a.agreement_status === "ready_for_review")) {
        li.append(button("Forhåndsvis", "pt-btn-soft pt-btn-small", async (e) => {
          const b = e.currentTarget;
          // Open the tab during the click so the browser does not treat it as a pop-up.
          const tab = window.open("", "_blank");
          b.disabled = true;
          b.textContent = "Lager PDF …";
          const pdf = await act.previewAgreementPdf(a);
          b.disabled = false;
          b.textContent = "Forhåndsvis";
          if (!pdf.url) {
            tab?.close();
            return act.toast(pdf.message);
          }
          if (tab) tab.location.href = pdf.url;
          else act.toast("Tillat nye faner for å forhåndsvise kontrakten.");
          setTimeout(() => URL.revokeObjectURL(pdf.url), 300_000);
        }));
      }
      if (a.agreement_status === "draft") {
        li.append(button("Klar til gjennomgang", "pt-btn-primary pt-btn-small", async () => {
          if (!(await act.confirmAction({ title: "Klar til gjennomgang?", text: "Utkastet låses for gjennomgang. Signering gjøres i appen.", confirmLabel: "Fortsett", destructive: false }))) return;
          const err = rpcError(await act.markAgreementReady(a));
          if (err) act.toast(err); else refresh("Kontrakten er klar til gjennomgang.");
        }));
      }
      list.append(li);
    }
    c.append(list);
    return [c];
  },
  async dokumenter() { return [emptyPage("folder", isLandlord() ? "Dokumenter og maler" : "Delte dokumenter", "Dokumentene kommer på nettsiden. Til da finner du dem i appen.")]; },
  async meldinger() { return [emptyPage("chat", "Meldinger", "Samtaler med utleier og leietaker kommer på nettsiden. Til da bruker du chatten i appen.")]; },
  async historikk() { return [emptyPage("history", "Leiehistorikk", "Ingen tidligere leieforhold ennå.")]; },
  async innstillinger() {
    const c = card("Konto", "person");
    const dl = h("dl", "pt-facts");
    [["Navn", state.name || "–"], ["Rolle", isLandlord() ? "Utleier" : "Leietaker"]].forEach(([k, v]) => {
      const d = h("div");
      d.append(h("dt", null, k), h("dd", null, v));
      dl.append(d);
    });
    const links = h("div", "pt-links");
    const out = h("button", "pt-btn pt-btn-secondary pt-btn-small", "Logg ut");
    out.type = "button";
    out.addEventListener("click", logOut);
    const privacy = h("a", "pt-btn pt-btn-soft pt-btn-small", "Personvern");
    privacy.href = "/personvern";
    links.append(out, privacy);
    c.append(dl, h("p", "pt-muted", "Profil, utseende og abonnement endres i appen."), links);
    return isLandlord() ? [c, await archivedCard()] : [c];
  },
};

/* ---------- shell ---------- */
const visibleNav = () => NAV.map((g) => ({ ...g, items: g.items.filter((i) => !(i.landlordOnly && !isLandlord())) }));
const allItems = () => visibleNav().flatMap((g) => g.items);

const renderNav = (current) => {
  const nav = root.querySelector("[data-nav]");
  nav.replaceChildren();
  const tenant = !isLandlord();
  for (const g of visibleNav()) {
    if (g.group) nav.append(h("p", "pt-nav-group", g.group));
    for (const i of g.items) {
      const a = h("a");
      a.href = `#${i.id}`;
      a.innerHTML = ICONS[i.icon];
      a.append(h("span", null, tenant && i.tenantLabel ? i.tenantLabel : i.label));
      if (i.id === current) a.setAttribute("aria-current", "page");
      nav.append(a);
    }
  }
};

let renderToken = 0;
const render = async () => {
  const items = allItems();
  let id = location.hash.slice(1);
  if (id === "overtakelse") id = "inn-utflytting";
  if (!items.some((i) => i.id === id)) id = "oversikt";
  renderNav(id);
  const item = items.find((i) => i.id === id);
  root.querySelector("[data-page-title]").textContent = !isLandlord() && item.tenantLabel ? item.tenantLabel : item.label;
  const role = property() ? roleOf(state.propertyId) : null;
  root.querySelector("[data-user-role]").textContent = role ?? (state.roles.size ? "Utleier" : "");
  const token = ++renderToken;
  let nodes;
  try {
    nodes = await PAGES[id]();
  } catch {
    nodes = [emptyPage("info", "Noe gikk galt", "Prøv å laste siden på nytt om litt.")];
  }
  if (token !== renderToken) return;
  content.replaceChildren(...nodes);
};

const selectProperty = (id, rerender = true) => {
  state.propertyId = id;
  try { sessionStorage.setItem("pt-property", id); } catch { /* ignore */ }
  const sel = root.querySelector("[data-property-select]");
  if (sel) sel.value = id;
  if (rerender) render();
};

const renderSelect = () => {
  const sel = root.querySelector("[data-property-select]");
  sel.replaceChildren();
  if (!state.properties.length) {
    sel.append(h("option", null, "Ingen boliger"));
    sel.disabled = true;
    return;
  }
  for (const p of state.properties) {
    const o = h("option", null, addressOf(p).line);
    o.value = p.id;
    sel.append(o);
  }
  sel.value = state.propertyId;
  sel.disabled = state.properties.length < 2;
  if (!sel.dataset.bound) {
    sel.dataset.bound = "1";
    sel.addEventListener("change", () => selectProperty(sel.value));
  }
};

const logOut = async () => {
  try { await signOut(); } finally { toLogin(); }
};

const firstNameOf = (profile, user) =>
  profile?.first_name?.trim() || profile?.display_name?.trim() ||
  user?.user_metadata?.full_name?.trim() || user?.user_metadata?.name?.trim() || null;

const premiumGate = (unknown) => {
  root.querySelector("[data-nav]").replaceChildren();
  root.querySelector("[data-page-title]").textContent = "Enkel Utleie Premium";
  const c = emptyPage("house", "Nettportalen er en del av Premium",
    unknown
      ? "Vi fikk ikke sjekket abonnementet ditt akkurat nå. Prøv å laste siden på nytt om litt."
      : "Aktiver Premium i Enkel Utleie-appen på iPhone, så får du tilgang til nettportalen med samme konto.");
  c.append(button("Logg ut", "pt-btn-secondary", logOut));
  content.replaceChildren(c);
};

const load = async (session, isRefresh = false) => {
  const user = session.user;
  state.user = user;
  const [profileRes, propertiesRes, propertyRolesRes, tenancyRolesRes, tenanciesRes, tasksRes] = await Promise.all([
    supabase.from("profiles").select("first_name, display_name").eq("id", user.id).maybeSingle(),
    supabase.from("properties").select("id, address_line1, address_line2, postal_code, city, unit_identifier, housing_kind, rental_profile, finn_code, payment_account_override")
      .eq("lifecycle_status", "active").order("created_at", { ascending: false }),
    supabase.from("property_members").select("property_id, role").eq("user_id", user.id).is("valid_until", null),
    supabase.from("tenancy_members").select("tenancy_id, role").eq("user_id", user.id).is("valid_until", null),
    supabase.from("tenancies").select("id, property_id, status, start_date, end_date")
      .in("status", VISIBLE_TENANCY_STATUSES).is("archived_at", null).order("start_date", { ascending: false }),
    supabase.from("maintenance_requests").select("property_id").in("status", OPEN_TASK_STATUSES),
  ]);
  state.name = firstNameOf(profileRes.data, user);
  state.properties = propertiesRes.data ?? [];
  state.tenancies = tenanciesRes.data ?? [];
  state.roles = new Map((propertyRolesRes.data ?? []).map((r) => [r.property_id, r.role]));
  state.tenantOf = new Set((tenancyRolesRes.data ?? []).filter((r) => r.role === "tenant").map((r) => r.tenancy_id));
  if (!tasksRes.error) {
    for (const p of state.properties) state.openTasks.set(p.id, 0);
    for (const t of tasksRes.data ?? []) state.openTasks.set(t.property_id, (state.openTasks.get(t.property_id) ?? 0) + 1);
  }
  // Premium gate: as in the app, landlords need Premium; tenants use the app for free.
  if (!isRefresh) {
    const managesAny = [...state.roles.values()].some((r) => r === "owner" || r === "co_landlord");
    const tenantOnly = !managesAny && state.tenantOf.size > 0;
    if (!tenantOnly) {
      const premium = await act.hasPremium();
      if (!premium.ok) {
        root.querySelector("[data-user-name]").textContent = state.name || "Min side";
        root.querySelector("[data-avatar]").textContent = (state.name || "?").charAt(0).toUpperCase();
        root.setAttribute("aria-busy", "false");
        premiumGate(premium.unknown);
        return;
      }
    }
  }
  let saved = null;
  try { saved = sessionStorage.getItem("pt-property"); } catch { /* ignore */ }
  state.propertyId = state.properties.some((p) => p.id === saved) ? saved : state.properties[0]?.id ?? null;

  root.querySelector("[data-user-name]").textContent = state.name || "Min side";
  root.querySelector("[data-avatar]").textContent = (state.name || "?").charAt(0).toUpperCase();
  const bell = root.querySelector("[data-bell]");
  bell.innerHTML = ICONS.bell;
  root.setAttribute("aria-busy", "false");
  renderSelect();
  if (propertiesRes.error && !state.properties.length) {
    renderNav("oversikt");
    content.replaceChildren(emptyPage("info", "Vi fikk ikke hentet oversikten", "Prøv å laste siden på nytt om litt. Alt er tilgjengelig i appen i mellomtiden."));
    return;
  }
  if (!isRefresh) window.addEventListener("hashchange", render);
  await render();
};

if (root) {
  root.querySelector("[data-sign-out]")?.addEventListener("click", logOut);
  if (document.documentElement.getAttribute("data-auth") !== "in") {
    toLogin();
  } else {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setAuthState(false);
      toLogin();
    } else {
      supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
          setAuthState(false);
          toLogin();
        }
      });
      session = data.session;
      supabase.auth.onAuthStateChange((_event, next) => {
        if (next) session = next;
      });
      try {
        await load(data.session);
      } catch {
        root.setAttribute("aria-busy", "false");
        content.replaceChildren(emptyPage("info", "Vi fikk ikke hentet oversikten", "Prøv å laste siden på nytt om litt."));
      }
    }
  }
}
