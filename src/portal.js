import { supabase, setAuthState, signOut } from "./supabase.js";
import { ICONS } from "./portal-icons.js";

// Desktop portal. Read-only: every query runs with the user's own session, so RLS
// decides what is visible. Nothing here inserts, updates or deletes data.

const root = document.querySelector("[data-portal]");
const content = root?.querySelector("[data-content]");
const toLogin = () => location.replace("/logg-inn/");

const VISIBLE_TENANCY_STATUSES = ["draft", "invited", "active"];
const OPEN_TASK_STATUSES = ["reported", "in_progress", "waiting"];
const TENANCY_LABEL = { draft: "Utkast", invited: "Invitert", active: "Aktivt" };
const CATEGORY = {
  rent: "Husleie", reimbursement: "Refusjon", other_income: "Annen inntekt", maintenance: "Vedlikehold",
  improvement: "Påkostning", electricity_heating: "Strøm og oppvarming",
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
    { id: "overtakelse", label: "Overtakelse", icon: "handover" },
    { id: "inn-utflytting", label: "Inn-/utflytting", icon: "checklist" },
    { id: "leiekontrakt", label: "Leiekontrakt", icon: "contract" },
    { id: "dokumenter", label: "Dokumenter", tenantLabel: "Delte dokumenter", icon: "folder" },
    { id: "meldinger", label: "Meldinger", icon: "chat" },
    { id: "historikk", label: "Historikk", icon: "history", landlordOnly: true },
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
      .select("id, transaction_type, category, amount_minor, transaction_date, description")
      .eq("property_id", pid).is("voided_at", null).gte("transaction_date", yearStart)
      .order("transaction_date", { ascending: false }).limit(1000);
  });
const calendarItems = (pid) =>
  cached(`cal:${pid}`, async () =>
    supabase.from("property_calendar_items").select("id, title, starts_at, due_at, status")
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
    const profiles = userIds.length
      ? await supabase.from("profiles").select("id, first_name, display_name").in("id", userIds)
      : { data: [] };
    const names = new Map((profiles.data ?? []).map((p) => [p.id, p.display_name?.trim() || p.first_name?.trim() || null]));
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

const onboarding = async () => {
  const p = property();
  const own = state.tenancies.filter((t) => t.property_id === p.id);
  const insp = await inspections(p.id);
  const movedIn = (insp.data ?? []).some((i) => i.type !== "move_out" && i.status === "finalized");
  const done = [true, own.some((t) => t.status === "invited" || t.status === "active"), own.some((t) => t.status === "active"), movedIn];
  if (done.every(Boolean)) return null;
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
  const next = [null, ["Inviter leietaker", "#leiekontrakt"], ["Opprett leiekontrakt", "#leiekontrakt"], ["Start innflytting", "#inn-utflytting"]][current];
  const btn = h("a", "pt-btn pt-btn-primary", next[0]);
  btn.href = next[1];
  const help = [null, "Neste steg er å invitere leietakeren. Det gjør du i appen.", "Neste steg er leiekontrakten. Den lages og signeres i appen.", "Neste steg er innflyttingen med målere, nøkler og sjekkliste."][current];
  wrap.append(steps, btn, h("p", "pt-onboarding-text", help));
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
    ["Skatt", "tax", "is-tax", "", "–", "Skatteestimatet finnes i appen"],
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
    list.append(li);
  }
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
    c.append(sub);
  }
  return c;
};

const propertiesTable = () => {
  const c = card(isLandlord() ? "Boliger" : "Min bolig", "building");
  if (!state.properties.length) {
    c.append(inline("Ingen boliger ennå. Når du legger til en bolig eller blir invitert i appen, dukker den opp her."));
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

const transactionList = async (pid) => {
  const c = card("Transaksjoner i år", "banknote");
  const res = await transactions(pid);
  if (res.error) return c.append(inline("Transaksjonene kunne ikke hentes.")), c;
  const rows = res.data ?? [];
  if (!rows.length) return c.append(inline("Ingen transaksjoner ennå. Inntekter og utgifter registreres i appen.")), c;
  const list = h("ul", "pt-list");
  for (const r of rows.slice(0, 100)) {
    const inc = r.transaction_type === "income";
    const li = h("li", "pt-row");
    const main = h("div", "pt-row-main");
    main.append(h("strong", null, r.description || CATEGORY[r.category] || (inc ? "Inntekt" : "Utgift")), h("span", null, [dateText(r.transaction_date), CATEGORY[r.category]].filter(Boolean).join(" · ")));
    li.append(icon(inc ? "income" : "expense", `pt-icon-circle ${inc ? "is-success" : "is-danger"}`), main,
      h("span", `pt-amount ${inc ? "is-income" : "is-expense"}`, `${inc ? "" : "−"}${money(r.amount_minor)}`));
    list.append(li);
  }
  c.append(list);
  return c;
};

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
    return [await kpis(p.id), await transactionList(p.id)];
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
    return [band(), c, await tenancyCard(p.id)];
  },
  async boligperm() {
    const p = property();
    if (!p) return [noProperty()];
    const res = await handbook(p.id);
    const bodies = new Map((res.data ?? []).filter((s) => s.body?.trim()).map((s) => [s.section_key, s.body.trim()]));
    const intro = h("section", "pt-card");
    intro.append(h("p", "pt-muted", isLandlord()
      ? "Boligpermen samler praktisk informasjon om boligen for leietakeren. Innholdet fylles ut i appen."
      : "All informasjon om boligen, samlet på ett sted."));
    if (res.error) intro.append(inline("Boligpermen kunne ikke hentes akkurat nå."));
    const tiles = h("section", "pt-tiles");
    for (const [key, label, ic, tone] of HANDBOOK_TILES) {
      const t = h("article", "pt-tile");
      t.append(icon(ic, `pt-icon-circle ${tone}`.trim()), h("strong", null, label), h("p", null, bodies.get(key) ?? "Ikke fylt ut"));
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
  async overtakelse() {
    const tiles = h("section", "pt-tiles");
    [["Målere", "bolt", "is-warning", "Strøm, vann og varme med bilde av måleren."], ["Nøkler", "key", "", "Antall og type nøkler som overleveres."], ["Sjekkliste", "checklist", "is-success", "Rom for rom ved inn- og utflytting."]].forEach(([l, ic, tone, txt]) => {
      const t = h("article", "pt-tile");
      t.append(icon(ic, `pt-icon-circle ${tone}`.trim()), h("strong", null, l), h("p", null, txt));
      tiles.append(t);
    });
    return [emptyPage("handover", "Overtakelse", "Overtakelsen fylles ut i appen. Oversikten kommer på nettsiden."), tiles];
  },
  async "inn-utflytting"() { return [emptyPage("checklist", "Inn-/utflytting", "Innflytting, utflytting og depositumsoppgjør kommer på nettsiden. Til da gjøres dette i appen.")]; },
  async leiekontrakt() { return [emptyPage("contract", "Leiekontrakt", "Leiekontrakten lages, leses og signeres i appen. Visning på nettsiden kommer.")]; },
  async dokumenter() { return [emptyPage("folder", isLandlord() ? "Dokumenter og maler" : "Delte dokumenter", "Dokumentene kommer på nettsiden. Til da finner du dem i appen.")]; },
  async meldinger() { return [emptyPage("chat", "Meldinger", "Samtaler med utleier og leietaker kommer på nettsiden. Til da bruker du chatten i appen.")]; },
  async historikk() { return [emptyPage("history", "Historikk", "Tidligere leieforhold og hendelser kommer på nettsiden.")]; },
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
    return [c];
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
  sel.addEventListener("change", () => selectProperty(sel.value));
};

const logOut = async () => {
  try { await signOut(); } finally { toLogin(); }
};

const firstNameOf = (profile, user) =>
  profile?.first_name?.trim() || profile?.display_name?.trim() ||
  user?.user_metadata?.full_name?.trim() || user?.user_metadata?.name?.trim() || null;

const load = async (session) => {
  const user = session.user;
  state.user = user;
  const [profileRes, propertiesRes, propertyRolesRes, tenancyRolesRes, tenanciesRes, tasksRes] = await Promise.all([
    supabase.from("profiles").select("first_name, display_name").eq("id", user.id).maybeSingle(),
    supabase.from("properties").select("id, address_line1, address_line2, postal_code, city, unit_identifier")
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
  window.addEventListener("hashchange", render);
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
      try {
        await load(data.session);
      } catch {
        root.setAttribute("aria-busy", "false");
        content.replaceChildren(emptyPage("info", "Vi fikk ikke hentet oversikten", "Prøv å laste siden på nytt om litt."));
      }
    }
  }
}
