import { supabase, setAuthState, signOut } from "./supabase.js";
import { ICONS } from "./portal-icons.js";
import * as act from "./portal-actions.js";
import * as inv from "./portal-inventory.js";
import * as tplt from "./portal-templates.js";
import * as letter from "./portal-letter.js";
import * as annual from "./portal-annual.js";
import * as privacy from "./portal-privacy.js";
import { notificationRoute, notificationText, notificationTitle } from "./portal-notifications.js";

// Desktop portal. Every query and write runs with the user's own session, so RLS
// and the app's RPCs decide what is allowed. Writes live in portal-actions.js.

const root = document.querySelector("[data-portal]");
const content = root?.querySelector("[data-content]");
const toLogin = () => location.replace("/logg-inn/");

const VISIBLE_TENANCY_STATUSES = ["draft", "invited", "active"];
const OPEN_TASK_STATUSES = ["reported", "in_progress", "waiting"];
const TENANCY_LABEL = { draft: "Utkast", invited: "Invitert", active: "Aktivt" };
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
  propertyId: null, openTasks: new Map(), cache: new Map(), receiptFilter: "all",
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
// Answer box under a planned date (MaintenanceView / CalendarView). The green one has a check and no sub-text.
const responseBox = (cls, title, body) => {
  const box = h("div", `pt-mt-response ${cls}`);
  if (cls === "is-success") {
    const head = h("strong", "pt-mt-response-head");
    head.append(icon("check", "pt-mt-response-icon"), h("span", null, title));
    box.append(head);
  } else box.append(h("strong", null, title));
  if (body) box.append(h("p", null, body));
  return box;
};

/* ---------- data (read-only) ---------- */
const transactions = (pid) =>
  cached(`tx:${pid}`, async () => {
    const yearStart = `${new Date().getFullYear()}-01-01`;
    return supabase.from("financial_transactions")
      .select("id, transaction_type, category, legacy_category, amount_minor, transaction_date, description, counterparty, maintenance_request_id, updated_at")
      // As in the app (#1468): future-dated posts (e.g. a recurring series) are not shown yet.
      .eq("property_id", pid).is("voided_at", null).gte("transaction_date", yearStart).lte("transaction_date", todayISO())
      .order("transaction_date", { ascending: false }).limit(1000);
  });
// EconomyController.listDocumentLinks(propertyID): which posts have a receipt.
const receiptLinks = (pid) => cached(`txdoc:${pid}`, () => act.transactionDocLinks(pid));
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
  // FinancialSummary.totals: financing costs are not part of the result.
  const sum = (type) => (rows ?? []).filter((r) => r.transaction_type === type && r.category !== "financing_costs").reduce((a, r) => a + Number(r.amount_minor), 0);
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

const calendarTime = (value) => new Date(value).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
const CALENDAR_STATUS = { active: "Aktiv", completed: "Fullført", cancelled: "Kansellert" };

// #kalender/<id>[/<sak-id>]: one calendar item (CalendarView detail). A maintenance date
// notification carries the case id too, so a missing or cancelled item opens the case instead.
const calendarDetail = async (itemId, requestId) => {
  const res = await act.calendarItem(itemId);
  let item = res.error ? null : res.data;
  if (item && item.property_id !== state.propertyId) {
    if (state.properties.some((p) => p.id === item.property_id)) selectProperty(item.property_id, false);
    else item = null;
  }
  if (!item || item.status === "cancelled") {
    if (requestId && !res.error) {
      location.replace(`#vedlikehold/${requestId}`);
      return [h("p", "pt-muted", "Henter kalenderpunktet …")];
    }
    const back = h("a", "pt-mt-back", "← Kalender");
    back.href = "#kalender";
    if (res.error) return [back, inline("Kalenderpunktet kunne ikke hentes akkurat nå.")];
    return [back, emptyPage("calendar", "Kalenderpunktet er ikke tilgjengelig", "Kalenderpunktet finnes ikke lenger eller er ikke tilgjengelig.")];
  }
  const pid = item.property_id;
  const manager = isManager(pid);
  const back = h("a", "pt-mt-back", "← Kalender");
  back.href = "#kalender";
  const c = card(item.title || "Hendelse", "calendar");
  const deadline = item.item_type === "deadline";
  const at = deadline ? item.due_at || item.starts_at : item.starts_at || item.due_at;
  const facts = h("dl", "pt-facts");
  const when = item.all_day || !at ? dateText(at) : `${dateText(at)} kl. ${calendarTime(at)}`;
  const rows = [
    ["Type", deadline ? "Frist" : "Hendelse"],
    [deadline ? "Frist" : "Start", when + (item.all_day ? " · Hele dagen" : "")],
  ];
  if (item.ends_at && !deadline) rows.push(["Slutt", item.all_day ? dateText(item.ends_at) : `${dateText(item.ends_at)} kl. ${calendarTime(item.ends_at)}`]);
  rows.push(["Status", CALENDAR_STATUS[item.status] ?? "Aktiv"]);
  const cat = act.CALENDAR_CATEGORIES.find(([k]) => k === item.category);
  if (cat) rows.push(["Kategori", cat[1]]);
  rows.forEach(([k, v]) => {
    const d = h("div");
    d.append(h("dt", null, k), h("dd", null, v));
    facts.append(d);
  });
  c.append(facts);
  if (item.description) c.append(h("p", "pt-cal-description", item.description));

  const shared = !!item.tenancy_id && item.status === "active";
  if (shared && manager) {
    const responses = await act.calendarResponses(pid);
    const resp = (responses.data ?? []).find((r) => r.calendar_item_id === item.id);
    const decision = resp?.decision ?? item.tenant_response;
    const comment = resp?.comment ?? item.tenant_response_comment;
    if (decision === "accepted") c.append(responseBox("is-success", "Leietaker har godkjent"));
    else if (decision === "declined") c.append(responseBox("is-danger", "Leietaker har avslått", comment || "Svaret ligger i chatten."));
    else c.append(responseBox("is-warning", "Venter på svar fra leietaker", "Leietaker har ikke svart på hendelsen ennå."));
  } else if (shared && !manager) {
    if (item.tenant_response === "accepted") c.append(responseBox("is-success", "Godkjent av leietaker"));
    else if (item.tenant_response === "declined") c.append(responseBox("is-danger", "Avslaget er sendt i chat", "Svaret ditt er sendt til utleier i chatten."));
    else {
      c.append(responseBox("is-warning", "Passer denne dagen?", "Godta hendelsen, eller avslå og skriv i chatten hvilken dag som passer bedre."));
      const respond = async (decision, comment) => {
        const r = await act.respondToCalendarItem(item.id, decision, comment);
        if (r.error) return "Svaret kunne ikke sendes";
        // iOS #1514: a planned maintenance date (linked case) gets no «Du har godtatt hendelsen».
        await refresh(decision === "declined" ? "Avslaget er sendt i chat" : item.maintenance_request_id ? undefined : "Du har godtatt hendelsen");
        return null;
      };
      c.append(actionsRow(
        button("Godta", "pt-btn-primary pt-btn-small", async (e) => {
          e.currentTarget.disabled = true;
          const err = await respond("accepted");
          if (err) { e.currentTarget.disabled = false; act.toast(err); }
        }),
        button("Avslå", "pt-btn-secondary pt-btn-small", () => act.openForm({
          title: "Avslå hendelsen",
          fields: [{ name: "comment", label: "Kommentar", type: "textarea", rows: 3, maxLength: 1000, placeholder: "Hvilken dag passer bedre?", help: "Kommentaren sendes til utleier i chat, så dere kan avtale en annen dag der." }],
          submitLabel: "Send avslag",
          onSubmit: (v) => respond("declined", v.comment),
        })),
      ));
    }
  }

  const links = [];
  if (item.maintenance_request_id) {
    c.append(h("p", "pt-muted", "Knyttet til vedlikeholdssak"));
    const a = h("a", "pt-btn pt-btn-soft pt-btn-small", "Åpne vedlikeholdssaken");
    a.href = `#vedlikehold/${item.maintenance_request_id}`;
    links.push(a);
  }
  // A planned maintenance date is moved from the case; other items are edited here.
  if (manager && item.status === "active" && !item.maintenance_request_id) {
    links.push(
      button("Rediger", "pt-btn-soft pt-btn-small", () => calendarForm(pid, item)),
      button("Marker som fullført", "pt-btn-secondary pt-btn-small", async () => {
        const err = rpcError(await act.completeCalendarItem(item.id));
        if (err) act.toast(err); else refresh("Hendelsen er fullført.");
      }),
      button("Kanseller kalenderpunktet", "pt-btn-quiet-destructive pt-btn-small", async () => {
        if (!(await act.confirmAction({ title: "Avlyse hendelsen?", text: `«${item.title || "Hendelse"}» blir avlyst for alle på boligen.`, confirmLabel: "Avlys" }))) return;
        const err = rpcError(await act.cancelCalendarItem(item.id));
        if (err) act.toast(err); else { location.hash = "#kalender"; act.toast("Hendelsen er avlyst."); }
      }),
    );
  }
  if (links.length) c.append(actionsRow(...links));
  return [back, c];
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
    const title = h("strong");
    const open = h("a", "pt-row-link", i.title || "Hendelse");
    open.href = `#kalender/${i.id}`;
    open.title = "Åpner kalenderpunktet";
    title.append(open);
    main.append(title, h("span", null, dateText(i.starts_at || i.due_at)));
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
  const [res, inv] = await Promise.all([
    tenancyPeople(pid),
    isManager(pid) ? cached(`inv:${pid}`, () => act.pendingInvitations(own.map((t) => t.id))) : { data: [] },
  ]);
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
    for (const i of (inv.data ?? []).filter((x) => x.tenancy_id === t.id)) list.append(invitationRow(i));
    sub.append(list);
    if (isManager(pid)) {
      sub.append(actionsRow(
        !tenants.length && button("Inviter leietaker", "pt-btn-soft pt-btn-small", () => inviteForm(pid, t)),
        t.status === "active" && button("Avslutt leieforhold", "pt-btn-quiet-destructive pt-btn-small", () => lifecycleForm(t, true)),
        (t.status === "draft" || t.status === "invited") && button("Kanseller leieforhold", "pt-btn-quiet-destructive pt-btn-small", () => lifecycleForm(t, false)),
      ));
    }
    c.append(sub);
  }
  // A whole home has one active tenancy; shared housing can invite per room.
  const shared = state.properties.find((x) => x.id === pid)?.housing_kind === "shared";
  // An invited tenancy already has its own "Inviter leietaker" for a new address.
  if (isManager(pid) && (shared || !own.some((t) => t.status === "active" || t.status === "invited"))) {
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
const transactionRow = (pid, r, docIds = []) => {
  const inc = r.transaction_type === "income";
  const li = h("li", "pt-row");
  const main = h("div", "pt-row-main");
  // EconomyTransactionPresentation.listCopy: a trip expense shows its purpose and «25,5 km», no category.
  const mileage = act.mileageFields(r);
  const category = mileage ? null : act.categoryTitle(r);
  const title = mileage ? mileage.purpose || "Kjørebok" : r.description || category;
  const sub = mileage ? [`${act.kilometerText(mileage.meters)} km`, dateText(r.transaction_date)] : [dateText(r.transaction_date), category];
  main.append(h("strong", null, title), h("span", null, sub.join(" · ")));
  if (mileage) main.append(h("span", "pt-chip", "Kjørebok"));
  li.append(icon(inc ? "income" : "expense", `pt-icon-circle ${inc ? "is-success" : "is-danger"}`), main,
    h("span", `pt-amount ${inc ? "is-income" : "is-expense"}`, `${inc ? "" : "−"}${money(r.amount_minor)}`));
  if (docIds.length) main.append(h("span", "pt-chip is-success", "Kvittering knyttet"));
  if (isManager(pid) && mileage) {
    // The trip owns this expense: it is changed in the mileage log, as in the app.
    const open = h("a", "pt-btn pt-btn-soft pt-btn-small", "Åpne kjørebok");
    open.href = "#okonomi/kjorebok";
    li.append(open);
  } else if (isManager(pid)) {
    li.append(
      button("Kvittering", "pt-btn-soft pt-btn-small", () => receiptDialog(pid, r, docIds)),
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
  const [res, links] = await Promise.all([transactions(pid), receiptLinks(pid)]);
  if (res.error) {
    c.append(inline("Transaksjonene kunne ikke hentes."));
    return [c];
  }
  const docsOf = new Map();
  for (const l of links.data ?? []) docsOf.set(l.transaction_id, [...(docsOf.get(l.transaction_id) ?? []), l.document_id]);
  // EconomyAttachmentFilter: unavailable (with the app's message) when the links fail to load.
  if (links.error) c.append(inline("Kunne ikke hente hvilke poster som har kvittering. Kvitteringsfilteret er utilgjengelig. Prøv igjen."));
  else if ((res.data ?? []).length) {
    const label = h("label", "pt-field pt-filter");
    const select = h("select", "pt-select");
    for (const [v, l] of act.RECEIPT_FILTERS) {
      const o = h("option", null, l);
      o.value = v;
      o.selected = state.receiptFilter === v;
      select.append(o);
    }
    select.addEventListener("change", () => { state.receiptFilter = select.value; render(); });
    label.append(h("span", "pt-field-label", "Kvitteringsfilter"), select);
    c.append(label);
  }
  const filter = links.error ? "all" : state.receiptFilter;
  const rows = (res.data ?? []).filter((r) => filter === "all" || (filter === "withReceipt") === docsOf.has(r.id));
  if (!rows.length) {
    c.append(inline((res.data ?? []).length ? "Ingen poster passer filteret." : "Ingen transaksjoner ennå."));
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
    for (const r of list) ul.append(transactionRow(pid, r, docsOf.get(r.id)));
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
  // Editing shows the bucket (Påkostning/Møbler → «Annen utgift»). An inventory purchase left
  // on «Annen utgift» still saves furnishings_equipment so the server keeps the asset.
  const current = row ? act.effectiveCategory(row.category, row.legacy_category) : null;
  const known = cats.some(([v]) => v === current);
  const keepsFurnishing = !income && act.isFurnishingPurchase(row);
  const options = income && !known ? [["", "Velg kategori"], ...cats] : cats;
  const categoryValue = known ? current : income ? "" : cats[0][0];
  const activeTenancy = state.tenancies.find((t) => t.property_id === pid && t.status === "active");
  return act.openForm({
    title: row ? "Endre post" : income ? "Ny inntekt" : "Ny utgift",
    submitLabel: row ? "Lagre endringer" : "Lagre",
    fields: [
      { name: "category", label: "Kategori", type: "select", options, value: categoryValue, required: true, requiredMessage: "Velg kategori", help: income ? " " : undefined },
      { name: "amount", label: "Beløp", type: "money", value: row ? act.kronerOf(row.amount_minor) : "", required: true, placeholder: "0,00" },
      { name: "date", label: "Dato", type: "date", value: row?.transaction_date ?? todayISO(), required: true },
      income
        ? { name: "description", label: "Hva gjelder inntekten?", type: "text", value: row?.description ?? "", maxLength: 500, required: true, placeholder: "Husleie for oktober" }
        : { name: "description", label: "Hva gjelder utgiften?", type: "text", value: row?.description ?? "", maxLength: 500, placeholder: "Reparasjon av vaskemaskin" },
      { name: "counterparty", label: income ? "Betalt av" : "Butikk eller leverandør", type: "text", value: row?.counterparty ?? "", maxLength: 200 },
      ...(row ? [] : [
        { name: "receipt", label: "Kvittering", type: "file", accept: RECEIPT_ACCEPT, help: "PDF, JPEG eller PNG. Bilder lagres som PDF." },
        { name: "repeats", label: "Er dette en gjentakende betaling?", type: "select", options: [["no", "Nei"], ["yes", "Ja"]], value: "no", required: true },
        { name: "recurrence", label: "Hvor ofte", type: "select", options: act.RECURRENCE, value: "monthly", required: true, hidden: true, help: " " },
      ]),
    ],
    onChange: (inputs, show) => {
      if (income) {
        const help = inputs.category.closest(".pt-field").querySelector(".pt-field-help");
        if (help) help.textContent = act.INCOME_CATEGORY_DETAIL[inputs.category.value] ?? "";
      }
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
      const category = keepsFurnishing && v.category === "miscellaneous_expense" ? "furnishings_equipment" : v.category;
      const values = { ...v, category, type, amountMinor, recurrence: v.repeats === "yes" ? v.recurrence : "none" };
      const res = row ? await act.updateTransaction(row, values) : await act.createTransaction(pid, values, activeTenancy?.id);
      if (res.error) return act.explain(res.error);
      const created = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!row && v.receipt && created?.id) {
        // The post is saved; a failed receipt is reported, not rolled back (as in the app).
        const err = await act.attachReceipt(pid, created.id, v.receipt);
        await refresh(err ? `Posten er lagret, men kvitteringen ble ikke lagret: ${err}` : "Posten og kvitteringen er lagret.");
        return null;
      }
      await refresh(row ? "Posten er oppdatert." : "Posten er lagret.");
      return null;
    },
  });
};

// EconomyTransactionDocumentsSection: «Kvittering og bilag» on one post.
const RECEIPT_ACCEPT = "application/pdf,image/jpeg,image/png";
const receiptDialog = async (pid, r, docIds) => {
  const docs = docIds.length ? await act.receiptDocuments(docIds) : { data: [] };
  const all = await act.linkableDocuments(pid);
  const list = h("ul", "pt-list");
  if (docs.error) list.append(h("li", "pt-row", "Kunne ikke hente dokumentkoblingene. Prøv igjen."));
  else if (!docs.data.length) list.append(h("li", "pt-row", "Ingen kvittering er knyttet ennå. Last opp en, eller koble en eksisterende fil."));
  let closeDialog = () => {};
  for (const d of docs.data ?? []) {
    const li = h("li", "pt-row");
    const main = h("div", "pt-row-main");
    main.append(h("strong", null, d.title || "Kvittering"), h("span", null, d.created_at ? dateText(d.created_at.slice(0, 10)) : ""));
    const actions = h("div", "pt-row-actions");
    actions.append(
      pdfButton("Åpne", "pt-btn-secondary pt-btn-small", () => act.documentPdf(d.id)),
      button("Slett bilde", "pt-btn-quiet-destructive pt-btn-small", async () => {
        if (!(await act.confirmAction({ title: "Slette bildet?", text: "Selve dokumentet slettes ikke, og dokumentdelingen endres ikke.", confirmLabel: "Slett" }))) return;
        const res = await act.unlinkReceipt(r.id, d.id);
        closeDialog();
        if (res.error) act.toast("Kunne ikke fjerne dokumentkoblingen. Prøv igjen.");
        else refresh("Dokumentkoblingen er fjernet.");
      }),
    );
    li.append(main, actions);
    list.append(li);
  }
  const wrap = h("div");
  wrap.append(h("p", "pt-label", "Kvittering og bilag"), list);
  // «Koble dokument»: only ready documents you can read, not already on this post.
  const linkable = (all.data ?? []).filter((d) => d.status === "ready" && !docIds.includes(d.id));
  return act.openForm({
    title: "Kvittering og bilag",
    intro: `${r.description || act.categoryTitle(r)} · ${dateText(r.transaction_date)} · ${money(r.amount_minor)}`,
    sections: [wrap],
    submitLabel: "Lagre",
    footer: (close) => { closeDialog = close; return h("span"); },
    fields: [
      { name: "file", label: "Last opp kvittering", type: "file", accept: RECEIPT_ACCEPT, help: "PDF, JPEG eller PNG. Bilder lagres som PDF." },
      ...(linkable.length ? [{ name: "doc", label: "Koble dokument", type: "select", options: [["", "Ingen"], ...linkable.map((d) => [d.id, d.title || d.original_file_name || "Dokument"])], value: "" }] : []),
    ],
    onSubmit: async (v) => {
      if (!v.file && !v.doc) return "Velg en fil eller et dokument.";
      if (v.file) {
        const err = await act.attachReceipt(pid, r.id, v.file);
        if (err) return err;
      }
      if (v.doc) {
        const res = await act.linkReceipt(r.id, v.doc);
        if (res.error) return "Kunne ikke koble dokumentet. Prøv igjen.";
      }
      await refresh(v.file ? "Kvitteringen er lagret." : "Dokumentet er koblet.");
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
      ...(p ? [] : [
        { name: "housingKind", label: "Type bolig", type: "select", options: act.HOUSING_KINDS, value: "standard", required: true, help: "Ved bofellesskap leies rommene ut hver for seg. Hvert rom har eget leieforhold og egen leiekontrakt." },
        { name: "roomCount", label: "Antall rom som skal leies ut", type: "text", placeholder: "1–10", maxLength: 2, hidden: true, help: "Vi oppretter Rom 1, Rom 2 … slik at du kan invitere én leietaker per rom. Maks 10." },
      ]),
      { name: "use", label: "Hva leies ut", type: "select", options: act.RENTAL_USE, value: act.RENTAL_USE.some(([v]) => v === use) ? use : "other_home", required: true },
      { name: "finn", label: "Finn-kode", type: "text", value: p?.finn_code ?? "", maxLength: 12 },
      ...(p ? [{ name: "account", label: "Kontonummer for husleie", type: "text", value: p.payment_account_override ?? "", maxLength: 20, help: "Tomt betyr kontonummeret fra profilen din." }] : []),
    ],
    onChange: (inputs, show) => { if (inputs.housingKind) show("roomCount", inputs.housingKind.value === "shared"); },
    onSubmit: async (v) => {
      const invalid = act.validateProperty(v);
      if (invalid) return invalid;
      if (v.account && v.account.replace(/\D/g, "").length !== 11) return "Kontonummeret må ha 11 siffer.";
      if (!p) {
        const managed = state.properties.filter((x) => isManager(x.id)).length;
        if (managed >= 4) return "Premium dekker inntil fire boliger. Arkiver en bolig under «Rediger informasjon» for å legge til en ny.";
        const shared = v.housingKind === "shared";
        const roomCount = shared ? act.parseRoomCount(v.roomCount) : null;
        if (shared && !v.roomCount) return "Du må oppgi antall rom som skal leies ut.";
        if (shared && !roomCount) return "Antall rom må være mellom 1 og 10.";
        const res = await act.createProperty(state.user.id, v);
        if (res.error) return act.explain(res.error);
        const id = res.data?.[0]?.id;
        if (id && roomCount) {
          const rooms = await act.ensureSharedRooms(id, roomCount);
          if (rooms.error) act.toast(`Boligen er opprettet, men ${rooms.error.charAt(0).toLowerCase()}${rooms.error.slice(1)} Legg til rom under «Om boligen».`);
        }
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
// TenancyController.swift: active_tenancy_exists / unit_has_pending_invitation.
const inviteError = (error) => {
  const msg = String(error?.message ?? "");
  if (/active_tenancy|already.*active/i.test(msg)) return "Boligen har allerede et aktivt leieforhold.";
  if (/unit_has_pending_invitation/i.test(msg)) return "Dette rommet har en ventende invitasjon og kan ikke brukes til en ny leietaker.";
  return act.explain(error);
};

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

/* ---------- Kontraktflyt ---------- */
// Open the tab during the click so the browser does not treat it as a pop-up.
const pdfButton = (label, cls, load) => button(label, cls, async (e) => {
  const b = e.currentTarget;
  const tab = window.open("", "_blank");
  b.disabled = true;
  b.textContent = "Henter PDF …";
  const pdf = await load();
  b.disabled = false;
  b.textContent = label;
  if (!pdf.url) {
    tab?.close();
    return act.toast(pdf.message);
  }
  if (tab) tab.location.href = pdf.url;
  else act.toast("Tillat nye faner for å åpne kontrakten.");
  setTimeout(() => URL.revokeObjectURL(pdf.url), 300_000);
});

const PARTY_ROLE = { landlord: "Utleier", co_landlord: "Utleier", tenant: "Leietaker", guarantor: "Garantist" };
const partyState = (p) => (p.has_signature ? ["Signert", " is-success"] : p.has_approved ? ["Godkjent", ""] : p.required_to_sign ? ["Venter", " is-warning"] : ["Ikke signert", ""]);
const signaturesList = (parties) => {
  const wrap = h("div");
  wrap.append(h("p", "pt-label", "Signaturer"));
  const ul = h("ul", "pt-list");
  for (const p of parties) {
    const li = h("li", "pt-row");
    const main = h("div", "pt-row-main");
    main.append(h("strong", null, p.display_name || PARTY_ROLE[p.party_role] || "Part"), h("span", null, PARTY_ROLE[p.party_role] ?? ""));
    const [label, tone] = partyState(p);
    li.append(main, h("span", `pt-chip${tone}`, label));
    ul.append(li);
  }
  wrap.append(ul);
  return wrap;
};

// TenantLeaseContractController phases.
const leasePhase = (lease) => {
  if (!lease?.agreement_id) return "notSent";
  if (lease.agreement_status === "signed" || lease.both_parties_signed_confirmed) return lease.document_id ? "fullySigned" : "signatureSaved";
  if (lease.awaiting_caller_signature) return "awaitingCaller";
  if (lease.agreement_status === "ready_for_review" || lease.agreement_status === "draft") return "waitingForLandlord";
  if (lease.recorded_signature_count > 0) return "waitingForOthers";
  return "waitingForLandlord";
};
const LEASE_PHASE = {
  notSent: ["Ingen leiekontrakt ennå", null],
  waitingForLandlord: ["Venter på utleier", " is-warning"],
  awaitingCaller: ["Venter på din signatur", " is-warning"],
  waitingForOthers: ["Du har signert. Venter på øvrige.", " is-warning"],
  signatureSaved: ["Signaturen er lagret. Den signerte PDF-en er ikke klar ennå.", ""],
  fullySigned: ["Kontrakten er signert.", " is-success"],
};

const tenantSignForm = (lease, title = "Godkjenn og signer") =>
  act.signatureForm({
    title,
    intro: "Les kontrakten. Fyll inn sted og dato, skriv navnet ditt og tegn signaturen. En signatur tegnet her kan binde partene. Det er ikke BankID.",
    name: state.name,
    submitLabel: "Signer",
    onSubmit: async (ink) => {
      const res = await act.signAsTenant(lease, ink);
      if (res.message) return res.message;
      await refresh(res.outcome === "signed" ? "Kontrakten er signert." : "Signaturen er lagret.");
      return null;
    },
  });

const rejectForm = (lease) =>
  act.openForm({
    title: "Avvis kontrakten",
    intro: "Utleier ser begrunnelsen og kan lage et nytt utkast.",
    submitLabel: "Avvis",
    submitClass: "pt-btn-destructive",
    fields: [{ name: "reason", label: "Begrunnelse", type: "textarea", required: true, maxLength: 500, rows: 3 }],
    onSubmit: async (v) => {
      const err = rpcError(await act.rejectAgreement(lease, v.reason.trim()));
      if (err) return err;
      await refresh("Kontrakten er avvist.");
      return null;
    },
  });

const changeRow = (ch, extra = []) => {
  const li = h("li", "pt-row");
  const main = h("div", "pt-row-main");
  const approvals = ch.required_tenant_count ? `Godkjent av ${ch.accepted_tenant_count ?? 0} av ${ch.required_tenant_count} leietakere` : "";
  main.append(h("strong", null, ch.request_kind === "revision" ? "Endring av kontrakten" : "Avslutning av kontrakten"), h("span", null, approvals));
  li.append(main, h("span", `pt-chip${ch.status === "completed" ? " is-success" : ""}`, act.CHANGE_STATUS[ch.status] ?? ch.status));
  if (extra.length) {
    const actions = h("div", "pt-row-actions");
    actions.append(...extra);
    li.append(actions);
  }
  return li;
};
// A revision is approved by signing the new contract (contract_change_signature_required).
const respondButtons = (ch) => (ch.can_respond ? [
  ...(ch.request_kind === "revision" ? [] : [button("Godkjenn", "pt-btn-primary pt-btn-small", async () => {
    const err = rpcError(await act.respondChange(ch.id, true));
    if (err) act.toast(err); else refresh("Svaret er lagret.");
  })]),
  button("Avslå", "pt-btn-quiet-destructive pt-btn-small", async () => {
    if (!(await act.confirmAction({ title: "Avslå forslaget?", text: "Kontrakten gjelder som før.", confirmLabel: "Avslå" }))) return;
    const err = rpcError(await act.respondChange(ch.id, false));
    if (err) act.toast(err); else refresh("Svaret er lagret.");
  }),
] : []);
const OPEN_CHANGE = ["draft", "pending", "accepted"];

// Tenant view: one card per own tenancy on this property (TenantLeaseContractView).
const tenantContractCards = async (p) => {
  const mine = state.tenancies.filter((t) => t.property_id === p.id && state.tenantOf.has(t.id));
  if (!mine.length) return [emptyPage("contract", "Leiekontrakt", `Leiekontrakten for ${p.display_name || "boligen"} vises her når den er tilgjengelig.`)];
  const cards = [];
  for (const t of mine) {
    const c = card("Leiekontrakt", "contract");
    const res = await act.myTenancyLease(t.id);
    if (res.error) {
      c.append(inline("Leiekontrakten kunne ikke lastes. Prøv igjen."));
      cards.push(c);
      continue;
    }
    const lease = res.data;
    const phase = leasePhase(lease);
    const [label, tone] = LEASE_PHASE[phase];
    const head = h("div", "pt-row");
    const main = h("div", "pt-row-main");
    main.append(h("strong", null, label), h("span", null, t.start_date ? `Leieforhold fra ${dateText(t.start_date)}` : "Leieforhold"));
    head.append(icon("contract"), main);
    if (tone != null) head.append(h("span", `pt-chip${tone}`, phase === "fullySigned" ? "Signert" : phase === "awaitingCaller" ? "Venter på signering" : "Venter"));
    c.append(head);
    if (phase === "notSent") {
      c.append(inline(`Leiekontrakten for ${p.display_name || "boligen"} vises her når den er tilgjengelig.`));
      cards.push(c);
      continue;
    }
    if (res.parties.length) c.append(signaturesList(res.parties));
    const buttons = [];
    if (lease.document_id) {
      buttons.push(pdfButton(phase === "fullySigned" ? "Last ned signert PDF" : "Åpne PDF", "pt-btn-secondary pt-btn-small", () => act.documentPdf(lease.document_id)));
    }
    if (phase === "awaitingCaller") {
      buttons.push(button("Godkjenn og signer", "pt-btn-primary pt-btn-small", () => tenantSignForm(lease)));
      buttons.push(button("Avvis", "pt-btn-quiet-destructive pt-btn-small", () => rejectForm(lease)));
    }
    if (buttons.length) c.append(actionsRow(...buttons));
    // Proposed changes to a signed contract: approve/decline, then sign the replacement.
    if (phase === "fullySigned" || phase === "signatureSaved") {
      const ch = await act.listChanges(lease.agreement_id);
      const open = (ch.data ?? []).filter((x) => OPEN_CHANGE.includes(x.status));
      if (open.length) {
        const ul = h("ul", "pt-list");
        for (const x of open) {
          const extra = respondButtons(x);
          if (x.replacement_agreement_id && x.status !== "draft") {
            const rep = await act.agreementLease(x.replacement_agreement_id);
            if (rep.data?.awaiting_caller_signature) {
              if (rep.data.document_id) extra.push(pdfButton("Åpne ny kontrakt", "pt-btn-secondary pt-btn-small", () => act.documentPdf(rep.data.document_id)));
              extra.push(button("Signer ny kontrakt", "pt-btn-primary pt-btn-small", () => tenantSignForm(rep.data, "Signer ny kontrakt")));
            }
          }
          ul.append(changeRow(x, extra));
        }
        const wrap = h("div");
        wrap.append(h("p", "pt-label", "Forslag til endringer"), ul);
        c.append(wrap);
      }
    }
    cards.push(c);
  }
  return cards;
};

const landlordSignForm = (a) =>
  act.signatureForm({
    title: "Signer",
    intro: "Signer det godkjente utkastet. Leietaker får kontrakten til signering etterpå. En signatur tegnet her kan binde partene. Det er ikke BankID. Posten-signering kommer senere.",
    name: state.name,
    submitLabel: "Signer og send",
    onSubmit: async (ink) => {
      const res = await act.signAsLandlord(a, ink);
      if (res.message) return res.message;
      await refresh("Kontrakten er signert og sendt til leietaker.");
      return null;
    },
  });

const editContract = async (pid, a) => {
  const res = await act.getAgreement(a.agreement_id);
  if (res.error) return act.toast("Leiekontrakten kunne ikke lastes. Prøv igjen.");
  contractForm(pid, res.data);
};

const agreementRow = async (pid, a, replacementIds) => {
  const STATUS = { draft: "Utkast", ready_for_review: "Klar til gjennomgang", awaiting_signatures: "Venter på signatur", partially_signed: "Venter på signatur", signed: "Signert", cancelled: "Avbrutt", rejected: "Avvist", declined: "Avslått", superseded: "Erstattet" };
  const st = a.agreement_status;
  const li = h("li", "pt-row");
  const main = h("div", "pt-row-main");
  const t = state.tenancies.find((x) => x.id === a.tenancy_id);
  main.append(h("strong", null, replacementIds.has(a.agreement_id) ? "Forslag til ny leiekontrakt" : "Leiekontrakt"),
    h("span", null, t?.start_date ? `Leieforhold fra ${dateText(t.start_date)}` : "Leieforhold"));
  li.append(icon("contract"), main, h("span", `pt-chip${st === "signed" ? " is-success" : ["awaiting_signatures", "partially_signed"].includes(st) ? " is-warning" : ""}`, STATUS[st] ?? st));
  const actions = h("div", "pt-row-actions");
  const extra = [];
  // #1417: drafts and proposals are view-only previews; the signed PDF is the stored document.
  if (a.current_version_id && (st === "draft" || st === "ready_for_review")) {
    actions.append(pdfButton("Forhåndsvis", "pt-btn-soft pt-btn-small", () => act.previewAgreementPdf(a)));
  }
  if (st === "draft") {
    actions.append(button("Rediger", "pt-btn-secondary pt-btn-small", () => editContract(pid, a)));
    actions.append(button("Klar til gjennomgang", "pt-btn-primary pt-btn-small", async () => {
      if (!(await act.confirmAction({ title: "Klar til gjennomgang?", text: "Se gjennom kontrakten som PDF før du godkjenner utkastet. Etterpå signerer du her, og leietaker får kontrakten til signering.", confirmLabel: "Fortsett", destructive: false }))) return;
      const err = rpcError(await act.markAgreementReady(a));
      if (err) act.toast(err); else refresh("Kontrakten er klar til gjennomgang.");
    }));
  }
  if (st === "ready_for_review") actions.append(button("Signer", "pt-btn-primary pt-btn-small", () => landlordSignForm(a)));
  if (st === "draft" || st === "ready_for_review") {
    actions.append(button("Slett utkast", "pt-btn-quiet-destructive pt-btn-small", async () => {
      if (!(await act.confirmAction({ title: "Slett utkast?", text: "Utkastet slettes. Leieforholdet påvirkes ikke.", confirmLabel: "Slett utkast" }))) return;
      const err = rpcError(await act.cancelAgreement(a));
      if (err) act.toast(err); else refresh("Utkastet er slettet.");
    }));
  }
  if (["awaiting_signatures", "partially_signed", "signed"].includes(st)) {
    const lease = await act.agreementLease(a.agreement_id);
    if (lease.data?.document_id) {
      actions.append(pdfButton(st === "signed" ? "Last ned signert PDF" : "Åpne PDF", "pt-btn-secondary pt-btn-small", () => act.documentPdf(lease.data.document_id)));
    }
    if (lease.parties?.length) extra.push(signaturesList(lease.parties));
  }
  if (st === "signed") {
    const ch = await act.listChanges(a.agreement_id);
    const changes = ch.data ?? [];
    if (!changes.some((x) => OPEN_CHANGE.includes(x.status))) {
      actions.append(button("Foreslå endringer", "pt-btn-soft pt-btn-small", async () => {
        if (!(await act.confirmAction({ title: "Foreslå endringer i kontrakten?", text: "Det lages et nytt utkast basert på den signerte kontrakten. Den gjeldende kontrakten gjelder til den nye er signert av alle.", confirmLabel: "Lag utkast", destructive: false }))) return;
        const err = rpcError(await act.requestRevision(a));
        if (err) act.toast(err); else refresh("Et nytt utkast er laget under Leiekontrakter.");
      }));
    }
    if (changes.length) {
      const ul = h("ul", "pt-list");
      for (const x of changes.slice(0, 5)) ul.append(changeRow(x, respondButtons(x)));
      const wrap = h("div");
      wrap.append(h("p", "pt-label", "Endringer"), ul);
      extra.push(wrap);
    }
  }
  li.append(actions);
  return [li, ...extra];
};

const landlordContractCard = async (p) => {
  const c = card("Leiekontrakter", "contract");
  const hasTenancy = state.tenancies.some((t) => t.property_id === p.id);
  c.append(actionsRow(hasTenancy
    ? button("Opprett leiekontrakt", "pt-btn-primary pt-btn-small", () => contractForm(p.id))
    : button("Inviter leietaker først", "pt-btn-secondary pt-btn-small", () => inviteForm(p.id))));
  const res = await act.listAgreements(p.id);
  if (res.error) {
    c.append(inline("Kontraktene kunne ikke hentes akkurat nå."));
    return c;
  }
  const rows = (res.data ?? []).filter((a) => a.agreement_status !== "cancelled");
  if (!rows.length) {
    c.append(inline("Ingen leiekontrakter ennå."));
    return c;
  }
  // Replacement drafts made by a change request are named as such.
  const replacementIds = new Set();
  await Promise.all(rows.filter((a) => a.agreement_status === "signed").map(async (a) => {
    const ch = await act.listChanges(a.agreement_id);
    for (const x of ch.data ?? []) if (x.replacement_agreement_id) replacementIds.add(x.replacement_agreement_id);
  }));
  const list = h("ul", "pt-list");
  for (const a of rows) {
    const [li, ...extra] = await agreementRow(p.id, a, replacementIds);
    list.append(li);
    for (const x of extra) {
      const sub = h("li", "pt-row");
      sub.append(x);
      list.append(sub);
    }
  }
  c.append(list);
  return c;
};

/* ---------- Leieforhold: avslutt, kanseller, trekk tilbake invitasjon ---------- */
const lifecycleForm = (t, end) => {
  const operationId = crypto.randomUUID(); // one id per attempt, reused on retry
  return act.openForm({
    title: end ? "Avslutt leieforhold" : "Kanseller leieforhold",
    intro: end ? "Leieforholdet avsluttes på sluttdatoen. Historikken blir liggende under Leiehistorikk." : "Leieforholdet startet aldri og fjernes fra boligen.",
    submitLabel: end ? "Avslutt leieforhold" : "Kanseller leieforhold",
    submitClass: "pt-btn-destructive",
    fields: [
      { name: "reason", label: "Årsak", type: "select", required: true, options: end ? act.TERMINATION_REASONS : act.CANCELLATION_REASONS },
      ...(end ? [{ name: "end", label: "Sluttdato", type: "date", value: todayISO(), required: true }] : []),
    ],
    onSubmit: async (v) => {
      const res = end ? await act.terminateTenancy(t.id, v.reason, v.end, operationId) : await act.cancelTenancy(t.id, v.reason, operationId);
      const err = act.lifecycleError(res);
      if (err) return err;
      await refresh(end ? "Leieforholdet er avsluttet." : "Leieforholdet er kansellert.");
      return null;
    },
  });
};
const INVITE_CANCEL_TEXT = { accepted: "Invitasjonen er allerede godtatt.", expired: "Invitasjonen er utløpt.", inactive: "Invitasjonen er ikke aktiv lenger." };
const invitationRow = (inv) => {
  const li = h("li", "pt-row");
  const main = h("div", "pt-row-main");
  main.append(h("strong", null, inv.email), h("span", null, `Invitasjon sendt ${dateText(inv.created_at?.slice(0, 10))}`));
  li.append(h("span", "pt-avatar pt-avatar-sm", (inv.email || "?").charAt(0).toUpperCase()), main, h("span", "pt-chip is-warning", "Venter"));
  li.append(button("Trekk tilbake", "pt-btn-quiet-destructive pt-btn-small", async () => {
    if (!(await act.confirmAction({ title: "Trekk tilbake invitasjonen?", text: `Lenken til ${inv.email} slutter å virke.`, confirmLabel: "Trekk tilbake" }))) return;
    const res = await act.cancelInvitation(inv.id);
    if (res.error) return act.toast(act.explain(res.error));
    const out = (Array.isArray(res.data) ? res.data[0] : res.data) ?? {};
    if (INVITE_CANCEL_TEXT[out.invitation_status]) return act.toast(INVITE_CANCEL_TEXT[out.invitation_status]);
    refresh("Invitasjonen er trukket tilbake.");
  }));
  return li;
};

// ContractDraftAuthoringView: every term is optional in a draft (start date too,
// migration contract_draft_without_start_date); the tenancy is untouched until signed.
// `detail` (get_rental_agreement payload) switches the form to «Rediger utkast».
const contractForm = (pid, detail) => {
  const tenancies = state.tenancies.filter((t) => t.property_id === pid);
  const p = state.properties.find((x) => x.id === pid);
  const f = detail ? act.termsForForm(detail.version?.snapshot?.terms) : null;
  return act.openForm({
    title: detail ? "Rediger utkast" : "Ny leiekontrakt",
    intro: detail ? "Endringene lagres i utkastet. Andre vilkår du har lagt inn i appen beholdes." : "Utkastet lagres med samme felter som i appen. Du kan fylle ut resten senere.",
    submitLabel: "Lagre utkast",
    fields: [
      ...(detail ? [] : [{ name: "tenancy", label: "Leieforhold", type: "select", required: true, options: tenancies.map((t) => [t.id, `${TENANCY_LABEL[t.status] ?? t.status}${t.start_date ? ` · fra ${dateText(t.start_date)}` : ""}`]) }]),
      { name: "termType", label: "Avtaletype", type: "select", options: [["indefinite", "Løpende"], ["fixed", "Fast periode"]], value: f?.termType ?? "indefinite", required: true },
      { name: "start", label: "Startdato", type: "date", value: f ? f.start : (tenancies[0]?.start_date ?? "") },
      { name: "end", label: "Sluttdato", type: "date", value: f?.end ?? "", hidden: f?.termType !== "fixed" },
      { name: "rent", label: "Månedsleie", type: "money", value: f?.rent ?? "" },
      { name: "payday", label: "Betalingsdag (1–31)", type: "number", min: 1, max: 31, value: f?.payday ?? "" },
      { name: "deposit", label: "Depositum", type: "money", help: "Maks seks måneders husleie.", value: f?.deposit ?? "" },
      { name: "notice", label: "Oppsigelsestid (måneder)", type: "number", min: 1, max: 12, value: f ? f.notice : "3" },
      { name: "account", label: "Kontonummer for husleie", type: "text", maxLength: 20, value: f?.account ?? "" },
      { name: "special", label: "Særlige avtaler", type: "textarea", maxLength: 4000, value: f?.special ?? "" },
    ],
    onChange: (inputs, show) => show("end", inputs.termType.value === "fixed"),
    onSubmit: async (v) => {
      const tenancy = detail ? null : tenancies.find((t) => t.id === v.tenancy);
      if (!detail && !tenancy) return "Velg et leieforhold.";
      const rentMinor = v.rent ? act.minorOf(v.rent) : null;
      const depositMinor = v.deposit ? act.minorOf(v.deposit) : null;
      if (v.rent && !rentMinor) return "Skriv en gyldig månedsleie.";
      if (v.deposit && depositMinor == null) return "Skriv et gyldig depositum.";
      if (rentMinor && depositMinor && depositMinor > rentMinor * 6) return "Depositumet kan ikke være mer enn seks måneders husleie.";
      if (v.termType === "fixed" && v.start && v.end && v.end <= v.start) return "Sluttdatoen må være etter startdatoen.";
      if (v.payday && !(Number(v.payday) >= 1 && Number(v.payday) <= 31)) return "Betalingsdagen må være mellom 1 og 31.";
      if (v.notice && !(Number(v.notice) >= 1 && Number(v.notice) <= 12)) return "Oppsigelsestiden må være mellom 1 og 12 måneder.";
      if (v.account && v.account.replace(/\D/g, "").length !== 11) return "Kontonummer må være 11 siffer";
      const values = { ...v, rentMinor, depositMinor, housingKind: p?.housing_kind };
      const res = detail ? await act.updateAgreementDraft(detail, values) : await act.createAgreementDraft(tenancy, values);
      if (res.message) return res.message;
      if (res.error) {
        if (/open_conflict/.test(res.error.message)) return "Det finnes allerede en åpen leiekontrakt for dette leieforholdet.";
        return /version_conflict|revision/i.test(res.error.message) ? "Kontrakten er endret. Last inn på nytt." : act.explain(res.error);
      }
      await refresh(detail ? "Utkastet er oppdatert." : "Utkastet er lagret.");
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

/* ---------- Meldinger (ChatView / ChatController) ---------- */
const chatTime = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return time;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `I går ${time}`;
  return `${d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" })} ${time}`;
};
const joinNames = (people) => {
  const names = people.map((p) => p.display_name?.trim() || p.email?.trim()).filter(Boolean);
  return names.length ? names.join(", ") : null;
};
// Who is on the other side of each row: tenants from tenancy_members + list_linked_profile_contacts
// for landlords, the owner from list_my_tenancies for tenants (SupabaseChatListPeopleRemote).
async function chatPeople(convs) {
  const labels = new Map();
  const tenantPresent = new Map();
  const managed = convs.filter((c) => c.role_snapshot !== "tenant" && !c.is_property_chat);
  if (managed.length) {
    const members = await act.chatTenantMembers([...new Set(managed.map((c) => c.tenancy_id))]);
    const rows = members.data ?? [];
    const contacts = rows.length ? (await act.linkedContacts([...new Set(rows.map((m) => m.user_id))])).data ?? [] : [];
    const byUser = new Map(contacts.map((c) => [c.user_id, c]));
    for (const c of managed) {
      const people = rows.filter((m) => m.tenancy_id === c.tenancy_id).map((m) => byUser.get(m.user_id) ?? {});
      if (!members.error) tenantPresent.set(c.conversation_id, people.length > 0);
      const name = joinNames(people);
      if (name) labels.set(c.conversation_id, name);
    }
  }
  if (convs.some((c) => c.role_snapshot === "tenant" && !c.is_property_chat)) {
    const owners = (await act.myTenancies()).data ?? [];
    for (const c of convs.filter((x) => x.role_snapshot === "tenant" && !x.is_property_chat)) {
      const o = owners.find((t) => t.tenancy_id === c.tenancy_id);
      const name = o && (o.owner_display_name?.trim() || o.owner_email?.trim());
      if (name) labels.set(c.conversation_id, name);
    }
  }
  return { labels, tenantPresent };
}

async function chatPage() {
  await act.provisionChats();
  const res = await act.listChatConversations();
  if (res.error) return [emptyPage("chat", "Ingen samtaler", "Kunne ikke hente samtalene dine. Prøv igjen.")];
  const all = res.data ?? [];
  const p = property();
  // A selected property shows its chats in the mode you have there (landlord or tenant), like the app's filter.
  const tenantMode = p ? !isManager(p.id) : false;
  const convs = p ? all.filter((c) => c.property_id === p.id && (c.role_snapshot === "tenant") === tenantMode) : all;
  if (!all.length) return [emptyPage("chat", "Ingen samtaler", "Du har ikke et aktivt leieforhold med noen du kan chatte med ennå.")];
  if (!convs.length) return [emptyPage("chat", "Ingen samtale", "Det finnes ingen samtale for denne boligen ennå. Inviter en leietaker for å starte en samtale, eller oppdater listen hvis leieforholdet allerede er aktivt.")];
  await Promise.all(convs.filter((c) => !Array.isArray(c.counterpart_avatars)).map(async (c) => {
    const r = await act.chatCounterpartAvatars(c.conversation_id);
    c.counterpart_avatars = r.data ?? [];
  }));
  const { labels, tenantPresent } = await chatPeople(convs);
  const titleOf = (c) => (c.is_property_chat ? "Alle i boligen" : labels.get(c.conversation_id) ?? (c.role_snapshot === "tenant" ? "Utleier" : "Leietaker"));
  const placeOf = (c) => [c.property_display_name, c.unit_display_label].filter(Boolean).join(" · ");
  const needsInvite = (c) => c.role_snapshot !== "tenant" && !c.is_property_chat && c.conversation_status === "active" && tenantPresent.get(c.conversation_id) === false;

  const shell = h("section", "pt-card pt-chat");
  const list = h("nav", "pt-chat-list");
  list.setAttribute("aria-label", "Samtaler");
  const thread = h("div", "pt-chat-thread");
  shell.append(list, thread);
  let current = null;

  // Profile photo of the first person shown, else the room/chat icon (the app's round list avatar).
  const chatAvatar = (c) => {
    const fallback = icon(c.is_property_chat ? "house" : "chat");
    const face = (c.counterpart_avatars ?? []).find((a) => a.avatar_revision);
    if (!face) return fallback;
    act.avatarDataUrl(face.user_id, face.avatar_revision).then((url) => {
      if (!url || !fallback.isConnected) return;
      const img = h("img", "pt-chat-avatar");
      img.alt = "";
      img.src = url;
      fallback.replaceWith(img);
    });
    return fallback;
  };
  const drawList = () => {
    list.replaceChildren();
    for (const [status, title] of [["active", "Aktive leietakere"], ["closed", "Tidligere leietakere"]]) {
      const group = convs.filter((c) => (c.conversation_status === "closed" ? "closed" : "active") === status);
      if (!group.length) continue;
      list.append(h("p", "pt-label", title));
      for (const c of group) {
        const b = h("button", "pt-chat-row");
        b.type = "button";
        if (current?.conversation_id === c.conversation_id) b.setAttribute("aria-current", "true");
        const text = h("span", "pt-chat-row-text");
        text.append(h("strong", null, titleOf(c)), h("span", null, placeOf(c)));
        b.append(chatAvatar(c), text);
        if (Number(c.unread_count) > 0) b.append(h("span", "pt-chip is-info", Number(c.unread_count) === 1 ? "1 ulest melding" : `${c.unread_count} uleste meldinger`));
        b.addEventListener("click", () => open(c));
        list.append(b);
      }
    }
  };

  let messages = [];
  let cursors = [];
  let replyTo = null;
  let pendingFile = null;
  const loadThread = async (c) => {
    const [m, cur] = await Promise.all([act.listChatMessagesBefore(c.conversation_id, null, 50), act.listChatPeerCursors(c.conversation_id)]);
    if (m.error) return false;
    messages = [...(m.data ?? [])].sort((a, b) => a.sequence_no - b.sequence_no);
    cursors = cur.data ?? [];
    const last = messages.at(-1)?.sequence_no;
    if (last && last > Number(c.last_seen_sequence_no ?? 0)) {
      const seen = await act.advanceChatSeen(c.conversation_id, last);
      if (!seen.error) { c.last_seen_sequence_no = last; c.unread_count = 0; }
    }
    return true;
  };

  const bubble = (c, m, seenSeq) => {
    const mine = m.sender_member_id === c.member_id;
    if (m.is_system) return h("p", "pt-chat-system", m.body);
    const row = h("div", `pt-chat-msg ${mine ? "is-mine" : "is-theirs"}`);
    const b = h("div", "pt-bubble");
    const body = act.parseChatBody(m.body);
    if (!mine) b.append(h("span", "pt-bubble-sender", m.sender_display_name_snapshot));
    if (body.kind === "deleted") b.append(h("em", null, "Meldingen ble slettet"));
    else if (body.kind === "reply") {
      const target = messages.find((x) => x.message_id === body.replyTo);
      const quoted = target ? act.parseChatBody(target.body) : null;
      b.append(h("span", "pt-bubble-quote", quoted && ["text", "reply"].includes(quoted.kind) ? quoted.text : quoted?.title ?? "Originalmeldingen er ikke tilgjengelig"), h("p", null, body.text));
    } else if (body.kind === "file") {
      if (body.fileKind === "image") {
        const img = h("img", "pt-bubble-image");
        img.alt = body.title;
        act.loadChatAttachment(body.attachmentId).then((r) => { if (r.dataUrl) img.src = r.dataUrl; else img.replaceWith(h("span", null, r.message)); });
        b.append(img);
      } else b.append(pdfButton(body.title, "pt-btn-secondary pt-btn-small", () => act.loadChatAttachment(body.attachmentId)));
    } else if (body.kind === "doc") b.append(pdfButton(body.title, "pt-btn-secondary pt-btn-small", () => act.documentPdf(body.documentId)));
    else b.append(h("p", null, body.text));
    const meta = h("span", "pt-bubble-meta", chatTime(m.sent_at));
    if (mine && seenSeq >= m.sequence_no && m === messages.filter((x) => x.sender_member_id === c.member_id).at(-1)) meta.textContent += " · Sett";
    b.append(meta);
    row.append(b);
    const actions = h("div", "pt-chat-msg-actions");
    if (body.kind !== "deleted" && c.is_writable && !needsInvite(c)) {
      actions.append(button("Svar", "pt-btn-soft pt-btn-small", () => { replyTo = m; drawThread(c); }));
    }
    if (mine && body.kind !== "deleted" && Date.now() - new Date(m.sent_at).getTime() < act.CHAT_DELETE_WINDOW_MS) {
      actions.append(button("Slett", "pt-btn-quiet-destructive pt-btn-small", async () => {
        const r = await act.deleteChatMessage(c.conversation_id, m.message_id);
        if (r.error || r.data !== true) act.toast("Meldingen kunne ikke slettes. Bare egne meldinger under 30 sekunder kan slettes.");
        await reload(c);
      }));
    }
    if (actions.childElementCount) row.append(actions);
    return row;
  };

  const composer = (c) => {
    const form = h("form", "pt-chat-composer");
    if (replyTo) {
      const r = h("div", "pt-chat-reply");
      const quoted = act.parseChatBody(replyTo.body);
      r.append(h("span", null, `Svar til ${replyTo.sender_display_name_snapshot}: ${quoted.text ?? quoted.title ?? ""}`.slice(0, 140)),
        button("Avbryt svar", "pt-btn-soft pt-btn-small", () => { replyTo = null; drawThread(c); }));
      form.append(r);
    }
    const area = h("textarea", "pt-input pt-chat-input");
    area.placeholder = "Skriv en melding …";
    area.rows = 2;
    area.maxLength = act.CHAT_MAX_CHARS;
    area.setAttribute("aria-label", "Melding");
    const fileLabel = h("label", "pt-btn pt-btn-soft pt-btn-small pt-chat-attach");
    const file = h("input", "pt-visually-hidden");
    file.type = "file";
    file.accept = "image/jpeg,image/png,application/pdf";
    fileLabel.append(h("span", null, "Legg ved bilde eller fil"), file);
    const chosen = h("div", "pt-chat-chosen");
    const drawChosen = () => {
      chosen.replaceChildren();
      if (!pendingFile) return;
      chosen.append(h("span", "pt-chip", `Valgt vedlegg, ikke sendt: ${pendingFile.name}`),
        button("Fjern valgt vedlegg", "pt-btn-soft pt-btn-small", () => { pendingFile = null; file.value = ""; drawChosen(); }));
    };
    file.addEventListener("change", () => { pendingFile = file.files?.[0] ?? null; drawChosen(); });
    drawChosen();
    const status = h("p", "pt-chat-status");
    status.setAttribute("role", "status");
    const fail = (text) => { status.textContent = text; status.classList.add("is-error"); send.disabled = false; };
    const send = h("button", "pt-btn pt-btn-primary", "Send");
    send.type = "submit";
    const row = h("div", "pt-chat-composer-row");
    row.append(fileLabel, send);
    form.append(area, chosen, row, status);
    const submit = async () => {
      const text = area.value;
      // A chosen attachment may go without text; any text still follows the composer rules.
      const err = !pendingFile || text.trim() ? act.chatBodyError(text) : null;
      if (err) return fail(err);
      send.disabled = true;
      status.classList.remove("is-error");
      status.textContent = "Sender…";
      if (pendingFile) {
        const err = await act.sendChatAttachment(c.conversation_id, pendingFile);
        if (err) return fail(err);
        pendingFile = null;
      }
      if (text.trim()) {
        const body = replyTo ? act.replyBody(replyTo, text) : text;
        const r = await act.sendChatMessage(c.conversation_id, crypto.randomUUID(), body);
        if (r.error) return fail("Meldingen ble ikke sendt.");
      }
      replyTo = null;
      await reload(c);
    };
    form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
    area.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } });
    return { form, area };
  };

  const drawThread = (c, failed = false) => {
    const draft = thread.querySelector(".pt-chat-input")?.value ?? "";
    thread.replaceChildren();
    const head = h("header", "pt-chat-head");
    head.append(h("h2", null, titleOf(c)), h("span", null, placeOf(c)));
    thread.append(head);
    const scroller = h("div", "pt-chat-messages");
    if (failed) scroller.append(inline("Kunne ikke hente meldingene. Prøv igjen."));
    else if (!messages.length) {
      const e = h("div", "pt-chat-empty");
      e.append(h("strong", null, "Ingen meldinger ennå"), h("p", null, c.is_writable ? "Skriv den første meldingen når du er klar." : "Det finnes ingen meldinger i denne avsluttede samtalen."));
      scroller.append(e);
    }
    const seenSeq = Math.max(0, ...cursors.filter((x) => x.member_id !== c.member_id).map((x) => Number(x.last_seen_sequence_no)));
    for (const m of messages) scroller.append(bubble(c, m, seenSeq));
    thread.append(scroller);
    if (c.conversation_status === "closed") thread.append(inline("Leieforholdet er avsluttet. Samtalen kan bare leses."));
    else if (needsInvite(c)) thread.append(inline("Inviter leietakeren for å chatte."));
    else if (!c.is_writable) thread.append(inline(c.is_property_chat ? "Du kan sende meldinger igjen når en leietaker er knyttet til boligen." : "Samtalen er ikke tilgjengelig"));
    else {
      const { form, area } = composer(c);
      area.value = draft;
      thread.append(form);
    }
    scroller.scrollTop = scroller.scrollHeight;
  };

  let reloading = null;
  const reload = async (c) => {
    if (reloading) return reloading;
    reloading = (async () => {
      const ok = await loadThread(c);
      if (current?.conversation_id === c.conversation_id) { drawThread(c, !ok); drawList(); }
    })().finally(() => { reloading = null; });
    return reloading;
  };

  const open = async (c) => {
    current = c;
    replyTo = null;
    pendingFile = null;
    drawList();
    thread.replaceChildren(inline("Henter meldinger …"));
    setPageCleanup(act.subscribeChat(c.conversation_id, () => reload(c)));
    const ok = await loadThread(c);
    if (current === c) { drawThread(c, !ok); drawList(); }
  };

  drawList();
  const first = convs.find((c) => Number(c.unread_count) > 0) ?? convs[0];
  open(first);
  return [shell];
}

/* ---------- Vedlikehold (MaintenanceView.swift, MaintenanceHistorySection) ---------- */
const MT_EVENT_TITLES = {
  created: "Saken ble opprettet", comment: "Kommentar", reopened: "Saken ble gjenåpnet", resolved: "Saken ble markert som løst",
  closed: "Saken ble lukket", image_added: "Bilde lagt til", image_removed: "Bilde fjernet", document_added: "Dokument lagt til",
  document_removed: "Dokument fjernet", shared_with_tenant: "Saken ble delt med leietaker",
};
const MT_EVENT_ICONS = {
  created: "plus", comment: "chat", status_changed: "history", priority_changed: "history", reopened: "history", resolved: "check",
  closed: "check", image_added: "photo", image_removed: "photo", document_added: "doc", document_removed: "doc", shared_with_tenant: "person",
};
const MT_RELOAD_REQUEST = new Set(["status_changed", "priority_changed", "reopened", "resolved", "closed", "shared_with_tenant"]);
const mtPriority = (p) => new Map(act.MAINTENANCE_PRIORITIES).get(p) ?? p;
const mtCategory = (c) => new Map(act.MAINTENANCE_CATEGORIES).get(c) ?? "Annet";
const mtEventTitle = (e) => {
  if (e.event_type === "status_changed") return `Status endret til ${act.MAINTENANCE_STATUS[e.new_value] ?? "ny status"}`;
  if (e.event_type === "priority_changed") return `Prioritet endret til ${new Map(act.MAINTENANCE_PRIORITIES).get(e.new_value) ?? "ny prioritet"}`;
  return MT_EVENT_TITLES[e.event_type] ?? "Hendelse";
};
const mtStatusChip = (r) => h("span", `pt-chip ${r.status === "resolved" ? "pt-chip-resolved" : "is-info"}`, act.MAINTENANCE_STATUS[r.status] ?? r.status);
const mtTime = (v) => new Date(v).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
const mtDateTime = (v) => `${dateText(v)} kl. ${mtTime(v)}`;
const mtActiveTenancies = (pid) => state.tenancies.filter((t) => t.property_id === pid && t.status === "active");
const mtTenantTenancy = (pid) => mtActiveTenancies(pid).find((t) => state.tenantOf.has(t.id));
const mtSortEvents = (events) => events.sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : new Date(a.created_at) - new Date(b.created_at)));
const mtFinished = (rows) => rows.filter(act.isFinishedMaintenance)
  .sort((a, b) => new Date(b.resolved_at || b.updated_at) - new Date(a.resolved_at || a.updated_at));
const mtBack = (href = "#vedlikehold", label = "Vedlikehold") => {
  const a = h("a", "pt-mt-back", `← ${label}`);
  a.href = href;
  return a;
};
const mtPicker = (label, date, time) => {
  // Native date/time inputs: the browser's picker closes as soon as a date is chosen.
  const wrap = h("div", "pt-mt-picker");
  const d = h("input", "pt-input");
  d.type = "date";
  d.value = date;
  d.min = todayISO();
  d.setAttribute("aria-label", label);
  const t = h("input", "pt-input");
  t.type = "time";
  t.value = time;
  t.setAttribute("aria-label", "Klokkeslett");
  wrap.append(h("span", "pt-field-label", label), d, t);
  return { wrap, value: () => (d.value && t.value ? `${d.value}T${t.value}` : null) };
};
const mtThumb = (load, alt) => {
  const img = h("img", "pt-mt-thumb");
  img.alt = alt;
  load().then((url) => { if (url) img.src = url; });
  return img;
};

const maintenanceForm = async (pid) => {
  const manager = isManager(pid);
  const fields = [
    { name: "title", label: "Tittel", type: "text", required: true, maxLength: 160, placeholder: "Kort beskrivelse av problemet" },
    { name: "description", label: "Beskrivelse", type: "textarea", required: true, maxLength: 5000, rows: 5, help: "Beskriv problemet før du sender inn saken." },
    { name: "category", label: "Kategori", type: "select", options: act.MAINTENANCE_CATEGORIES, value: "other", required: true },
    { name: "priority", label: "Prioritet", type: "select", options: act.MAINTENANCE_PRIORITIES, value: "normal", required: true },
  ];
  if (manager) {
    const tenancies = mtActiveTenancies(pid);
    const people = await tenancyPeople(pid);
    const names = new Map();
    for (const m of people.data ?? []) if (m.role === "tenant" && m.name) names.set(m.tenancy_id, [...(names.get(m.tenancy_id) ?? []), m.name]);
    fields.push({
      name: "visibility", label: "Synlighet", type: "select", required: true, value: "private",
      options: [["private", "Kun for utleiere"], ...tenancies.map((t) => [t.id, `Delt med leietaker – ${(names.get(t.id) ?? ["leietaker"]).join(", ")}`])],
      help: tenancies.length ? "Velg hvilket leieforhold saken gjelder, eller velg at saken kun skal være synlig for utleiere." : "Ingen aktiv leietaker er knyttet til denne boligen.",
    });
  }
  fields.push({ name: "images", label: "Bilder", type: "file", accept: "image/*", multiple: true, help: `Du kan legge ved opptil ${act.MAINTENANCE_IMAGE_LIMIT} bilder.` });
  await act.openForm({
    title: "Ny vedlikeholdssak",
    intro: "Ikke en nødtjeneste. Ved umiddelbar fare må du kontakte nødetater, vaktselskap eller riktig fagperson direkte.",
    fields,
    submitLabel: "Send inn sak",
    onSubmit: async (v) => {
      if (v.images.length > act.MAINTENANCE_IMAGE_LIMIT) return `En sak kan ha maksimalt ${act.MAINTENANCE_IMAGE_LIMIT} bilder.`;
      const tenancyId = manager ? (v.visibility === "private" ? null : v.visibility) : mtTenantTenancy(pid)?.id;
      if (!manager && !tenancyId) return "Du trenger et aktivt leieforhold for å melde inn en sak.";
      const res = await act.createMaintenance(pid, { tenancyId, title: v.title, description: v.description, category: v.category, priority: v.priority }, v.images);
      if (res.message) return res.message;
      location.hash = `vedlikehold/${res.requestId}`;
      refresh(res.imageError ? `Vedlikeholdssaken er opprettet, men ikke alle bildene ble lagt til. ${res.imageError}` : "Vedlikeholdssaken er opprettet.");
      return null;
    },
  });
};

const maintenanceRow = (r) => {
  const a = h("a", "pt-mt-row");
  a.href = `#vedlikehold/${r.id}`;
  const main = h("div", "pt-row-main");
  main.append(h("strong", null, r.title), h("span", null, `Prioritet: ${mtPriority(r.priority)} · Sist oppdatert ${dateText(r.last_activity_at || r.updated_at)}`));
  a.append(icon("wrench"), main, mtStatusChip(r));
  return a;
};
const maintenanceHistoryCard = (r) => {
  const a = h("a", "pt-mt-history-card");
  a.href = `#vedlikehold/${r.id}`;
  const main = h("div", "pt-row-main");
  main.append(h("strong", null, r.title), h("span", null, `${mtCategory(r.category)} · ${dateText(r.resolved_at || r.updated_at)}`));
  a.append(main, mtStatusChip(r), icon("chevron", "pt-icon-circle pt-mt-chevron"));
  return a;
};

const maintenanceList = async (pid) => {
  const manager = isManager(pid);
  const res = await act.listMaintenance(pid);
  const c = card("Vedlikehold", "wrench", manager ? ["Vedlikeholdshistorikk", "#vedlikehold/historikk"] : null);
  c.append(h("p", "pt-muted", manager ? "Følg opp innmeldte saker og registrer vedlikehold på boligen." : "Meld inn problemer og følg status på saker for leieforholdet ditt."));
  if (manager || mtTenantTenancy(pid)) c.append(actionsRow(button("+ Ny sak", "pt-btn-primary pt-btn-small", () => maintenanceForm(pid))));
  if (res.error) return [c, emptyPage("info", "Vedlikehold er ikke tilgjengelig", "Kontroller forbindelsen og prøv igjen.")];
  const rows = res.data ?? [];
  const active = rows.filter((r) => !act.isFinishedMaintenance(r));
  if (active.length) {
    const list = h("div", "pt-mt-list");
    list.append(...active.map(maintenanceRow));
    c.append(list);
  } else {
    const empty = h("div", "pt-mt-empty");
    empty.append(h("strong", null, "Ingen vedlikeholdssaker"), h("p", "pt-muted", manager || mtTenantTenancy(pid)
      ? "Opprett en sak når noe i boligen må følges opp."
      : "Du trenger et aktivt leieforhold for å melde inn en sak."));
    c.append(empty);
  }
  const nodes = [c];
  const finished = mtFinished(rows);
  if (!manager && finished.length) {
    const prev = card("Tidligere saker", "history");
    const list = h("div", "pt-mt-history-list");
    list.append(...finished.map(maintenanceHistoryCard));
    prev.append(list);
    nodes.push(prev);
  }
  return nodes;
};

/* ---------- Leiehistorikk (TenancyHistoryListPage / TenancyHistoryDetailPage) ---------- */
const historyBack = () => mtBack("#historikk", "Leiehistorikk");
const historyContact = (e) => {
  const main = h("div", "pt-row-main");
  main.append(h("strong", null, act.historyTitle(e)));
  [...act.historyPhones(e), ...act.historyEmails(e), act.historyPeriod(e.start_date, e.end_date)].filter(Boolean)
    .forEach((t) => main.append(h("span", null, t)));
  return main;
};
const historyRow = (main, actions = []) => {
  const row = h("li", "pt-row");
  const right = h("div", "pt-row-actions");
  right.append(...actions);
  row.append(main, right);
  return row;
};
const historyLine = (title, sub) => {
  const main = h("div", "pt-row-main");
  main.append(h("strong", null, title));
  if (sub) main.append(h("span", null, sub));
  return main;
};
const tenancyHistoryList = async (pid) => {
  const res = await act.listTenancyHistory(pid);
  const c = card("Leiehistorikk", "history");
  if (res.error) {
    c.append(h("p", "pt-muted", "Leiehistorikken kunne ikke lastes."), button("Prøv igjen", "pt-btn-secondary pt-btn-small", () => refresh()));
    return [c];
  }
  if (!res.data.length) return [emptyPage("history", "Leiehistorikk", "Ingen tidligere leieforhold ennå.")];
  const list = h("ul", "pt-list");
  list.append(...res.data.map((e) => {
    const open = h("a", "pt-btn-secondary pt-btn-small", "Åpne");
    open.href = `#historikk/${e.tenancy_id}`;
    return historyRow(historyContact(e), [open]);
  }));
  c.append(list);
  return [c];
};
const tenancyHistoryDetail = async (pid, tid) => {
  const res = await act.listTenancyHistory(pid);
  const e = res.data?.find((x) => x.tenancy_id === tid);
  if (!e) return [historyBack(), emptyPage("history", "Leieforholdet er ikke tilgjengelig", "Leiehistorikken kunne ikke lastes.")];
  const head = card(act.historyTitle(e), "history");
  head.append(h("p", "pt-chip", "Skrivebeskyttet"));
  const contact = h("ul", "pt-list");
  contact.append(historyRow(historyContact(e)));
  head.append(contact);
  const out = [historyBack(), head];
  const contracts = Array.isArray(e.contracts) ? e.contracts : [];
  if (contracts.length) {
    const c = card("Leiekontrakter", "doc");
    const list = h("ul", "pt-list");
    list.append(...contracts.map((k) => historyRow(historyLine(k.title || "Leiekontrakt", k.signed_at ? `Signert ${dateText(k.signed_at)}` : null),
      [pdfButton("Åpne", "pt-btn-secondary pt-btn-small", () => act.openListedDocument({ storage_path: k.storage_path, status: "ready", original_file_name: `${k.title || "Leiekontrakt"}.pdf` }))])));
    c.append(list);
    out.push(c);
  }
  const s = act.finishedSettlement(e.settlement);
  if (s) {
    const c = card("Depositumsoppgjør", "doc");
    const list = h("ul", "pt-list");
    if (s.document_storage_path) {
      list.append(historyRow(historyLine(s.document_title || "Depositumsoppgjør som PDF", s.deposit_amount_minor != null ? `Depositum ${money(s.deposit_amount_minor)}` : null),
        [pdfButton("Åpne", "pt-btn-secondary pt-btn-small", () => act.openListedDocument({ storage_path: s.document_storage_path, status: "ready", original_file_name: "depositumsoppgjor.pdf" }))]));
    } else if (s.deposit_amount_minor != null) list.append(historyRow(historyLine("Depositum", money(s.deposit_amount_minor))));
    c.append(list);
    const claims = Array.isArray(s.claims) ? s.claims : [];
    if (claims.length) {
      c.append(h("h3", null, "Krav"));
      const cl = h("ul", "pt-list");
      cl.append(...claims.map((k) => historyRow(historyLine(k.description, money(k.amount_minor)),
        k.receipt_path ? [pdfButton("Åpne dokumentasjon", "pt-btn-secondary pt-btn-small", () => act.openHistoryReceipt(k))] : [])));
      c.append(cl);
    }
    out.push(c);
  }
  const checklists = act.visibleChecklists(e.settlement, e.checklists);
  if (checklists.length) {
    const c = card("Sjekklister", "doc");
    const list = h("ul", "pt-list");
    list.append(...checklists.map((k) => historyRow(historyLine(k.type === "move_in" ? "Innflytting" : "Utflytting",
      [HO_MARK[k.protocol_mark], k.finalized_at ? `Ferdigstilt ${dateText(k.finalized_at)}` : null].filter(Boolean).join(" · ")))));
    c.append(list);
    out.push(c);
  }
  return out;
};

const maintenanceHistory = async (pid) => {
  if (!isManager(pid)) return maintenanceList(pid);
  const res = await act.listMaintenance(pid);
  const intro = h("section", "pt-card pt-mt-history-intro");
  const head = h("div", "pt-mt-history-head");
  const mascot = h("img", "pt-mt-mascot");
  mascot.src = "/brand/house-mascot-happy.png";
  mascot.alt = "";
  const toggle = h("button", "pt-mt-info-toggle");
  toggle.type = "button";
  toggle.append(icon("info", "pt-mt-info-icon"));
  toggle.setAttribute("aria-label", "Les mer");
  toggle.setAttribute("aria-expanded", "false");
  const info = h("p", "pt-mt-info", "Vedlikehold med kvitteringer kan i mange tilfeller gi skattefradrag. Bilder, beskrivelser og datoer kan være nyttig dersom Skatteetaten etterspør dokumentasjon.\n\nVed skade eller reklamasjon kan bilder, tidslinje og kommunikasjon være viktig for å dokumentere hva som har skjedd.");
  info.hidden = true;
  toggle.addEventListener("click", () => {
    info.hidden = !info.hidden;
    toggle.setAttribute("aria-label", info.hidden ? "Les mer" : "Skjul");
    toggle.setAttribute("aria-expanded", String(!info.hidden));
  });
  head.append(mascot, h("p", null, "God vedlikeholdsdokumentasjon gir deg oversikt og gjør det enklere å følge opp boligen over tid."), toggle);
  intro.append(head, info);
  const c = card("Vedlikeholdshistorikk", "history");
  if (res.error) c.append(inline("Kunne ikke hente vedlikeholdssakene. Prøv igjen."));
  else {
    const finished = mtFinished(res.data ?? []);
    if (!finished.length) c.append(inline("Ingen avsluttede saker"));
    else {
      const list = h("div", "pt-mt-history-list");
      list.append(...finished.map(maintenanceHistoryCard));
      c.append(list);
    }
  }
  return [mtBack(), intro, c];
};

const maintenanceDetail = async (pid, rid) => {
  const token = renderToken;
  const manager = isManager(pid);
  const first = await act.getMaintenance(rid);
  if (first.error || !first.data || first.data.property_id !== pid) {
    return [mtBack(), emptyPage("info", "Saken er ikke tilgjengelig", "Vedlikeholdssaken finnes ikke lenger eller er ikke tilgjengelig.")];
  }
  const st = { request: first.data, events: [], images: [], documents: [], items: [], responses: new Map(), names: new Map(), reporter: null, photos: [] };
  const finished = () => act.isFinishedMaintenance(st.request);
  const loadEvents = async () => {
    const r = await act.listMaintenanceEvents(rid);
    if (r.error) return;
    st.events = mtSortEvents(r.data ?? []);
    const missing = [...new Set(st.events.map((e) => e.actor_id).filter((id) => id && !st.names.has(id)))];
    if (missing.length) {
      const m = await act.linkedContactNames(missing);
      missing.forEach((id) => st.names.set(id, m.get(id) ?? null));
    }
  };
  const loadAttachments = async () => {
    const [img, doc] = await Promise.all([act.listMaintenanceImages(rid), act.listMaintenanceDocuments(rid)]);
    st.images = (img.data ?? []).filter((i) => i.status === "ready");
    st.documents = (doc.data ?? []).filter((d) => d.status === "ready");
  };
  const loadSchedule = async () => {
    const [items, responses] = await Promise.all([act.maintenanceCalendarItems(rid), manager ? act.calendarResponses(pid) : Promise.resolve({ data: [] })]);
    st.items = (items.data ?? []).filter((i) => i.status !== "cancelled");
    st.responses = new Map((responses.data ?? []).map((r) => [r.calendar_item_id, r]));
  };
  const loadReporter = async () => {
    if (!(await act.maintenanceReporterIsTenant(st.request))) return;
    const m = await act.linkedContactNames([st.request.created_by]);
    st.reporter = m.get(st.request.created_by) ?? "leietaker";
  };
  await Promise.all([loadEvents(), loadAttachments(), loadSchedule(), loadReporter()]);

  const wrap = h("div", "pt-mt-detail");
  const timelineList = h("ol", "pt-mt-timeline");
  const timelineEmpty = inline("Ingen historikk er tilgjengelig ennå.");
  const reloadRequest = async (message) => {
    const r = await act.getMaintenance(rid);
    if (r.data) st.request = r.data;
    await Promise.all([loadEvents(), loadSchedule()]);
    draw();
    if (message) act.toast(message);
  };
  const run = async (res, message) => {
    const err = rpcError(res);
    if (err) return act.toast(err);
    await reloadRequest(message);
  };

  const summary = () => {
    const r = st.request;
    const c = h("section", "pt-card");
    const head = h("div", "pt-card-head");
    head.append(icon("wrench"), h("h2", null, r.title), mtStatusChip(r));
    const chips = h("div", "pt-mt-chips");
    chips.append(
      h("span", "pt-chip is-info", `Prioritet: ${mtPriority(r.priority)}`),
      h("span", "pt-chip is-info", mtCategory(r.category)),
      h("span", "pt-chip is-info", r.tenancy_id ? "Delt med leietaker" : "Kun for utleiere"),
    );
    c.append(head, chips, h("p", "pt-mt-description", r.description));
    c.append(h("p", "pt-muted", [`Opprettet ${dateText(r.created_at)}`, st.reporter ? `Innmeldt av ${st.reporter}` : null, `Sist oppdatert ${dateText(r.last_activity_at || r.updated_at)}`].filter(Boolean).join(" · ")));
    if (manager && !finished()) {
      const next = (act.MAINTENANCE_NEXT[r.status] ?? []).filter((s) => s !== "resolved");
      const tenancies = mtActiveTenancies(pid);
      c.append(actionsRow(
        button("Endre prioritet", "pt-btn-soft pt-btn-small", () => act.openForm({
          title: "Prioritet", fields: [{ name: "priority", label: "Prioritet", type: "select", options: act.MAINTENANCE_PRIORITIES, value: r.priority, required: true }],
          onSubmit: async (v) => {
            if (v.priority === r.priority) return null;
            const res = await act.setMaintenancePriority(r.id, v.priority);
            if (res.error) return act.explain(res.error);
            reloadRequest("Vedlikeholdssaken er oppdatert.");
            return null;
          },
        })),
        next.length ? button("Endre status", "pt-btn-soft pt-btn-small", () => act.openForm({
          title: "Endre status", fields: [{ name: "status", label: "Status", type: "select", options: next.map((s) => [s, act.MAINTENANCE_STATUS[s]]), required: true }],
          onSubmit: async (v) => {
            const res = await act.setMaintenanceStatus(r, v.status);
            if (res.error) return act.explain(res.error);
            reloadRequest("Vedlikeholdssaken er oppdatert.");
            return null;
          },
        })) : null,
        !r.tenancy_id && tenancies.length ? button("Del med leietaker", "pt-btn-soft pt-btn-small", async () => {
          const people = await tenancyPeople(pid);
          const names = new Map();
          for (const m of people.data ?? []) if (m.role === "tenant" && m.name) names.set(m.tenancy_id, [...(names.get(m.tenancy_id) ?? []), m.name]);
          act.openForm({
            title: "Del med leietaker?",
            intro: "Når saken deles, får leietakeren tilgang til saken, kommentarer og historikk samt eventuelle bilder som er knyttet til saken. Dokumenter følger sine egne tilgangsregler. Eksisterende private kalenderfrister deles ikke automatisk.",
            fields: [{ name: "tenancy", label: "Velg leieforhold", type: "select", required: true, options: tenancies.map((t) => [t.id, (names.get(t.id) ?? ["Leietaker"]).join(", ")]) }],
            submitLabel: "Del med leietaker",
            onSubmit: async (v) => {
              const res = await act.shareMaintenance(r.id, v.tenancy);
              if (res.error) return act.explain(res.error);
              reloadRequest("Vedlikeholdssaken er delt med leietakeren.");
              return null;
            },
          });
        }) : null,
      ));
    }
    return c;
  };

  const finishedCard = () => {
    const r = st.request;
    const c = h("section", "pt-card pt-mt-finished");
    const head = h("div", "pt-card-head");
    head.append(icon("check", "pt-icon-circle is-success"), h("h2", null, "Vedlikeholdssaken er ferdigstilt"));
    c.append(head, h("p", "pt-muted", "Saken er låst. Bilder og tidslinje er beholdt som historikk."));
    const tenancyOk = !r.tenancy_id || state.tenancies.some((t) => t.id === r.tenancy_id && t.status === "active");
    if (manager && tenancyOk) {
      c.append(actionsRow(button("Gjenåpne saken", "pt-btn-secondary pt-btn-small", async () => run(await act.setMaintenanceStatus(r, "in_progress"), "Vedlikeholdssaken er oppdatert."))));
    }
    return c;
  };

  const filePicker = (accept, onFiles, multiple = false) => {
    const input = h("input", "pt-visually-hidden");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener("change", () => { const files = [...input.files]; input.value = ""; if (files.length) onFiles(files); });
    return input;
  };

  const imagesCard = () => {
    const c = card("Bilder", "photo");
    if (st.images.length) {
      const grid = h("div", "pt-mt-thumbs");
      grid.append(...st.images.map((i) => mtThumb(() => act.maintenanceImageUrl(i.storage_path), i.caption || "Bilde i vedlikeholdssaken")));
      c.append(grid, h("p", "pt-muted", `${st.images.length} av ${act.MAINTENANCE_IMAGE_LIMIT} bilder`));
    } else c.append(inline("Ingen bilder er lagt til saken ennå."));
    if (!finished() && st.images.length < act.MAINTENANCE_IMAGE_LIMIT) {
      const input = filePicker("image/*", async ([file]) => {
        const err = await act.uploadMaintenanceImage(rid, file);
        if (err) return act.toast(err);
        await loadAttachments();
        draw();
        act.toast("Bildet er lagt til saken.");
      });
      c.append(input, actionsRow(button("Legg til", "pt-btn-soft pt-btn-small", () => input.click())));
    }
    return c;
  };

  const documentsCard = () => {
    if (!manager && !st.documents.length) return null;
    const c = card("Dokumenter", "doc");
    if (st.documents.length) {
      const list = h("ul", "pt-list");
      for (const d of st.documents) {
        const li = h("li", "pt-row");
        const main = h("div", "pt-row-main");
        main.append(h("strong", null, d.title || d.original_file_name || "Dokument"), h("span", null, dateText(d.created_at)));
        li.append(icon("doc"), main, pdfButton("Åpne", "pt-btn-soft pt-btn-small", () => act.documentPdf(d.id)));
        list.append(li);
      }
      c.append(list);
    } else c.append(inline("Ingen dokumenter er lagt til saken ennå."));
    if (manager && !finished() && st.documents.length < act.MAINTENANCE_DOCUMENT_LIMIT) {
      const input = filePicker("application/pdf", async ([file]) => {
        const err = await act.uploadMaintenanceDocument(rid, file);
        if (err) return act.toast(err);
        await loadAttachments();
        draw();
        act.toast("Dokumentet er lagt til saken.");
      });
      c.append(input, actionsRow(button("Legg til dokument", "pt-btn-soft pt-btn-small", () => input.click())));
    }
    return c;
  };

  // Planlagt dato for fiks: one visit with date and time, no deadline.
  const scheduleCard = () => {
    if (!manager || finished() || st.items.length) return null;
    const c = card("Planlagt dato for fiks", "calendar");
    c.append(h("p", "pt-muted", "Velg når saken skal fikses. Leietaker ser datoen og får den i kalenderen."));
    const tomorrow = new Date(Date.now() + 86_400_000);
    const picker = mtPicker("Planlagt dato", localParts(tomorrow.toISOString()).date, "09:00");
    c.append(picker.wrap, actionsRow(button("Legg i kalenderen", "pt-btn-primary pt-btn-small", async (e) => {
      const at = picker.value();
      if (!at) return act.toast("Velg dato og klokkeslett.");
      e.currentTarget.disabled = true;
      const res = await act.scheduleMaintenanceVisit(st.request, at);
      const err = rpcError(res);
      if (err) { e.currentTarget.disabled = false; return act.toast(err); }
      await loadSchedule();
      draw();
      act.toast("Planlagt dato er lagt i kalenderen.");
    })));
    return c;
  };

  const plannedCard = () => {
    if (!st.items.length) return null;
    const c = card("Planlagt dato for fiks", "calendar");
    for (const item of st.items) {
      const at = item.starts_at || item.due_at;
      const row = h("div", "pt-mt-planned");
      const pills = h("div", "pt-mt-pills");
      pills.append(h("span", "pt-mt-pill", dateText(at)));
      if (!item.all_day && at) pills.append(h("span", "pt-mt-pill", mtTime(at)));
      const overdue = item.status === "active" && at && new Date(at) < new Date() && !finished();
      pills.append(h("span", `pt-chip ${overdue ? "is-warning" : item.status === "completed" ? "is-success" : "is-info"}`,
        overdue ? "Forfalt" : item.status === "completed" ? "Fullført" : "Aktiv"));
      row.append(pills);
      if (overdue && manager) row.append(h("p", "pt-mt-followup", "Vedlikeholdssaken trenger oppfølging. Den planlagte datoen har passert."));
      const shared = !!item.tenancy_id && item.status === "active";
      if (shared && manager) {
        const resp = st.responses.get(item.id);
        const decision = resp?.decision ?? item.tenant_response;
        const comment = resp?.comment ?? item.tenant_response_comment;
        if (decision === "accepted") row.append(responseBox("is-success", "Godkjent av leietaker"));
        else if (decision === "declined") {
          row.append(responseBox("is-danger", "Avslått av leietaker", comment || "Svaret ligger i chatten."));
          if (!finished()) {
            const p = localParts(at);
            const picker = mtPicker("Velg ny dato", p.date, p.time);
            row.append(picker.wrap, actionsRow(button("Send ny dato til leietaker", "pt-btn-primary pt-btn-small", async (e) => {
              const next = picker.value();
              if (!next) return act.toast("Velg dato og klokkeslett.");
              e.currentTarget.disabled = true;
              const err = rpcError(await act.rescheduleMaintenanceVisit(item, next));
              if (err) { e.currentTarget.disabled = false; return act.toast(err); }
              await loadSchedule();
              draw();
              act.toast("Ny dato er sendt til leietaker.");
            })));
          }
        } else row.append(responseBox("is-warning", "Venter på svar fra leietaker", "Leietaker har ikke svart på den planlagte datoen ennå."));
      } else if (shared && !manager && !finished()) {
        if (item.tenant_response === "accepted") row.append(responseBox("is-success", "Godkjent av leietaker"));
        else if (item.tenant_response === "declined") row.append(responseBox("is-danger", "Avslaget er sendt i chat", item.tenant_response_comment || "Svaret ligger i chatten."));
        else {
          row.append(responseBox("is-warning", "Passer denne dagen?", "Godta hendelsen, eller avslå og skriv i chatten hvilken dag som passer bedre."));
          const respond = async (decision, comment) => {
            const res = await act.respondToCalendarItem(item.id, decision, comment);
            if (res.error) return "Svaret kunne ikke sendes";
            await loadSchedule();
            draw();
            // iOS #1514: accepting a planned maintenance date shows no «Du har godtatt hendelsen».
            if (decision === "declined") act.toast("Avslaget er sendt i chat");
            return null;
          };
          row.append(actionsRow(
            button("Godta", "pt-btn-primary pt-btn-small", async () => { const err = await respond("accepted"); if (err) act.toast(err); }),
            button("Avslå", "pt-btn-secondary pt-btn-small", () => act.openForm({
              title: "Avslå hendelsen",
              fields: [{ name: "comment", label: "Kommentar", type: "textarea", rows: 3, maxLength: 1000, placeholder: "Hvilken dag passer bedre?", help: "Kommentaren sendes til utleier i chat, så dere kan avtale en annen dag der." }],
              submitLabel: "Send avslag",
              onSubmit: (v) => respond("declined", v.comment),
            })),
          ));
        }
      }
      c.append(row);
    }
    return c;
  };

  const drawTimeline = () => {
    timelineList.replaceChildren();
    timelineEmpty.hidden = st.events.length > 0;
    for (const e of st.events) {
      const li = h("li", `pt-mt-event${e.event_type === "comment" ? " is-comment" : ""}`);
      li.dataset.eventId = e.id;
      const body = h("div", "pt-mt-event-body");
      body.append(h("strong", null, mtEventTitle(e)));
      const photos = Array.isArray(e.comment_attachments) ? e.comment_attachments : [];
      const text = e.comment && !(photos.length && e.comment === act.COMMENT_PHOTO_ONLY) ? e.comment : null;
      if (text) body.append(h("p", null, text));
      if (photos.length) {
        const grid = h("div", "pt-mt-thumbs");
        grid.append(...photos.map((ph) => mtThumb(() => act.commentPhotoUrl(ph.storage_path), "Bilde i kommentaren")));
        body.append(grid);
      }
      const name = e.actor_id ? (e.actor_id === state.user.id ? "Du" : st.names.get(e.actor_id)) : null;
      if (name) body.append(h("span", "pt-mt-actor", name));
      body.append(h("span", "pt-mt-time", mtDateTime(e.created_at)));
      li.append(icon(MT_EVENT_ICONS[e.event_type] ?? "history"), body);
      timelineList.append(li);
    }
  };

  // Composer is built once so a half-written comment survives realtime redraws.
  const composer = h("div", "pt-mt-composer");
  const textarea = h("textarea", "pt-input pt-textarea");
  textarea.rows = 3;
  textarea.maxLength = 4000;
  textarea.placeholder = "Skriv en kommentar …";
  textarea.setAttribute("aria-label", "Kommentar til vedlikeholdssaken");
  const chosen = h("div", "pt-mt-chosen");
  const drawChosen = () => {
    chosen.replaceChildren(...st.photos.map((f, i) => {
      const chip = h("span", "pt-chip is-info pt-mt-chosen-chip", f.name || "Bilde");
      const x = button("Fjern bilde", "pt-btn-quiet-destructive pt-btn-small", () => { st.photos.splice(i, 1); drawChosen(); });
      chip.append(x);
      return chip;
    }));
  };
  const photoInput = filePicker("image/*", (files) => {
    if (st.photos.length + files.length > act.COMMENT_PHOTO_LIMIT) act.toast(`Du kan legge ved opptil ${act.COMMENT_PHOTO_LIMIT} bilder.`);
    st.photos = [...st.photos, ...files].slice(0, act.COMMENT_PHOTO_LIMIT);
    drawChosen();
  }, true);
  const send = button("Send kommentar", "pt-btn-primary pt-btn-small", async () => {
    if (!textarea.value.trim() && !st.photos.length) return act.toast("Skriv en kommentar før du sender. Lukkede saker må gjenåpnes først.");
    send.disabled = true;
    const err = await act.addMaintenanceComment(st.request, textarea.value, st.photos);
    send.disabled = false;
    if (err) return act.toast(err);
    textarea.value = "";
    st.photos = [];
    drawChosen();
    await loadEvents();
    drawTimeline();
    act.toast("Kommentaren er lagt til.");
  });
  composer.append(textarea, chosen, photoInput, actionsRow(button("Legg ved bilde", "pt-btn-soft pt-btn-small", () => photoInput.click()), send));

  const timelineCard = () => {
    const c = card("Tidslinje", "history");
    drawTimeline();
    c.append(timelineEmpty, timelineList);
    if (!finished()) c.append(composer);
    return c;
  };

  const resolveRow = () => {
    if (!manager || finished() || !(act.MAINTENANCE_NEXT[st.request.status] ?? []).includes("resolved")) return null;
    return actionsRow(button("Marker saken som løst", "pt-btn-primary", async () => {
      const ok = await act.confirmAction({
        title: "Ferdigstill vedlikeholdssak?",
        text: "Saken låses etter ferdigstilling. Ingen kan kommentere, redigere eller slette innhold. Hele saken beholdes som historikk. Du kan gjenåpne saken ved behov.",
        confirmLabel: "Ferdigstill saken",
      });
      if (ok) run(await act.setMaintenanceStatus(st.request, "resolved"), "Vedlikeholdssaken er oppdatert.");
    }));
  };

  const draw = () => {
    wrap.replaceChildren(...[
      mtBack(finished() && manager ? "#vedlikehold/historikk" : "#vedlikehold", finished() && manager ? "Vedlikeholdshistorikk" : "Vedlikehold"),
      summary(), finished() ? finishedCard() : null, imagesCard(), documentsCard(), scheduleCard(), plannedCard(), timelineCard(), resolveRow(),
    ].filter(Boolean));
  };
  draw();

  // iOS #1506: live timeline; RLS decides what arrives, the list dedupes by id.
  if (token === renderToken) {
    setPageCleanup(act.subscribeMaintenance(rid, {
      onEvent: async (row) => {
        if (st.events.some((e) => e.id === row.id)) return;
        st.events = mtSortEvents([...st.events, row]);
        if (row.actor_id && !st.names.has(row.actor_id)) {
          const m = await act.linkedContactNames([row.actor_id]);
          st.names.set(row.actor_id, m.get(row.actor_id) ?? null);
        }
        if (/^(image|document)_/.test(row.event_type)) { await loadAttachments(); draw(); }
        else if (MT_RELOAD_REQUEST.has(row.event_type)) await reloadRequest();
        else drawTimeline();
      },
      onResync: async () => { await loadEvents(); drawTimeline(); },
    }));
  }
  return [wrap];
};

/* ---------- Inn- og utflytting (PropertyHandoverSection, MoveOutFlow, DepositSettlementView) ---------- */
const HO_AREA = new Map(act.INSPECTION_AREAS);
const HO_CONDITION = new Map(act.INSPECTION_CONDITIONS);
const HO_KEY_KIND = { frontDoor: "Hoveddør", mailbox: "Postkasse", storage: "Bod", commonArea: "Fellesareal", garage: "Garasje" };
const HO_METER = { electricity: "Strøm (kWh)", water: "Vann (m³)", heating: "Fjernvarme (MWh)" };
const HO_POINT_PREFIX = "property.detail.handover.";
const HO_POINTS = {
  "moveIn.item.appliances": "Sjekk at alle hvitevarer fungerer", "moveIn.item.electricity": "Kontroller strøm og bryterskap",
  "moveIn.item.keys": "Sjekk at alle nøkler er levert", "moveIn.item.lamps": "Sjekk at alle lamper fungerer",
  "moveIn.item.meters": "Registrer målerstander (strøm/vann)", "moveIn.item.photo": "Fotografer hele boligen",
  "moveIn.item.smoke": "Test røykvarslere og brannslukker", "moveIn.item.taps": "Sjekk vannkraner og toalett",
  "moveIn.item.walls": "Kontroller vegger og gulv for skader", "moveIn.item.windows": "Test alle vinduer og dører",
  "moveOut.item.appliances": "Rens kjøleskap og ovn", "moveOut.item.belongings": "Fjern alle personlige eiendeler",
  "moveOut.item.cleaning": "Rengjøring av hele boligen", "moveOut.item.damage": "Sjekk at intet er ødelagt",
  "moveOut.item.floors": "Kontroller gulv for riper/skader", "moveOut.item.internet": "Avslutt internett og abonnement",
  "moveOut.item.keys": "Lever alle nøkler", "moveOut.item.meters": "Registrer avsluttende målerstander",
  "moveOut.item.photo": "Fotografer boligen ved utflytting", "moveOut.item.walls": "Sjekk vegger – hull og merker",
};
const HO_MARK = {
  tenant_confirmed: "Bekreftet av leietaker",
  landlord_prepared: "Utarbeidet av utleier. Ikke nødvendigvis godkjent av begge.",
  not_confirmed_by_tenant: "Ikke bekreftet av leietaker",
};
const HO_SCOPE = { whole_tenancy: "Hele leieforholdet", one_room: "Ett rom", one_tenant: "Én leietaker" };
const hoBack = () => mtBack("#inn-utflytting", "Inn- og utflytting");
let hoTenancyId = null;
const hoTenancies = (pid) => state.tenancies.filter((t) => t.property_id === pid && t.status === "active" && (isManager(pid) || state.tenantOf.has(t.id)));
const hoTenancy = (pid) => {
  const list = hoTenancies(pid);
  return list.find((t) => t.id === hoTenancyId) ?? list[0] ?? null;
};
const hoLatest = (rows, test) => [...rows].reverse().find(test) ?? null;
const hoLoad = async (t) => {
  const [insp, proc, dep] = await Promise.all([act.listInspections(t.id), act.listMoveOutProcesses([t.id]), act.depositPointer(t.id)]);
  if (insp.error || proc.error) return null;
  const list = insp.data ?? [];
  const procs = proc.data ?? [];
  const process = hoLatest(procs, (p) => act.OPEN_MOVE_OUT.includes(p.state)) ?? hoLatest(procs, (p) => p.state === "ended");
  const moveOut = process?.inspection_id ? list.find((i) => i.id === process.inspection_id) ?? null : null;
  return { moveIn: hoLatest(list, (i) => i.type === "move_in"), moveOut, process, deposit: dep.error ? null : dep.data ?? null };
};
const hoChip = ([text, tone]) => h("span", `pt-chip${tone}`, text);
const hoMoveInStatus = (i, manager) => {
  if (!i) return ["Ikke startet", ""];
  if (i.status === "finalized") {
    if (i.protocol_mark === "tenant_confirmed") return ["Bekreftet av leietaker", " is-success"];
    if (i.sent_for_review_at && !i.tenant_decision) return manager ? ["Venter på leietaker", " is-warning"] : ["Klar til godkjenning", " is-warning"];
    return ["Ferdigstilt", " is-success"];
  }
  if (manager && i.tenant_may_fill && !i.tenant_fill_done_at) return ["Venter på leietaker", " is-warning"];
  return ["Pågår", " is-warning"];
};
const hoMoveOutStatus = (d) => {
  const s = d.process?.state;
  if (!s) return ["Ikke startet", ""];
  if (s === "ended") return ["Ferdig", " is-success"];
  if (d.moveOut?.status === "finalized" || s === "approved" || s === "deposit") return ["Ferdigstilt", " is-success"];
  if (s === "notice_given") return ["Oppsigelsen er registrert", " is-info"];
  return ["Pågår", " is-warning"];
};
const hoDepositStatus = (d) => {
  if (!d.deposit) return d.moveOut?.status === "finalized" ? ["Ikke startet", ""] : ["Låst", ""];
  const s = d.deposit.status;
  if (s === "accepted" || s === "full_refund") return ["Ferdig", " is-success"];
  if (s === "claims_pending") return ["Venter på leietaker", " is-warning"];
  if (s === "open" || s === "declined") return ["Pågår", " is-warning"];
  return ["Uenighet", " is-danger"];
};
const hoReloadPage = async (message) => {
  state.cache.clear();
  await render();
  if (message) act.toast(message);
};
const hoRun = async (res, errorOf, message) => {
  const err = errorOf(res);
  if (err) {
    act.toast(err);
    return false;
  }
  await hoReloadPage(message);
  return true;
};

const hoConditionChip = (item) => {
  const tone = { ok: " is-success", note: " is-warning", damage: " is-danger" }[item.condition] ?? "";
  return h("span", `pt-chip${tone}`, item.condition ? HO_CONDITION.get(item.condition) ?? item.condition : "Ikke fylt ut");
};
const hoSaveFailed = async (res) => {
  act.toast(act.inspectionError(res) ?? "Kunne ikke lagre punktet. Prøv igjen.");
  if (/version_conflict/.test(String(res.error?.message))) await hoReloadPage();
};
const hoChecklist = (items, editable) => {
  const c = card("Tilstand i boligen", "checklist");
  const list = h("ul", "pt-ho-items");
  for (const item of items) {
    const li = h("li", "pt-ho-item");
    const head = h("div", "pt-ho-item-head");
    head.append(h("strong", null, HO_AREA.get(item.area_code) ?? item.area_code));
    const visible = item.area_code === "other" ? act.visibleNote(item.note) : (item.note ?? "").trim();
    if (!editable) {
      head.append(hoConditionChip(item));
      li.append(head);
      if (visible) li.append(h("p", "pt-ho-note", visible));
      list.append(li);
      continue;
    }
    const sel = h("select", "pt-select pt-ho-condition");
    sel.setAttribute("aria-label", "Tilstand");
    if (!item.condition) {
      const o = h("option", null, "Velg tilstand");
      o.value = "";
      sel.append(o);
    }
    for (const [v, l] of act.INSPECTION_CONDITIONS) {
      const o = h("option", null, l);
      o.value = v;
      sel.append(o);
    }
    sel.value = item.condition ?? "";
    const note = h("textarea", "pt-input pt-textarea");
    note.rows = 2;
    note.placeholder = "Valgfri merknad";
    note.setAttribute("aria-label", "Valgfri merknad");
    note.value = visible;
    const save = button("Lagre", "pt-btn-secondary pt-btn-small", async () => {
      if (!sel.value) return act.toast("Velg tilstand.");
      const text = item.area_code === "other" ? act.withVisibleNote(item.note, note.value) : note.value.trim();
      if ((text ?? "").length > act.INSPECTION_NOTE_LIMIT) return act.toast("Merknaden er for lang.");
      save.disabled = true;
      const res = await act.updateInspectionItem(item, sel.value, text);
      save.disabled = false;
      if (res.error || !res.data) return hoSaveFailed(res);
      Object.assign(item, { condition: res.data.condition, note: res.data.note, updated_at: res.data.updated_at });
      act.toast("Lagret.");
    });
    head.append(sel);
    li.append(head, note, actionsRow(save));
    list.append(li);
  }
  c.append(list);
  return c;
};
// Shared data the app keeps on the "Annet" note: checklist points, keys and meters.
const hoShared = (items, phase, editable) => {
  const other = items.find((i) => i.area_code === "other");
  const data = other ? act.handoverData(other.note) : null;
  if (!data) return null;
  const listKey = phase === "move_out" ? "out" : "in";
  const c = card("Nøkler, målere og sjekkpunkter", "key");
  const points = (Array.isArray(data[listKey]) ? data[listKey] : []).map((row, index) => ({ row, index }))
    .filter(({ row }) => row && !row.x && (row.k || row.t));
  if (points.length) {
    c.append(h("p", "pt-label", "Sjekkliste"));
    const ul = h("ul", "pt-ho-checks");
    for (const { row, index } of points) {
      const li = h("li", "pt-ho-check");
      const label = h("label");
      const box = h("input");
      box.type = "checkbox";
      box.checked = row.d === true;
      box.disabled = !editable;
      label.append(box, h("span", null, row.t || HO_POINTS[String(row.k).replace(HO_POINT_PREFIX, "")] || "Sjekkpunkt"));
      li.append(label);
      if (row.c) li.append(h("p", "pt-ho-note", row.c));
      box.addEventListener("change", async () => {
        const next = act.withChecklistDone(other.note, listKey, index, box.checked);
        if (!next || next.length > act.INSPECTION_NOTE_LIMIT) {
          box.checked = !box.checked;
          return act.toast("Kunne ikke lagre punktet. Prøv igjen.");
        }
        box.disabled = true;
        const res = await act.updateInspectionItem(other, other.condition ?? "ok", next);
        box.disabled = false;
        if (res.error || !res.data) {
          box.checked = !box.checked;
          return hoSaveFailed(res);
        }
        Object.assign(other, { condition: res.data.condition, note: res.data.note, updated_at: res.data.updated_at });
      });
      ul.append(li);
    }
    c.append(ul);
  }
  const keys = (Array.isArray(data.keys) ? data.keys : []).filter((k) => HO_KEY_KIND[k?.kind]);
  if (keys.length) {
    c.append(h("p", "pt-label", "Nøkler"));
    const dl = h("dl", "pt-facts");
    for (const k of keys) {
      const d = h("div");
      const counts = [`Utlevert ${Number(k.issued) || 0}`];
      if (phase === "move_out") counts.push(`Levert tilbake ${Number(k.returned) || 0}`);
      d.append(h("dt", null, HO_KEY_KIND[k.kind]), h("dd", null, counts.join(" · ")));
      dl.append(d);
    }
    c.append(dl);
  }
  const meters = (Array.isArray(data.meters) ? data.meters : []).filter((m) => HO_METER[m?.kind] && !m.na && (m.in || m.out));
  if (meters.length) {
    c.append(h("p", "pt-label", "Målerstander"));
    const dl = h("dl", "pt-facts");
    for (const m of meters) {
      const d = h("div");
      const values = [m.in ? `Ved innflytting ${m.in}` : null, phase === "move_out" && m.out ? `Ved utflytting ${m.out}` : null].filter(Boolean);
      d.append(h("dt", null, HO_METER[m.kind]), h("dd", null, values.join(" · ") || "Ikke registrert"));
      dl.append(d);
    }
    c.append(dl);
  }
  c.append(h("p", "pt-muted", "Nøkler, målerstander og bilder registreres i appen."));
  return c;
};
const hoComments = async (inspection, canComment) => {
  const c = card("Kommentarer", "chat");
  const list = h("ul", "pt-ho-comments");
  const draw = async () => {
    const res = await act.listInspectionComments(inspection.id);
    const rows = res.data ?? [];
    list.replaceChildren(...rows.map((r) => {
      const li = h("li", "pt-ho-comment");
      li.append(h("strong", null, r.author_role === "tenant" ? "Leietaker" : "Utleier"), h("span", "pt-muted", ` · ${mtDateTime(r.created_at)}`), h("p", null, r.body));
      return li;
    }));
    if (!rows.length) list.append(inline("Ingen kommentarer ennå."));
  };
  await draw();
  c.append(list);
  if (canComment) {
    const text = h("textarea", "pt-input pt-textarea");
    text.rows = 2;
    text.maxLength = 2000;
    text.placeholder = "Skriv en kommentar …";
    text.setAttribute("aria-label", "Kommentar");
    const add = button("Legg til kommentar", "pt-btn-secondary pt-btn-small", async () => {
      const body = text.value.trim();
      if (!body) return;
      add.disabled = true;
      const res = await act.addProtocolComment(inspection.id, body);
      add.disabled = false;
      if (res.error) return act.toast(act.inspectionError(res));
      text.value = "";
      await draw();
    });
    c.append(text, actionsRow(add));
  }
  return c;
};
const hoProtocolCards = async (inspection, editable, canComment) => {
  const items = await act.listInspectionItems(inspection.id);
  if (items.error) return [inline("Sjekklisten kunne ikke hentes akkurat nå.")];
  const rows = items.data ?? [];
  return [hoChecklist(rows, editable), hoShared(rows, inspection.type, editable), await hoComments(inspection, canComment)].filter(Boolean);
};
const hoTenantFillToggle = (i) => {
  const label = h("label", "pt-ho-toggle");
  const box = h("input");
  box.type = "checkbox";
  box.checked = Boolean(i.tenant_may_fill);
  box.addEventListener("change", async () => {
    box.disabled = true;
    const res = await act.setTenantMayFill(i.id, box.checked);
    box.disabled = false;
    if (res.error) {
      box.checked = !box.checked;
      return act.toast(act.inspectionError(res));
    }
    i.tenant_may_fill = box.checked;
  });
  label.append(box, h("span", null, "La leietaker fylle ut"));
  return label;
};

const hoMoveInPage = async (p, t, d) => {
  const manager = isManager(p.id);
  const i = d.moveIn;
  const head = card("Innflytting", "checklist");
  head.querySelector(".pt-card-head").append(hoChip(hoMoveInStatus(i, manager)));
  if (!i) {
    if (!manager) {
      head.append(h("p", "pt-muted", "Innflytting åpnes når utleier har startet den."));
      return [hoBack(), head];
    }
    head.append(h("p", "pt-muted", "Sjekklister ved inn- og utflytting gir en trygg oversikt og kan brukes som dokumentasjon ved depositumsoppgjør."),
      actionsRow(button("Start innflytting", "pt-btn-primary", async () => {
        hoRun(await act.createMoveIn(t.id), act.inspectionError);
      })));
    return [hoBack(), head];
  }
  const draft = i.status === "draft";
  const tenantFilling = !manager && draft && i.tenant_may_fill && !i.tenant_fill_done_at && !i.sent_for_review_at;
  if (draft && manager) {
    head.append(h("p", "pt-muted", "Fyll ut tilstanden i hvert rom. Når du ferdigstiller, låses sjekklisten og sendes til leietaker for godkjenning."));
    if (i.tenant_may_fill && i.tenant_fill_done_at) head.append(h("p", "pt-ho-status", "Leietaker har sendt sjekklisten til deg."));
    head.append(hoTenantFillToggle(i), actionsRow(
      button("Ferdigstill og send til leietaker", "pt-btn-primary", async () => {
        const ok = await act.confirmAction({ title: "Ferdigstill og send til leietaker", text: "Sjekklisten låses og sendes til leietaker. Manglende svar er ikke en godkjenning. Du kan ferdigstille uten svar.", confirmLabel: "Ferdigstill", destructive: false });
        if (ok) hoRun(await act.finalizeInspection(i, { sendMoveIn: true }), act.inspectionError, "Innflyttingen er ferdigstilt og sendt til leietaker.");
      }),
      i.sent_for_review_at ? null : button("Avbryt innflytting", "pt-btn-quiet-destructive", async () => {
        const ok = await act.confirmAction({ title: "Avbryt innflytting", text: "Sjekklisten og bildene for innflyttingen slettes. Dette kan ikke angres.", confirmLabel: "Avbryt innflytting" });
        if (ok) hoRun(await act.cancelMoveIn(t.id), act.inspectionError, "Innflyttingen er avbrutt.");
      }),
    ));
  } else if (tenantFilling) {
    head.append(h("p", "pt-muted", "Dette er innflyttingsprotokollen for boligen. Her dokumenteres målerstander, nøkler og tilstanden i boligen ved innflytting. Utleier har bedt deg fylle ut sjekklisten. Når du er ferdig, sendes den til utleier for godkjenning."),
      actionsRow(button("Ferdig", "pt-btn-primary", async () => {
        hoRun(await act.markTenantFillDone(i.id), act.inspectionError, "Sendt til utleier");
      })));
  } else if (draft) {
    head.append(h("p", "pt-muted", i.tenant_fill_done_at ? "Sendt til utleier" : "Venter på at utleier sender protokollen."));
  } else {
    head.append(h("p", "pt-ho-status", HO_MARK[i.protocol_mark] ?? "Ferdigstilt"));
    if (i.finalized_at) head.append(h("p", "pt-muted", `Ferdigstilt ${dateText(i.finalized_at)}`));
    if (!manager && i.sent_for_review_at && !i.tenant_decision) {
      head.append(h("p", "pt-muted", "Utleier har ferdigstilt og sendt innflyttingsprotokollen til deg for gjennomgang."),
        actionsRow(button("Godkjenn", "pt-btn-primary", async () => {
          hoRun(await act.approveMoveIn(i.id), act.inspectionError, "Innflytting er godkjent");
        })));
    } else if (manager && i.sent_for_review_at && !i.tenant_decision) {
      head.append(h("p", "pt-muted", "Manglende svar er ikke en godkjenning."));
    }
  }
  const editable = draft && (manager || tenantFilling);
  const canComment = draft && (manager || Boolean(i.sent_for_review_at));
  return [hoBack(), head, ...(await hoProtocolCards(i, editable, canComment))];
};

const hoNoticeForm = async (p, t, manager) => {
  const people = await tenancyPeople(p.id);
  const tenants = (people.data ?? []).filter((m) => m.tenancy_id === t.id && m.role === "tenant");
  const scopes = [[p.housing_kind === "shared" ? "one_room" : "whole_tenancy", p.housing_kind === "shared" ? "Ett rom" : "Hele leieforholdet"]];
  if (tenants.length > 1) scopes.push(["one_tenant", "Én leietaker"]);
  const fields = [
    { name: "date", label: "Utflyttingsdato", type: "date", required: true, min: todayISO() },
    { name: "scope", label: "Omfang", type: "select", options: scopes, required: true },
  ];
  if (tenants.length > 1 && manager) {
    fields.push({ name: "subject", label: "Leietaker", type: "select", options: tenants.map((m) => [m.user_id, m.name ?? "Leietaker"]), required: true });
  }
  return act.openForm({
    title: "Registrer oppsigelse", intro: "Starter utflytting. Første steg er oppsigelsen.",
    fields, submitLabel: "Registrer oppsigelse",
    onSubmit: async (v) => {
      if (!v.date) return "Velg utflyttingsdato.";
      const subject = v.scope === "one_tenant" ? (manager ? v.subject : state.user.id) : null;
      const res = await act.registerMoveOutNotice(t.id, v.scope, subject, v.date);
      const err = act.moveOutError(res);
      if (err) return err;
      hoReloadPage("Oppsigelsen er registrert");
      return null;
    },
  });
};
const hoMoveOutPage = async (p, t, d) => {
  const manager = isManager(p.id);
  const proc = d.process;
  const i = d.moveOut;
  const head = card("Utflytting", "handover");
  head.querySelector(".pt-card-head").append(hoChip(hoMoveOutStatus(d)));
  if (!proc) {
    head.append(h("p", "pt-muted", manager ? "Registrer oppsigelsen for å starte utflyttingen." : "Når leieforholdet sies opp, registreres oppsigelsen her."),
      actionsRow(button(manager ? "Start utflytting" : "Registrer oppsigelse", "pt-btn-primary", () => hoNoticeForm(p, t, manager))));
    return [hoBack(), head];
  }
  const facts = h("dl", "pt-facts");
  [["Utflyttingsdato", dateText(proc.move_out_on)], ["Omfang", HO_SCOPE[proc.scope] ?? proc.scope],
    ["Status", act.MOVE_OUT_STATE[proc.state] ?? proc.state]].forEach(([k, v]) => {
    const row = h("div");
    row.append(h("dt", null, k), h("dd", null, v));
    facts.append(row);
  });
  head.append(facts);
  const open = act.OPEN_MOVE_OUT.includes(proc.state);
  const finalized = i?.status === "finalized";
  const buttons = [];
  if (manager && proc.state === "notice_given") {
    buttons.push(button("Start utflytting", "pt-btn-primary", async () => {
      hoRun(await act.openMoveOutChecklist(proc.id), act.moveOutError);
    }));
  }
  if (manager && i && !finalized) {
    buttons.push(button("Ferdigstill utflytting", "pt-btn-primary", async () => {
      const ok = await act.confirmAction({ title: "Ferdigstill utflytting", text: "Utflyttingslisten låses. Deretter åpnes depositumsoppgjøret.", confirmLabel: "Ferdigstill", destructive: false });
      if (ok) hoRun(await act.finalizeInspection(i), act.inspectionError, "Utflyttingslisten er ferdigstilt");
    }));
  }
  if (manager && open && (proc.state === "approved" || proc.state === "deposit")) {
    const s = d.deposit?.status;
    const ready = !d.deposit || s === "accepted" || s === "full_refund";
    if (ready) {
      head.append(h("p", "pt-ho-status", "Klar til å avslutte leieforholdet"));
      buttons.push(button("Avslutt leieforholdet", "pt-btn-primary", async () => {
        const ok = await act.confirmAction({ title: "Er du sikker?", text: "Leieforholdet avsluttes. Dette kan ikke angres.", confirmLabel: "Avslutt leieforholdet" });
        if (ok) hoRun(await act.completeMoveOut(proc.id), act.moveOutError, "Leieforholdet er avsluttet.");
      }));
    } else {
      head.append(h("p", "pt-muted", "Depositumsoppgjøret må være godtatt før utflyttingen kan fullføres"));
    }
  }
  if (manager && open && !finalized && proc.state !== "approved" && proc.state !== "deposit") {
    buttons.push(button("Avbryt utflytting", "pt-btn-quiet-destructive", async () => {
      const ok = await act.confirmAction({ title: "Avbryt utflytting", text: "Oppsigelsen og utflyttingslisten avbrytes.", confirmLabel: "Avbryt utflytting" });
      if (ok) hoRun(await act.cancelMoveOut(proc.id), act.moveOutError, "Utflyttingen er avbrutt.");
    }));
  }
  if (manager && i && !finalized) head.append(hoTenantFillToggle(i));
  if (finalized) {
    head.append(h("p", "pt-ho-status", "Utflyttingslisten er ferdigstilt"));
    const link = h("a", "pt-btn pt-btn-secondary", "Depositumsoppgjør");
    link.href = "#inn-utflytting/depositum";
    buttons.push(link);
  } else if (!manager && proc.state === "notice_given") {
    head.append(h("p", "pt-muted", "Utflytting åpnes når utleier har startet den."));
  }
  if (buttons.length) head.append(actionsRow(...buttons));
  if (!i) return [hoBack(), head];
  const tenantFilling = !manager && !finalized && i.tenant_may_fill;
  return [hoBack(), head, ...(await hoProtocolCards(i, !finalized && (manager || tenantFilling), manager && !finalized))];
};

const hoClaimForm = (snap, claim) => act.openForm({
  title: claim ? "Endre krav" : "Legg til krav",
  fields: [
    { name: "description", label: "Skade eller mangel", type: "textarea", rows: 3, maxLength: 500, required: true, value: claim?.description ?? "" },
    { name: "amount", label: "Beløp du krever fra depositumet (kr)", type: "money", required: true, value: claim ? act.kronerOf(claim.amount_minor) : "" },
  ],
  onSubmit: async (v) => {
    const description = v.description.trim();
    const minor = act.minorOf(v.amount);
    if (!description) return "Beskriv skaden eller mangelen.";
    if (!minor || minor <= 0) return "Skriv et gyldig beløp.";
    const res = claim ? await act.updateDepositClaim(claim.id, description, minor) : await act.addDepositClaim(snap.id, description, minor);
    const err = act.depositError(res);
    if (err) return err;
    hoReloadPage();
    return null;
  },
});
const hoDepositPage = async (p, t, d) => {
  const manager = isManager(p.id);
  const head = card("Depositumsoppgjør", "banknote");
  head.querySelector(".pt-card-head").append(hoChip(hoDepositStatus(d)));
  const canOpen = d.deposit || (manager && d.moveOut?.status === "finalized");
  if (!canOpen) {
    head.append(h("p", "pt-muted", "Depositumsoppgjøret åpnes når utflyttingen er fullført."));
    return [hoBack(), head];
  }
  const res = await act.openDepositSettlement(t.id, d.deposit?.id, d.moveOut?.id);
  const snap = res.data;
  if (res.error || !snap?.id) {
    head.append(inline(act.depositError(res) ?? "Depositumsoppgjøret kunne ikke hentes akkurat nå."));
    return [hoBack(), head];
  }
  const known = ["open", "claims_pending", "accepted", "declined", "full_refund", "disputed"];
  const status = known.includes(snap.status) ? snap.status : "disputed";
  const claims = (snap.claims ?? []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const total = claims.reduce((a, c) => a + Number(c.amount_minor || 0), 0);
  const deposit = Number(snap.deposit_amount_minor || 0);
  const amounts = h("dl", "pt-facts");
  [["Opprinnelig depositum", money(deposit)], ["Totalt krav", money(total)], ["Tilbakebetales", money(Math.max(0, deposit - total))]].forEach(([k, v]) => {
    const row = h("div");
    row.append(h("dt", null, k), h("dd", null, v));
    amounts.append(row);
  });
  head.append(amounts);
  const canEdit = manager && (status === "open" || status === "declined");
  const statusText = {
    claims_pending: manager ? "Venter på leietaker" : "Utleier har sendt krav mot depositumet. Godta eller bestrid oppgjøret.",
    accepted: "Godkjent av begge parter.",
    full_refund: "Utflyttingen er godkjent uten krav.",
    declined: "Leietaker avslo kravene. Endre og send på nytt.",
    disputed: "Uenighet. Utleier kan ikke trekke depositumet automatisk.",
  }[status];
  if (statusText) head.append(h("p", "pt-ho-status", statusText));
  if (status === "disputed" && snap.dispute_reason) head.append(h("p", "pt-ho-note", `Begrunnelse: ${snap.dispute_reason}`));
  if ((status === "accepted" || status === "full_refund") && !manager) {
    head.append(h("p", "pt-muted", "PDF-en av oppgjøret lagres når du åpner depositumsoppgjøret i appen."));
  }
  const buttons = [];
  if (canEdit) {
    if (total > deposit && snap.security_type !== "guarantee") head.append(h("p", "pt-ho-error", "Kravene kan ikke være større enn depositumet."));
    buttons.push(button(claims.length ? "Send krav til leietaker" : "Godkjenn og send til leietaker", "pt-btn-primary", async () => {
      if (!claims.length) {
        const ok = await act.confirmAction({ title: "Godkjenn og send til leietaker", text: "Hele depositumet tilbakebetales uten krav.", confirmLabel: "Godkjenn", destructive: false });
        if (ok) hoRun(await act.approveDepositFullRefund(snap.id), act.depositError, "Utflyttingen er godkjent uten krav.");
        return;
      }
      const ok = await act.confirmAction({ title: "Send krav til leietaker", text: "Leietaker kan godta eller bestride kravene.", confirmLabel: "Send", destructive: false });
      if (ok) hoRun(await act.submitDepositClaims(snap.id), act.depositError, "Kravene er sendt til leietaker.");
    }));
    if (claims.length < act.DEPOSIT_CLAIM_LIMIT) buttons.push(button("Legg til krav", "pt-btn-secondary", () => hoClaimForm(snap)));
  }
  if (manager && status === "disputed") {
    buttons.push(button("Endre og send på nytt", "pt-btn-primary", async () => {
      hoRun(await act.reviseDisputedDeposit(snap.id), act.depositError);
    }));
  }
  if (!manager && status === "claims_pending") {
    buttons.push(
      button("Godta oppgjør", "pt-btn-primary", async () => {
        const ok = await act.confirmAction({ title: "Godta oppgjør", text: `Du godtar krav på ${money(total)}. ${money(Math.max(0, deposit - total))} tilbakebetales.`, confirmLabel: "Godta oppgjør", destructive: false });
        if (ok) hoRun(await act.respondDeposit(snap.id, true), act.depositError, "Depositumsoppgjøret er fullført");
      }),
      button("Bestrid oppgjør", "pt-btn-quiet-destructive", () => act.openForm({
        title: "Bestrid oppgjør",
        fields: [{ name: "reason", label: "Begrunnelse", type: "textarea", rows: 4, maxLength: 1000, required: true, placeholder: "Skriv hvorfor du bestrider oppgjøret" }],
        submitLabel: "Bestrid oppgjør",
        onSubmit: async (v) => {
          const reason = v.reason.trim();
          if (!reason) return "Skriv en begrunnelse for å bestride.";
          const r = await act.disputeDeposit(snap.id, reason);
          const err = act.depositError(r);
          if (err) return err;
          hoReloadPage("Oppgjøret er bestridt.");
          return null;
        },
      })),
    );
  }
  if (buttons.length) head.append(actionsRow(...buttons));
  const list = card("Krav mot depositum", "doc");
  if (!claims.length) list.append(inline("Ingen krav."));
  const ul = h("ul", "pt-ho-items");
  for (const c of claims) {
    const li = h("li", "pt-ho-item");
    const row = h("div", "pt-ho-item-head");
    row.append(h("strong", null, money(c.amount_minor)));
    li.append(row, h("p", "pt-ho-note", c.description));
    if (canEdit) {
      li.append(actionsRow(
        button("Endre", "pt-btn-secondary pt-btn-small", () => hoClaimForm(snap, c)),
        button("Fjern", "pt-btn-quiet-destructive pt-btn-small", async () => {
          const ok = await act.confirmAction({ title: "Fjern krav", text: c.description, confirmLabel: "Fjern" });
          if (ok) hoRun(await act.removeDepositClaim(c.id), act.depositError);
        }),
      ));
    }
    ul.append(li);
  }
  if (claims.length) list.append(ul);
  list.append(h("p", "pt-muted", "Bilder og kvitteringer til kravene legges til i appen."));
  return [hoBack(), head, list];
};

const hoOverview = async (p, t, d) => {
  const manager = isManager(p.id);
  const out = [];
  const tenancies = hoTenancies(p.id);
  if (tenancies.length > 1) {
    const people = await tenancyPeople(p.id);
    const sel = h("select", "pt-select pt-ho-tenancy");
    sel.setAttribute("aria-label", "Leieforhold");
    tenancies.forEach((x, n) => {
      const names = (people.data ?? []).filter((m) => m.tenancy_id === x.id && m.role === "tenant").map((m) => m.name).filter(Boolean);
      const o = h("option", null, names.length ? names.join(", ") : `Leieforhold ${n + 1}`);
      o.value = x.id;
      sel.append(o);
    });
    sel.value = t.id;
    sel.addEventListener("change", () => {
      hoTenancyId = sel.value;
      render();
    });
    out.push(sel);
  }
  const info = card("Dokumenter boligens tilstand", "info");
  info.append(h("p", "pt-muted", "Sjekklister ved inn- og utflytting gir en trygg oversikt og kan brukes som dokumentasjon ved depositumsoppgjør."));
  const tiles = h("section", "pt-tiles");
  [["innflytting", "Innflytting", "checklist", "is-success", "Sjekkliste og dokumentasjon", hoMoveInStatus(d.moveIn, manager)],
    ["utflytting", "Utflytting", "handover", "is-warning", "Sjekkliste og sammenligning med innflytting", hoMoveOutStatus(d)],
    ["depositum", "Depositumsoppgjør", "key", "", "Oppsummering og eventuelle trekk", hoDepositStatus(d)]].forEach(([sub, l, ic, tone, txt, st]) => {
    const a = h("a", "pt-tile pt-ho-tile");
    a.href = `#inn-utflytting/${sub}`;
    a.append(icon(ic, `pt-icon-circle ${tone}`.trim()), h("strong", null, l), h("p", null, txt), hoChip(st));
    tiles.append(a);
  });
  out.push(info, tiles);
  if (manager) out.push(h("p", "pt-muted", "Innflytting og utflytting er valgfritt. Du kan hoppe over det. Leietaker ser sjekklistene først når du har startet."));
  return out;
};

/* ---------- Dokumenter og maler ---------- */
// DocumentsView / LandlordDocumentTemplatesView in the app.
const fileSizeText = (bytes) => {
  const n = Number(bytes);
  if (!n) return "";
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1000))} kB`;
};
const tenancyPeriodText = (t) => (t.end_date ? `${dateText(t.start_date)} – ${dateText(t.end_date)}` : `fra ${dateText(t.start_date)}`);
const docActiveTenancies = (pid) => state.tenancies.filter((t) => t.property_id === pid && t.status === "active");
const openDocButton = (d) => pdfButton("Åpne", "pt-btn-secondary pt-btn-small", () => act.openListedDocument(d));

// One tenancy: confirm and grant. Several: a list where each switch grants or revokes at once.
async function shareDocument(d, pid, access) {
  const tenancies = docActiveTenancies(pid);
  if (!tenancies.length) return act.toast("Det finnes ikke et aktivt leieforhold å dele med.");
  const shared = new Set(access.filter((a) => a.document_id === d.id).map((a) => a.tenancy_id));
  if (tenancies.length === 1) {
    const t = tenancies[0];
    if (shared.has(t.id)) return act.toast("Dokumentet er allerede delt med leietaker.");
    const ok = await act.confirmAction({ title: "Del med leietaker", text: `Dokumentet deles med det aktive leieforholdet fra ${tenancyPeriodText(t).toLowerCase()}.`, confirmLabel: "Del", destructive: false });
    if (!ok) return;
    const err = await act.setDocumentAccess(d.id, t.id, pid, state.user.id, true);
    if (err) return act.toast(err);
    return refresh("Dokumentet er delt med leietaker.");
  }
  const people = (await tenancyPeople(pid)).data ?? [];
  const ul = h("ul", "pt-list");
  for (const t of tenancies) {
    const names = people.filter((m) => m.tenancy_id === t.id && m.role === "tenant").map((m) => m.name).filter(Boolean);
    const li = h("li", "pt-row");
    const label = h("label", "pt-ho-toggle");
    const box = h("input");
    box.type = "checkbox";
    box.checked = shared.has(t.id);
    box.addEventListener("change", async () => {
      box.disabled = true;
      const err = await act.setDocumentAccess(d.id, t.id, pid, state.user.id, box.checked);
      box.disabled = false;
      if (err) {
        box.checked = !box.checked;
        act.toast(err);
      }
    });
    label.append(box, h("span", null, `${names.join(", ") || "Leietaker"} · ${tenancyPeriodText(t)}`));
    li.append(label);
    ul.append(li);
  }
  await act.openForm({ title: "Del med leietaker", intro: d.title, fields: [], sections: [ul], submitLabel: "Ferdig", onSubmit: () => null });
  refresh();
}

const documentRow = (d, pid, access, manager) => {
  const li = h("li", "pt-row");
  const main = h("div", "pt-row-main");
  const meta = [dateText(d.created_at), fileSizeText(d.file_size_bytes)];
  if (manager) {
    const n = access.filter((a) => a.document_id === d.id).length;
    meta.push(n ? (n === 1 ? "Delt med leietaker" : `Delt med ${n} leieforhold`) : "Ikke delt");
  }
  main.append(h("strong", null, d.title || d.original_file_name || "Dokument"), h("span", null, meta.filter(Boolean).join(" · ")));
  li.append(icon("doc"), main);
  if (d.status !== "ready") {
    li.append(h("span", "pt-chip", "Klargjøres"));
    return li;
  }
  const buttons = h("div", "pt-row-actions");
  buttons.append(openDocButton(d));
  if (manager) {
    buttons.append(
      button("Del", "pt-btn-secondary pt-btn-small", () => shareDocument(d, pid, access)),
      button("Slett", "pt-btn-quiet-destructive pt-btn-small", async () => {
        const ok = await act.confirmAction({ title: "Slett dokument?", text: "Dokumentet slettes for alle som har tilgang til det.", confirmLabel: "Slett" });
        if (!ok) return;
        const err = await act.deleteDocument(d.id);
        if (err) return act.toast(err);
        refresh("Dokumentet er slettet.");
      }),
    );
  }
  li.append(buttons);
  return li;
};

const uploadDocument = (pid) => act.openForm({
  title: "Last opp PDF",
  intro: "Velg en PDF på maksimalt 10 MB.",
  fields: [{ name: "file", label: "PDF", type: "file", accept: "application/pdf,.pdf", required: true }],
  submitLabel: "Last opp",
  onSubmit: async (v) => {
    const res = await act.uploadDocumentPdf(pid, v.file);
    if (res.message) return res.message;
    refresh("Dokumentet er lastet opp.");
    return null;
  },
});

// Everything a template can fill in by itself: tenants, landlord contact, lease terms.
async function templateContext(pid) {
  const tenancies = docActiveTenancies(pid);
  const peopleRes = await tenancyPeople(pid);
  if (peopleRes.error) return { error: true };
  const people = (peopleRes.data ?? []).filter((m) => m.role === "tenant" && tenancies.some((t) => t.id === m.tenancy_id));
  const [contactsRes, agreementsRes, meRes] = await Promise.all([
    people.length ? act.linkedContacts([...new Set(people.map((m) => m.user_id))]) : Promise.resolve({ data: [] }),
    act.listAgreements(pid),
    supabase.from("profiles").select("display_name, phone_number").eq("id", state.user.id).maybeSingle(),
  ]);
  if (contactsRes.error) return { error: true };
  const contacts = new Map((contactsRes.data ?? []).map((c) => [c.user_id, c]));
  const me = { ...(meRes.data ?? {}), email: state.user.email };
  const terms = new Map();
  for (const a of (agreementsRes.data ?? []).filter((x) => x.agreement_status === "signed" && tenancies.some((t) => t.id === x.tenancy_id))) {
    if (terms.has(a.tenancy_id)) continue;
    const detail = await act.getAgreement(a.agreement_id);
    if (detail.data) terms.set(a.tenancy_id, detail.data.version?.snapshot?.terms ?? {});
  }
  return {
    tenancies, people, contacts, terms,
    landlord: { name: me.display_name ?? state.name ?? "", phone: me.phone_number ?? "", email: me.email ?? state.user.email ?? "" },
  };
}

async function openTemplate(tpl, pid) {
  const ctx = await templateContext(pid);
  if (ctx.error) return act.toast("Kunne ikke hente leietakerne. Prøv igjen før du sender dokumentet.");
  if (!ctx.people.length) return act.toast("Boligen er fylt inn. En leietaker i et aktivt leieforhold må være på plass før malen kan sendes.");
  const p = property();
  const a = addressOf(p);
  const propertyAddress = [p.unit_identifier ? `${a.line} (${p.unit_identifier})` : a.line, a.place].filter(Boolean).join(", ");
  const today = todayISO();
  const tenants = ctx.people.map((m) => [`${m.tenancy_id}|${m.user_id}`, ctx.contacts.get(m.user_id)?.display_name || m.name || "Leietaker"]);
  const fields = tplt.templateFields(tpl.id, { tenants, landlordName: ctx.landlord.name, landlordPhone: ctx.landlord.phone, landlordEmail: ctx.landlord.email, today });
  const pad = tplt.SIGNED.has(tpl.id) ? act.inkPad() : null;
  let picked = "";
  let keys = null;
  let draftKey = "";
  const valuesOf = (inputs) => {
    const v = {};
    for (const [k, el] of Object.entries(inputs)) v[k] = el.value.trim();
    const [, userId] = (v.tenant || "|").split("|");
    v.tenantName = ctx.contacts.get(userId)?.display_name || ctx.people.find((m) => m.user_id === userId)?.name || "";
    if (!v.propertyAddress && tpl.id !== "reference" && tpl.id !== "writtenWarning") v.propertyAddress = propertyAddress;
    return v;
  };
  const buildPdf = async (v) => tplt.templateBlocks(tpl.id, v, pad?.strokes() ?? []);
  const confirmedEmails = () => ctx.people.map((m) => (ctx.contacts.get(m.user_id)?.email ?? "").toLowerCase()).filter(Boolean);
  const preview = h("div", "pt-modal-actions");
  let currentInputs = null;
  preview.append(pdfButton("Forhåndsvis", "pt-btn-secondary", async () => {
    const v = valuesOf(currentInputs);
    const bad = letter.unsupportedCharacters(Object.values(v).join(" "));
    if (bad.length) return { message: `PDF-en kan ikke tegne noen av disse tegnene. Fjern dem før du sender. (${bad.join(" ")})` };
    const bytes = letter.letterPdf(await buildPdf(v), { logo: await act.letterLogoJpeg(), title: tplt.letterTitle(tpl.id) });
    return { url: URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })) };
  }));
  await act.openForm({
    title: tpl.title,
    intro: tpl.intro ?? tpl.subtitle,
    fields,
    after: [pad?.node, preview, h("p", "pt-field-help", tplt.DISCLAIMER)].filter(Boolean),
    submitLabel: "Send til leietaker",
    onChange: (inputs) => {
      currentInputs = inputs;
      if (inputs.tenant.value === picked) return;
      picked = inputs.tenant.value;
      const [tenancyId, userId] = picked.split("|");
      const t = ctx.tenancies.find((x) => x.id === tenancyId);
      const c = ctx.contacts.get(userId) ?? {};
      const terms = ctx.terms.get(tenancyId) ?? {};
      const set = (name, value) => { if (inputs[name] && value != null) inputs[name].value = value; };
      if (!t) return;
      set("tenantAddress", propertyAddress);
      set("tenantEmail", c.email ?? "");
      set("tenantPhone", c.phone_number ?? "");
      set("propertyAddress", propertyAddress);
      set("leasePeriod", tplt.leasePeriodText(terms.start_date ?? t.start_date, terms.end_date ?? t.end_date));
      set("accountNumber", terms.payment_account ?? p.payment_account_override ?? "");
      set("amount", terms.rent_amount_minor ? act.kronerOf(terms.rent_amount_minor) : "");
      set("dueDate", tplt.nextDueDate(terms.payment_day));
      if (inputs.endDate) set("endDate", tplt.suggestedEndDate(inputs.noticeDate.value || today, terms.notice_period_months ?? 3));
    },
    onSubmit: async (values) => {
      const v = valuesOf(currentInputs);
      const strokes = pad?.strokes() ?? [];
      const issue = tplt.templateIssue(tpl.id, v, strokes, confirmedEmails());
      if (issue) return issue;
      const [tenancyId] = v.tenant.split("|");
      // The same letter keeps its keys, so a retry never makes a second document or chat card.
      const key = JSON.stringify([v, strokes]);
      if (!keys || key !== draftKey) {
        keys = { reservationKey: crypto.randomUUID(), chatRequestId: crypto.randomUUID() };
        draftKey = key;
      }
      const bytes = letter.letterPdf(await buildPdf(v), { logo: await act.letterLogoJpeg(), title: tplt.letterTitle(tpl.id) });
      const res = await act.sendTemplateLetter({ propertyId: pid, tenancyId, grantedBy: state.user.id, title: tplt.letterTitle(tpl.id), fileName: tpl.fileName, bytes, keys });
      if (!res.ok) return res.text;
      refresh(res.text);
      return null;
    },
  });
}

const templatesCard = (pid) => {
  const c = card("Ferdige dokumentmaler", "doc");
  c.append(h("p", "pt-muted", "Velg en dokumentmal, fyll inn nødvendig informasjon og send det ferdige dokumentet direkte til leietakeren."));
  const tiles = h("div", "pt-tiles");
  for (const tpl of tplt.TEMPLATES) {
    const tile = h("button", "pt-tile pt-doc-tile");
    tile.type = "button";
    tile.append(icon(tpl.icon), h("strong", null, tpl.title), h("span", null, tpl.subtitle));
    tile.addEventListener("click", () => openTemplate(tpl, pid));
    tiles.append(tile);
  }
  const deposit = h("a", "pt-tile pt-doc-tile");
  deposit.href = "#inn-utflytting";
  deposit.append(icon("banknote"), h("strong", null, "Depositumsoppgjør"), h("span", null, "Lages ved utflytting under Inn- og utflytting"));
  tiles.append(deposit);
  c.append(tiles);
  return c;
};

async function documentsPage() {
  const p = property();
  if (!p) return [emptyPage("folder", "Dokumenter", "Velg en bolig for å se dokumentene.")];
  const manager = isManager(p.id);
  const [docs, access] = await Promise.all([act.listPropertyDocuments(p.id), manager ? act.listDocumentAccess(p.id) : Promise.resolve({ data: [] })]);
  const out = [];
  if (manager) out.push(templatesCard(p.id));
  const c = card(manager ? "Dokumenter" : "Delte dokumenter", "folder");
  if (manager) c.append(actionsRow(button("Last opp PDF", "pt-btn-primary pt-btn-small", () => uploadDocument(p.id))));
  if (docs.error || access.error) {
    c.append(inline("Kunne ikke hente dokumentene. Prøv igjen."));
    return [...out, c];
  }
  const rows = (docs.data ?? []).filter((d) => d.status !== "deleted" && d.status !== "deleting" && (manager || d.status === "ready"));
  if (!rows.length) {
    c.append(inline(manager ? "Ingen dokumenter ennå. Last opp en PDF og velg hvilke aktive leieforhold som skal få tilgang." : "Ingen delte dokumenter ennå. Dokumenter vises her når utleieren deler dem med ditt aktive leieforhold."));
  } else {
    const ul = h("ul", "pt-list");
    for (const d of rows) ul.append(documentRow(d, p.id, access.data ?? [], manager));
    c.append(ul);
  }
  out.push(c);
  return out;
}

/* ---------- Kjørebok (MileageView) ---------- */
const MILEAGE_INFO = `Kjøring til utleieboligen 🚗

Kjører du din egen bil i forbindelse med utleien, kan du ha rett på fradrag for kjøringen.

Det kan for eksempel være når du kjører til boligen for:

• visning
• vedlikehold eller reparasjoner
• tilsyn av boligen
• andre nødvendige oppgaver knyttet til utleien

Satsen er 3,50 kr per km i 2026.

Denne satsen er den samme enten du kjører vanlig bensin-/dieselbil eller elbil.

Når du legger inn en tur i Enkel Utleie, beregner vi automatisk estimert fradrag ut fra antall kilometer.

Eksempel:
20 km × 3,50 kr = 70 kr estimert fradrag

For å ha god dokumentasjon registrerer du dato, hvor du kjørte fra og til, hvorfor du kjørte og antall kilometer.

Greit å vite
Reglene kan være annerledes dersom utleien din regnes som næringsvirksomhet. Beregningene i Enkel Utleie er derfor veiledende, og det er Skatteetatens regler som avgjør hva du faktisk har krav på.`;
const mileageState = { year: null, infoOpen: false };

const economyTiles = () => {
  const tiles = h("section", "pt-tiles");
  const tile = h("a", "pt-tile pt-tile-link");
  tile.href = "#okonomi/kjorebok";
  tile.append(icon("car", "pt-icon-circle is-tax"), h("strong", null, "Kjørebok"), h("p", null, "Logg turer. Beløpet blir en utgift i regnskapet."));
  const furniture = h("a", "pt-tile pt-tile-link");
  furniture.href = "#okonomi/mobler";
  furniture.append(icon("sofa", "pt-icon-circle is-tax"), h("strong", null, "Møbler og inventar"), h("p", null, "Se den felles potten og registrer møbler."));
  const report = h("a", "pt-tile pt-tile-link");
  report.href = "#okonomi/arsoppgave";
  report.append(icon("doc", "pt-icon-circle is-tax"), h("strong", null, "Årsoppgave"), h("p", null, "Dokumentasjon av leieinntekter og utgifter"));
  tiles.append(tile, furniture, report);
  return tiles;
};

// AnnualReportView: the documentation package for one property and year, as a page and a PDF.
const annualState = { year: null, scope: "whole" };
const loadAnnual = async (pid, year) => {
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  const [txs, links, trips, roster, inventory, me, people] = await Promise.all([
    annual.listTransactions(pid, start, end),
    annual.listLinks(pid, start, end),
    act.listMileageTrips(pid, start, end),
    annual.ownershipShares(pid, year),
    cached("inventory", loadInventory),
    supabase.from("profiles").select("display_name").eq("id", state.user.id).maybeSingle(),
    tenancyPeople(pid),
  ]);
  if (txs.error || links.error) return { error: true };
  const ids = [...new Set((links.data ?? []).map((l) => l.document_id))];
  const docs = ids.length ? await annual.linkedDocuments(ids) : { data: [] };
  const yearTenancies = state.tenancies.filter((t) => t.property_id === pid && !["draft", "cancelled"].includes(t.status)
    && (!t.start_date || t.start_date < end) && (!t.end_date || t.end_date >= start));
  const tenantNames = [...new Set((people.data ?? [])
    .filter((m) => m.role === "tenant" && yearTenancies.some((t) => t.id === m.tenancy_id)).map((m) => m.name).filter(Boolean))];
  const rosterRows = roster.error ? [] : roster.data ?? [];
  const driverNames = Object.fromEntries(rosterRows.filter((r) => r.user_id).map((r) => [r.user_id, r.display_name ?? ""]));
  return {
    transactions: txs.data, links: links.data, documents: docs.data ?? [], trips: trips.error ? [] : trips.data,
    roster: rosterRows, driverNames, tenantNames,
    items: inventory.error ? [] : inventory.items.filter((i) => i.propertyId === pid),
    elections: inventory.error ? {} : inventory.elections,
    landlordName: me.data?.display_name ?? state.name ?? "",
    supplementsFailed: Boolean(trips.error || roster.error || inventory.error || docs.error),
  };
};

const reportTable = (columns, rows, sum) => {
  const wrap = h("div", "pt-table-wrap");
  const table = h("table", "pt-table pt-report-table");
  const head = h("tr");
  for (const c of columns) head.append(h("th", c.align === "right" ? "is-num" : null, c.label));
  const thead = h("thead");
  thead.append(head);
  const tbody = h("tbody");
  if (!rows.length) {
    const tr = h("tr");
    const td = h("td", "pt-muted", "Ingen poster");
    td.colSpan = columns.length;
    tr.append(td);
    tbody.append(tr);
  }
  for (const r of rows) {
    const tr = h("tr");
    r.forEach((v, i) => {
      const td = h("td", columns[i].align === "right" ? "is-num" : null);
      td.append(v instanceof Node ? v : document.createTextNode(v ?? ""));
      tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(thead, tbody);
  if (sum) {
    const tr = h("tr", "pt-report-sum");
    const label = h("td", null, sum[0]);
    label.colSpan = columns.length - 1;
    tr.append(label, h("td", "is-num", sum[1]));
    const tfoot = h("tfoot");
    tfoot.append(tr);
    table.append(tfoot);
  }
  wrap.append(table);
  return wrap;
};

const annualPage = async (pid) => {
  const p = property();
  const thisYear = new Date().getFullYear();
  const year = annualState.year ?? annual.defaultYear();
  const back = h("a", "pt-back", "‹ Økonomi");
  back.href = "#okonomi";
  const head = card("Årsoppgave", "doc");
  head.append(
    h("p", "pt-muted", "Dokumentasjon av leieinntekter og utgifter"),
    h("p", "pt-muted", "Årsoppgaven er en dokumentasjonspakke med leieinntekter, utgifter, kjørebok og kvitteringer."),
  );
  const controls = h("div", "pt-report-controls");
  const yearLabel = h("label", "pt-field pt-filter");
  const select = h("select", "pt-select");
  for (let y = thisYear; y >= Math.min(year, thisYear - 5); y--) {
    const o = h("option", null, String(y));
    o.value = String(y);
    o.selected = y === year;
    select.append(o);
  }
  select.addEventListener("change", () => { annualState.year = Number(select.value); render(); });
  yearLabel.append(h("span", "pt-field-label", "År"), select);
  controls.append(yearLabel);
  head.append(controls);
  const data = await cached(`annual:${pid}:${year}`, () => loadAnnual(pid, year));
  if (data.error) {
    head.append(inline("Kunne ikke lage årsoppgaven."));
    return [back, head];
  }
  const build = () => annual.buildReport({
    ...data, year, viewerId: state.user.id, scope: annualState.scope, categoryTitle: act.categoryTitle,
    propertyTitle: [addressOf(p).line, p.unit_identifier].filter(Boolean).join(" "), generatedAt: new Date(),
  });
  const report = build();
  if (!report.isSoleOwner) {
    const seg = h("div", "pt-segmented");
    for (const [value, label] of [["whole", "Hele boligen"], ["mine", "Min andel"]]) {
      seg.append(button(label, `pt-segment${annualState.scope === value ? " is-selected" : ""}`, () => { annualState.scope = value; render(); }));
    }
    controls.append(seg);
  }
  const download = button("Last ned", "pt-btn-primary pt-btn-small", async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const r = build();
      const bytes = letter.letterPdf(annual.reportBlocks(r), { logo: await act.letterLogoJpeg(), title: `Årsoppgave ${year}` });
      const a = h("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      a.download = annual.fileName(year, addressOf(p).line);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    } catch {
      act.toast("Kunne ikke lage årsoppgaven.");
    } finally {
      b.disabled = false;
    }
  });
  const out = [back, head];
  if (report.supplementsFailed) out.push(h("p", "pt-banner is-warning", annual.SUPPLEMENTS));
  if (annual.isEmpty(report)) {
    out.push(emptyPage("doc", `Ingen poster i ${year}`, "Det ligger ingen inntekter, utgifter eller kjøreturer i dette året."));
    return out;
  }
  head.append(actionsRow(download));
  const info = h("section", "pt-card");
  const dl = h("dl", "pt-facts");
  for (const [k, v] of [["Utleier", report.landlordName], ["Periode", report.periodText], ["Bolig", report.propertyTitle], ["Leietaker", report.tenantText], ["Generert", report.generatedText]]) {
    const d = h("div");
    d.append(h("dt", null, k), h("dd", null, v));
    dl.append(d);
  }
  info.append(dl);
  out.push(info);
  const kr2 = annual.kronerText;
  const R = "right";
  const income = card("1  Inntekter", "income");
  income.append(reportTable([{ label: "Dato" }, { label: "Kategori" }, { label: "Beskrivelse" }, { label: "Beløp", align: R }],
    report.incomes.map((e) => [e.dateText, e.category, e.description, kr2(e.amountMinor)]), [`Sum inntekter ${year}`, kr2(report.summary.incomeMinor)]));
  const expense = card("2  Utgifter", "expense");
  expense.append(reportTable([{ label: "Dato" }, { label: "Kategori" }, { label: "Beskrivelse" }, { label: "Kvittering" }, { label: "Beløp", align: R }],
    report.expenses.map((e) => [e.dateText, e.category, e.description, e.receiptRef ?? "–", kr2(e.amountMinor)]), ["Sum utgifter", kr2(report.summary.expenseMinor)]));
  out.push(income, expense);
  let n = 3;
  if (report.furniture.length) {
    const f = card(`${n++}  Møbler og inventar`, "sofa");
    const dashOr = (v) => (v == null ? "—" : kr2(v));
    f.append(h("p", "pt-muted", annual.FURNITURE_NOTE), reportTable(
      [{ label: "Type møbel" }, { label: "Kjøp/1.1.", align: R }, { label: "Behandling" }, { label: "I år", align: R }, { label: "31.12.", align: R }],
      report.furniture.map((l) => [annual.furnitureName(l, year), kr2(l.purchaseAmountMinor > 0 ? l.purchaseAmountMinor : l.openingMinor ?? l.historicalPurchaseMinor), l.treatment, dashOr(l.depreciationMinor), dashOr(l.closingMinor)])));
    out.push(f);
  }
  const trips = card(`${n++}  Kjørebok`, "car");
  trips.append(reportTable([{ label: "Dato" }, { label: "Fra → til" }, { label: "Formål" }, { label: "Km", align: R }],
    report.trips.map((t) => [t.dateText, t.route, t.purpose, annual.kmText(t.meters)]), ["Sum kjøring", annual.kmText(report.summary.drivingMeters)]));
  const sum = card(`${n++}  Oppsummering`, "net");
  if (report.scopeTitle) sum.append(h("p", "pt-muted", report.scopeTitle));
  sum.append(reportTable([{ label: "" }, { label: "", align: R }],
    [["Sum inntekter", kr2(report.summary.incomeMinor)], ["Sum utgifter", kr2(report.summary.expenseMinor)]],
    ["Differanse inntekter minus utgifter", kr2(report.summary.differenceMinor)]));
  const att = card(`${n++}  Vedlegg`, "folder");
  att.append(reportTable([{ label: "Ref" }, { label: "Dato" }, { label: "Beskrivelse" }, { label: "Beløp", align: R }, { label: "" }],
    report.receipts.map((x) => [x.ref, x.dateText, x.description, kr2(x.amountMinor), x.unavailable ? h("span", "pt-muted", "Kunne ikke hentes") : openDocButton(x.document)])));
  out.push(trips, sum, att);
  return out;
};

// MileageComposerView: manual kilometers (the app can also measure the route on the map).
const mileageForm = (pid, trip) => {
  const requestId = crypto.randomUUID();
  const preview = h("p", "pt-muted");
  const rateFor = (date) => act.MILEAGE_RATES[Number(String(date || "").slice(0, 4))];
  const fields = [
    { name: "date", label: "Dato", type: "date", value: trip?.trip_date ?? todayISO(), required: true },
    { name: "from", label: "Fra-adresse", value: trip?.from_place ?? "", placeholder: "F.eks. hjemmeadresse", required: true, requiredMessage: "Skriv inn fra-adresse." },
    { name: "to", label: "Til-adresse", value: trip?.to_place ?? "", placeholder: "F.eks. Karlsrudveien 12, Oslo", required: true, requiredMessage: "Skriv inn til-adresse." },
    { name: "purpose", label: "Formål", type: "textarea", value: trip?.purpose ?? "", maxLength: 200, placeholder: "F.eks. visning av leilighet, kjøp av materialer", required: true, requiredMessage: "Skriv inn formål." },
    { name: "km", label: "Kilometer", value: trip ? act.kilometerText(trip.distance_meters) : "", placeholder: "F.eks. 25,5", required: true, requiredMessage: "Skriv inn kilometer." },
  ];
  act.openForm({
    title: trip ? "Rediger kjøretur" : "Ny kjøretur",
    intro: trip ? "Lagret som utgift i regnskapet" : undefined,
    fields,
    after: [preview],
    submitLabel: "Lagre tur",
    onChange: (inputs) => {
      const rate = rateFor(inputs.date?.value);
      const meters = act.mileageMeters(inputs.km?.value);
      const amount = rate && meters ? act.mileageAmountMinor(meters, rate.orePerKm) : null;
      preview.textContent = amount == null ? "" : `Beløp: ${money(amount)} (${act.orePerKmText(rate.orePerKm)} kr/km)`;
    },
    onSubmit: async (v) => {
      const meters = act.mileageMeters(v.km);
      if (!meters) return "Skriv inn kilometer mellom 0,1 og 2000.";
      if (!rateFor(v.date)) return "Ingen offisiell kilometresats for dette året.";
      const values = { date: v.date, meters, purpose: v.purpose, from: v.from, to: v.to };
      const res = trip ? await act.correctMileageTrip(trip.id, values, requestId) : await act.createMileageTrip(pid, values, requestId);
      if (res.error) return trip ? "Kunne ikke oppdatere turen." : "Kunne ikke lagre turen.";
      mileageState.year = Number(v.date.slice(0, 4));
      refresh(trip ? "Turen er oppdatert." : "Turen er lagret.");
      return null;
    },
  });
};

const mileagePage = async (pid) => {
  const thisYear = new Date().getFullYear();
  const year = mileageState.year ?? thisYear;
  const back = h("a", "pt-back", "‹ Økonomi");
  back.href = "#okonomi";
  const [res, zone] = await Promise.all([
    cached(`mileage:${pid}:${year}`, () => act.listMileageTrips(pid, `${year}-01-01`, `${year + 1}-01-01`)),
    cached("tiltakssone", () => act.taxResidenceInTiltakssone(state.user.id)),
  ]);
  const tiltakssone = zone === true;
  const head = card("Kjøregodtgjørelse", "car");
  head.append(h("p", "pt-muted", "Registrer kjøring i forbindelse med utleie, og få oversikt over fradragene dine."));
  const rate = act.MILEAGE_RATES[year];
  const info = h("div", "pt-mileage-info");
  info.hidden = !mileageState.infoOpen;
  info.append(
    h("p", "pt-ho-status", rate ? `Sats ${year}: ${act.orePerKmText(rate.orePerKm)} kr/km · ${rate.authority}` : "Ingen offisiell kilometresats for dette året."),
    h("p", "pt-prewrap", MILEAGE_INFO),
  );
  if (act.STATE_CAR_ALLOWANCE[year]) info.append(h("p", "pt-muted", `Statens kjøregodtgjørelse er ${act.orePerKmText(act.STATE_CAR_ALLOWANCE[year])} kr/km i ${year}. Den brukes ikke her.`));
  const toggle = button(mileageState.infoOpen ? "Skjul" : "Les mer", "pt-btn-soft pt-btn-small", () => {
    mileageState.infoOpen = !mileageState.infoOpen;
    info.hidden = !mileageState.infoOpen;
    toggle.textContent = mileageState.infoOpen ? "Skjul" : "Les mer";
  });
  const yearLabel = h("label", "pt-field pt-filter");
  const select = h("select", "pt-select");
  for (let y = thisYear; y >= Math.min(year, thisYear - 2); y--) {
    const o = h("option", null, String(y));
    o.value = String(y);
    o.selected = y === year;
    select.append(o);
  }
  select.addEventListener("change", () => { mileageState.year = Number(select.value); render(); });
  yearLabel.append(h("span", "pt-field-label", "År"), select);
  head.append(actionsRow(toggle, isManager(pid) ? button("Legg til tur", "pt-btn-primary pt-btn-small", () => mileageForm(pid)) : null), info, yearLabel);
  if (res.error) {
    head.append(inline("Kunne ikke laste kjøreboka."));
    return [back, head];
  }
  const trips = [...(res.data ?? [])].sort((a, b) => b.trip_date.localeCompare(a.trip_date) || String(b.created_at).localeCompare(String(a.created_at)));
  const meters = trips.reduce((a, t) => a + Number(t.distance_meters), 0);
  const deduction = trips.reduce((a, t) => a + Number(t.amount_minor ?? 0), 0);
  const bps = act.SET_ASIDE_BPS[year]?.[tiltakssone ? 1 : 0];
  const rateLabel = bps ? `${act.percentText(bps)}${tiltakssone ? " (tiltakssonen)" : ""}` : null;
  const grid = h("section", "pt-kpis");
  for (const [label, value] of [
    [`Km i ${year}`, act.kilometerText(meters)],
    ["Fradragsgrunnlag", money(deduction)],
    [rateLabel ? `Spart skatt (${rateLabel})` : "Spart skatt", bps ? money(Math.round((deduction * bps) / 10000)) : "Usikkert"],
  ]) {
    const k = h("section", "pt-card pt-kpi");
    k.append(h("div", "pt-kpi-top", label), h("p", "pt-kpi-value", value));
    grid.append(k);
  }
  const list = card("Alle turer", "car");
  if (!trips.length) list.append(inline("Ingen turer registrert i år."));
  else {
    const ul = h("ul", "pt-list");
    for (const t of trips) {
      const li = h("li", "pt-row");
      const main = h("div", "pt-row-main");
      const route = [act.displayPlace(t.from_place), act.displayPlace(t.to_place)].filter(Boolean).join(" – ");
      main.append(h("strong", null, route || t.purpose || "Kjøretur"), h("span", null, [dateText(t.trip_date), t.purpose, `${act.kilometerText(t.distance_meters)} km`].filter(Boolean).join(" · ")));
      li.append(icon("car", "pt-icon-circle is-tax"), main, h("span", "pt-amount is-expense", `−${money(t.amount_minor)}`));
      if (isManager(pid)) li.append(button("Rediger", "pt-btn-soft pt-btn-small", () => mileageForm(pid, t)));
      ul.append(li);
    }
    list.append(ul);
  }
  return [back, head, grid, list];
};

// Møbler og inventar (iOS AssetView). Items are loaded for every managed property so the
// private saldo covers all taxable rentals together, exactly as the app computes it.
const ASSETS_DETAILS = [
  ["p", "Når du leier ut en bolig med skattepliktige leieinntekter, kan du få fradrag for møbler og inventar som brukes i utleien."],
  ["h3", "Kjøp under 30 000 kr"],
  ["p", "Du kan vanligvis trekke fra hele beløpet samme år som du kjøper møbelet eller inventaret. Dette gjelder også ting som forventes å vare under 3 år."],
  ["h3", "Kjøp på 30 000 kr eller mer"],
  ["p", "Hvis det du kjøper forventes å vare i minst 3 år, kan du normalt trekke fra inntil 20 % av gjenværende verdi hvert år."],
  ["p", "Eksempel: Kjøper du en sofa til 50 000 kr, kan du trekke fra 10 000 kr det første året."],
  ["h3", "Avskrivning i år"],
  ["p", "Velg hvor mye du ønsker å avskrive i år (maks 20 %)."],
  ["h3", "Greit å vite"],
  ["ul", [
    "Fradrag gjelder bare når utleien gir rett til kostnadsfradrag.",
    "Kjøkken og bad regnes som en del av boligen, ikke som møbler.",
    "Du kan ikke registrere samme kjøp både som en vanlig utgift og som avskrivning.",
    "Ved enkelte kortvarige, fullt møblerte utleieforhold gjelder egne regler.",
    "Er gjenværende verdi under 30 000 kr, kan du trekke fra hele beløpet.",
  ]],
  ["muted", "Beregningene i appen er veiledende. Kontroller alltid fradragene mot gjeldende skatteregler."],
];
const assetState = { year: null, infoOpen: false, open: new Set() };
const kr = (minor) => money(minor).replace(/,00 kr$/, " kr");
const percent = (bps) => `${Math.round(bps / 100)} %`;

const loadInventory = async () => {
  const managed = state.properties.filter((p) => isManager(p.id));
  const perProperty = await Promise.all(managed.map(async (p) => {
    const [assets, mode] = await Promise.all([inv.listAssets(p.id), inv.accountingMode(p.id)]);
    const modeValue = mode.error ? null : (Array.isArray(mode.data) ? mode.data[0]?.accounting_mode ?? mode.data[0] : mode.data?.accounting_mode ?? mode.data);
    return { p, assets, scope: inv.scopeFor(modeValue, p) };
  }));
  if (perProperty.some((r) => r.assets.error)) return { error: true };
  const items = perProperty.flatMap(({ p, assets, scope }) => assets.data.map((a) => inv.itemInput(a, addressOf(p).line, scope)));
  items.sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || a.name.localeCompare(b.name, "nb"));
  const el = await inv.listElections();
  const elections = {};
  for (const e of el.error ? [] : el.data ?? []) (elections[e.scope_key] ??= {})[e.tax_year] = e;
  const scopes = Object.fromEntries(perProperty.map(({ p, scope }) => [p.id, scope]));
  return { items, elections, scopes, assets: Object.fromEntries(perProperty.flatMap(({ assets }) => assets.data.map((a) => [a.id, a]))) };
};

const assetForm = async (pid, data, asset = null) => {
  const requestId = crypto.randomUUID();
  const item = asset ? inv.itemInput(asset) : null;
  const home = asset ? null : await inv.homeUse(pid);
  const fixedTaxable = !asset && home === "other_home";
  const scope = data.scopes[pid] ?? inv.PRIVATE_SCOPE;
  const yesNo = [["", "Velg"], ["yes", "Ja"], ["no", "Nei"]];
  const decisionText = h("p", "pt-field-help");
  const rateNote = h("p", "pt-field-help", "Valget gjelder hele saldoen for kjøpsåret.");
  const rates = [];
  for (let r = 20; r >= 0; r--) rates.push([String(r * 100), `${r} %`]);
  const fields = [
    { name: "name", label: "Type møbel", value: item?.name ?? "", placeholder: "F.eks. sofa, seng eller spisebord", required: true, requiredMessage: "Skriv inn et navn." },
    { name: "amount", label: "Kjøpspris", type: "money", value: item ? act.kronerOf(item.purchaseAmountMinor) : "", placeholder: "0,00", help: "Pris inkl. mva", required: true, requiredMessage: "Skriv inn kjøpspris." },
    { name: "date", label: "Kjøpsdato", type: "date", value: item?.purchaseDate ?? todayISO(), required: true },
    { name: "kind", label: "Kategori", type: "select", options: [["loose_inventory", "Løst inventar"], ["fixed_fitting", "Fast innredning"]], value: item?.kind ?? "loose_inventory", required: true },
    { name: "treatment", label: "Standard", type: "select", options: [["maintenance", "Samme standard (vedlikehold)"], ["improvement", "Høyere standard (påkostning)"]], value: item?.fixedTreatment ?? "maintenance", help: "Kjøkken, bad og annen fast innredning er en del av boligen og avskrives ikke.", required: true },
    { name: "lifetime", label: "Forventes møbelet å vare i minst 3 år?", type: "select", options: yesNo, value: item ? (item.lifeUnderThreeYears ? "no" : "yes") : "", required: true, requiredMessage: "Svar på om møbelet forventes å vare i minst 3 år." },
    { name: "taxable", label: "Utleien er skattepliktig", type: "select", options: [["yes", "Ja"], ["no", "Nei"]], value: item ? (item.countsForTaxableRental ? "yes" : "no") : "yes", required: true },
    { name: "rate", label: "Velg hvor mye du ønsker å avskrive i år.", type: "select", options: rates, value: "2000", required: true },
    { name: "notes", label: "Merknad", type: "textarea", rows: 2, value: item?.notes ?? "", maxLength: 500 },
  ];
  const valuesOf = (get) => {
    const kind = get("kind");
    const amountMinor = act.minorOf(get("amount"));
    const year = inv.yearOf(get("date"));
    const lifetime = get("lifetime");
    const overThreshold = kind === "loose_inventory" && amountMinor != null && year != null && amountMinor >= inv.thresholdMinor(year);
    return {
      name: get("name"), amountMinor, purchaseDate: get("date"), kind, year, overThreshold,
      fixedTreatment: kind === "fixed_fitting" ? get("treatment") : null,
      // Below the threshold the lifetime question is not asked; the item is a direct deduction.
      lifeUnderThreeYears: overThreshold ? lifetime === "no" : false,
      countsForTaxableRental: fixedTaxable ? true : get("taxable") !== "no",
      notes: get("notes"),
    };
  };
  act.openForm({
    title: asset ? "Rediger møbel eller inventar" : "Legg til møbel eller inventar",
    fields,
    after: [decisionText, rateNote],
    submitLabel: "Lagre",
    onChange: (inputs, show) => {
      const v = valuesOf((n) => inputs[n]?.value ?? "");
      if (fixedTaxable) inputs.taxable.disabled = true;
      show("treatment", v.kind === "fixed_fitting");
      show("lifetime", v.overThreshold);
      const answered = !v.overThreshold || inputs.lifetime.value !== "";
      const d = v.amountMinor != null && answered ? inv.decision({ ...v, purchaseAmountMinor: v.amountMinor }) : null;
      const rateShown = v.overThreshold && d === "groupD";
      show("rate", rateShown);
      rateNote.hidden = !rateShown;
      decisionText.textContent = !d ? "" : (d === "directCost" || d === "directLife") && v.year ? `${inv.DECISION_TEXT[d]} Trekkes fra i sin helhet i ${v.year}.` : inv.DECISION_TEXT[d];
      if (rateShown) {
        const chosen = data.elections[scope.key]?.[v.year];
        if (chosen && !inputs.rate.dataset.touched) inputs.rate.value = String(inv.clampRate(chosen.rate_bps));
        inputs.rate.onchange = () => { inputs.rate.dataset.touched = "1"; };
      }
    },
    onSubmit: async (raw, inputs) => {
      const v = valuesOf((n) => raw[n] ?? "");
      if (!v.name) return "Skriv inn et navn.";
      if (!v.amountMinor || v.amountMinor <= 0) return "Skriv inn kjøpspris.";
      if (v.overThreshold && !raw.lifetime) return "Svar på om møbelet forventes å vare i minst 3 år.";
      const res = asset ? await inv.updateAsset(asset.id, v) : await inv.createAsset(pid, v, requestId);
      if (res.error) return asset ? "Kunne ikke oppdatere møbelet eller inventaret. Prøv igjen." : "Kunne ikke lagre eiendelen.";
      if (!inputs.rate.closest(".pt-field").hidden) {
        const prior = data.elections[scope.key]?.[v.year];
        const el = await inv.saveElection(v.year, Number(raw.rate), prior?.take_remainder ?? false, scope.key);
        if (el.error) {
          refresh();
          return "Møbelet er lagret, men avskrivningsvalget kunne ikke lagres. Trykk Lagre for å prøve igjen.";
        }
      }
      assetState.year = v.year;
      refresh(asset ? "Møbelet eller inventaret er oppdatert." : "Eiendel lagret.");
      return null;
    },
  });
};

const disposeForm = (asset) => {
  act.openForm({
    title: "Salg eller utrangering",
    intro: "Salgsprisen reduserer det som står igjen. Skriv 0 hvis gjenstanden kastes uten salg.",
    fields: [
      { name: "date", label: "Dato", type: "date", value: todayISO(), required: true },
      { name: "proceeds", label: "Salgssum, 0 hvis den kastes", type: "money", value: "", placeholder: "0", required: true },
    ],
    submitLabel: "Registrer salget",
    onSubmit: async (v) => {
      const proceeds = act.minorOf(v.proceeds);
      if (proceeds == null) return "Skriv inn salgssum, eller 0 hvis den kastes.";
      if (v.date < asset.purchase_date) return "Datoen kan ikke være før kjøpsdatoen.";
      const res = await inv.disposeAsset(asset.id, v.date, proceeds);
      if (res.error) return "Kunne ikke registrere salget.";
      refresh("Salg eller utrangering er registrert.");
      return null;
    },
  });
};

const metric = (title, caption, amount, ic, tone) => {
  const k = h("section", "pt-card pt-kpi");
  const top = h("div", "pt-kpi-top");
  top.append(icon(ic, `pt-icon-circle ${tone}`.trim()), h("span", null, title));
  k.append(top, h("p", "pt-kpi-value", kr(amount)));
  if (caption) k.append(h("p", "pt-kpi-note", caption));
  return k;
};

const saldoCard = (outlook, data) => {
  const s = outlook.statement;
  const c = card("Årets fradrag", "chart");
  if (outlook.scope.key !== "private") c.append(h("p", "pt-ho-status", outlook.scope.title));
  if (inv.scopeNeedsMunicipality(outlook.scope)) c.append(inline("Kommunen er ikke bekreftet for denne boligen. Saldoen holdes for seg, så den ikke blandes med en annen kommune. Åpne boligen og lagre adressen på nytt."));
  const isIncome = s.incomeRecognitionMinor > 0;
  const threshold = inv.thresholdMinor(s.taxYear);
  const chosen = outlook.election;
  const caption = isIncome
    ? (s.incomeRecognitionMinor === -s.basisMinor ? "Hele den negative saldoen" : "20 % inntektsføring")
    : s.canTakeRemainder && chosen?.take_remainder && s.depreciationMinor > 0
      ? `Hele restverdien (under ${kr(threshold).replace(" kr", "")} kr)`
      : s.basisMinor > 0 ? `${Math.round(s.rateBps / 100)} % av ${kr(s.basisMinor)}` : "";
  const grid = h("section", "pt-kpis");
  grid.append(
    metric("Direkte fradrag i år", "", s.directDeductionMinor, "check", "is-success"),
    metric(isIncome ? "Årets inntektsføring" : "Årets avskrivning", caption, isIncome ? s.incomeRecognitionMinor : s.depreciationMinor, "tax", "is-warning"),
    metric("Totalt fradrag i år", "", s.directDeductionMinor + s.depreciationMinor - s.incomeRecognitionMinor, "chart", ""),
  );
  c.append(grid, h("p", "pt-muted", `Under ${kr(threshold)}: direkte fradrag. Fra ${kr(threshold)}: 20 % avskrivning.`));
  if (s.maintenanceDeductionMinor > 0) {
    const dl = h("dl", "pt-facts");
    const d = h("div");
    d.append(h("dt", null, "Vedlikehold, fast innredning"), h("dd", null, kr(s.maintenanceDeductionMinor)));
    dl.append(d);
    c.append(dl);
  }
  if (s.missingProceeds) c.append(inline("En solgt gjenstand mangler salgssum. Saldoen er ikke redusert for den."));
  if (s.canTakeRemainder && !chosen?.take_remainder) {
    c.append(actionsRow(button("Trekk fra resten nå", "pt-btn-soft pt-btn-small", async () => {
      const res = await inv.saveElection(s.taxYear, chosen?.rate_bps ?? s.rateBps, true, outlook.scope.key);
      if (res.error) act.toast("Valget vises her, men kunne ikke lagres.");
      else refresh();
    })));
  } else if (s.negativeBalanceIsIncome) c.append(h("p", "pt-muted", "Negativ saldo tas til inntekt. Under 30 000 kr tas hele beløpet."));
  return c;
};

const assetRow = (item, row, alloc, data, showProperty) => {
  const li = h("li", "pt-row pt-row-stack");
  const top = h("div", "pt-row-line");
  const main = h("div", "pt-row-main");
  main.append(h("strong", null, item.name), h("span", null, [`Kjøpt ${dateText(item.purchaseDate)}`, showProperty ? item.propertyName : null, item.disposalDate ? "Solgt eller utrangert" : null].filter(Boolean).join(" · ")));
  const d = inv.decision(item);
  const [badge, tone] = inv.BADGE[d];
  const amount = row.isPurchase ? item.purchaseAmountMinor : row.closingMinor ?? row.openingMinor ?? item.purchaseAmountMinor;
  const side = h("div", "pt-row-side");
  side.append(h("span", "pt-amount", kr(amount)), h("span", `pt-chip ${tone}`.trim(), badge));
  top.append(icon("sofa", "pt-icon-circle is-tax"), main, side);
  li.append(top);
  const manager = isManager(item.propertyId);
  const detail = h("div", "pt-asset-detail");
  const open = assetState.open.has(item.id);
  detail.hidden = !open;
  const toggle = button(open ? "Lukk oversikt over avskrivning" : "Oversikt over avskrivning", "pt-btn-soft pt-btn-small", () => {
    const now = !assetState.open.has(item.id);
    if (now) assetState.open.add(item.id); else assetState.open.delete(item.id);
    detail.hidden = !now;
    toggle.textContent = now ? "Lukk oversikt over avskrivning" : "Oversikt over avskrivning";
  });
  const dl = h("dl", "pt-facts");
  const fact = (k, v) => {
    const x = h("div");
    x.append(h("dt", null, k), h("dd", null, v));
    dl.append(x);
  };
  if (row.isPurchase || row.openingMinor == null) fact("Total kjøpesum", kr(item.purchaseAmountMinor));
  else fact("Restverdi 1.1.", kr(row.openingMinor));
  if (row.depreciationMinor != null) fact(row.takesRemainder ? "Avskrivning i år (hele restverdien)" : d === "groupD" ? `Avskrivning i år (${Math.round(row.rateBps / 100)} %)` : "Direkte fradrag i år", kr(row.depreciationMinor));
  if (row.closingMinor != null) fact("Gjenstående til neste år", kr(row.closingMinor));
  detail.append(dl, h("p", "pt-muted", inv.DECISION_TEXT[d]));
  const asset = data.assets[item.id];
  detail.append(actionsRow(
    manager ? button("Rediger", "pt-btn-soft pt-btn-small", () => assetForm(item.propertyId, data, asset)) : null,
    manager && !item.disposalDate ? button("Selg eller utranger", "pt-btn-soft pt-btn-small", () => disposeForm(asset)) : null,
  ));
  li.append(actionsRow(toggle), detail);
  return li;
};

const assetsPage = async (pid) => {
  const thisYear = new Date().getFullYear();
  const year = assetState.year ?? thisYear;
  const back = h("a", "pt-back", "‹ Økonomi");
  back.href = "#okonomi";
  const data = await cached("inventory", loadInventory);
  const head = card("Møbler og inventar", "sofa");
  head.append(h("p", "pt-muted", "Du kan få skattefradrag for møbler og inventar som brukes i utleien."));
  const info = h("div", "pt-mileage-info");
  info.hidden = !assetState.infoOpen;
  for (const [tag, text] of ASSETS_DETAILS) {
    if (tag === "ul") {
      const ul = h("ul", "pt-bullets");
      for (const t of text) ul.append(h("li", null, t));
      info.append(ul);
    } else info.append(h(tag === "muted" ? "p" : tag, tag === "muted" ? "pt-muted" : null, text));
  }
  const toggle = button(assetState.infoOpen ? "Vis mindre" : "Les mer", "pt-btn-soft pt-btn-small", () => {
    assetState.infoOpen = !assetState.infoOpen;
    info.hidden = !assetState.infoOpen;
    toggle.textContent = assetState.infoOpen ? "Vis mindre" : "Les mer";
  });
  if (data.error) {
    head.append(actionsRow(toggle), info, inline("Kunne ikke laste eiendeler."));
    return [back, head];
  }
  const firstYear = Math.min(thisYear, year, ...data.items.map((i) => inv.yearOf(i.purchaseDate)).filter(Boolean));
  const yearLabel = h("label", "pt-field pt-filter");
  const select = h("select", "pt-select");
  for (let y = thisYear; y >= firstYear; y--) {
    const o = h("option", null, String(y));
    o.value = String(y);
    o.selected = y === year;
    select.append(o);
  }
  select.addEventListener("change", () => { assetState.year = Number(select.value); render(); });
  yearLabel.append(h("span", "pt-field-label", "År"), select);
  head.append(actionsRow(toggle, isManager(pid) ? button("Legg til møbel eller inventar", "pt-btn-primary pt-btn-small", () => assetForm(pid, data)) : null), info, yearLabel);
  const view = inv.yearView(data.items, year, data.elections);
  const cards = view.outlooks.map((o) => saldoCard(o, data));
  const list = card("Registrerte møbler", "sofa");
  const shown = data.items.filter((i) => view.rows[i.id]);
  const showProperty = new Set(data.items.map((i) => i.propertyId)).size > 1;
  if (!shown.length) list.append(inline("Ingen møbler eller inventar registrert."));
  else {
    const ul = h("ul", "pt-list");
    for (const i of shown) ul.append(assetRow(i, view.rows[i.id], view.allocations[i.id], data, showProperty));
    list.append(ul, h("p", "pt-muted", `${shown.length} ${shown.length === 1 ? "møbel" : "møbler"} registrert.`));
  }
  list.append(h("p", "pt-muted", "Estimater er til din egen planlegging. Det er ikke skatteråd og ikke skattemelding."));
  return [back, head, ...cards, list];
};

/* ---------- Medutleiere (PropertiesHomeView landlordsContent, PropertyMembersController.swift) ---------- */
// property.detail.coLandlord.delivery.*: the text is only shown when delivery needs attention.
const CO_DELIVERY = {
  pending: "Invitasjonen er lagret og venter på utsending",
  sending: "Sender e-post …",
  sent: "E-post sendt – venter på godkjenning",
  send_failed: "E-posten kunne ikke sendes – invitasjonen er lagret",
  unknown: "E-postlevering er ikke bekreftet",
};
const CO_PROBLEM = new Set(["send_failed", "unknown"]);
const CO_RESEND = new Set(["sent", "send_failed", "unknown"]);
// Kept across the re-render that follows each action, like membersController.errorMessage / deliveryNotice.
const coNotice = new Map();
const setCoNotice = (pid, text) => {
  if (text) coNotice.set(pid, text); else coNotice.delete(pid);
};
const reloadCo = async (pid, notice) => {
  setCoNotice(pid, notice);
  state.cache.delete(`mgr:${pid}`);
  state.cache.delete(`coinv:${pid}`);
  await refresh();
};

const coLandlordForm = (pid) => act.openForm({
  title: "Inviter med-utleier",
  intro: "Skriv inn e-postadressen og send invitasjonen. De trenger ikke konto fra før — lenken lar dem registrere seg eller logge inn, og de knyttes til boligen automatisk.",
  submitLabel: "Send invitasjon",
  fields: [{ name: "email", label: "E-postadresse", type: "email", required: true, maxLength: 254, placeholder: "medutleier@eksempel.no" }],
  onSubmit: async (v) => {
    if (!v.email.includes("@") || !validEmail(v.email)) return "Skriv inn en gyldig e-postadresse.";
    const res = await act.inviteCoLandlord(pid, v.email);
    if (res.error) return act.coLandlordAddError(res.error);
    const email = res.invitation.email || v.email.trim().toLowerCase();
    await reloadCo(pid, res.sent === false ? `Invitasjonen til ${email} er lagret, men e-posten kunne ikke sendes. Du kan prøve på nytt nedenfor.` : null);
    if (res.sent) act.toast("Invitasjonen er sendt.");
    return null;
  },
});

const shareCoLandlordLink = async (b, inv) => {
  b.disabled = true;
  b.textContent = "Lager invitasjonslenke …";
  const link = await act.coLandlordShareLink(inv.invitation_id);
  b.disabled = false;
  b.textContent = "Del invitasjonen manuelt";
  if (!link) return act.toast("Kunne ikke lage invitasjonslenken. Prøv igjen.");
  const text = `Du er invitert som med-utleier i Enkel Utleie. Åpne lenken og logg inn med ${inv.email}.\n${link}`;
  try {
    await navigator.clipboard.writeText(text);
    act.toast("Invitasjonslenken er kopiert. Lim den inn i en melding.");
  } catch {
    act.toast("Kunne ikke kopiere invitasjonslenken. Prøv igjen.");
  }
};

const coInvitationRow = (pid, inv) => {
  const li = h("li", "pt-row");
  const main = h("div", "pt-row-main");
  main.append(h("strong", null, inv.email));
  if (CO_PROBLEM.has(inv.delivery_status)) main.append(h("span", "pt-text-danger", CO_DELIVERY[inv.delivery_status]));
  li.append(h("span", "pt-avatar pt-avatar-sm", (inv.email || "?").charAt(0).toUpperCase()), main, h("span", "pt-chip is-warning", "Venter"));
  const actions = h("div", "pt-row-actions");
  if (CO_RESEND.has(inv.delivery_status)) {
    actions.append(button("Send på nytt", "pt-btn-soft pt-btn-small", async (e) => {
      e.currentTarget.disabled = true;
      const res = await act.resendCoLandlordInvitation(inv.invitation_id);
      await reloadCo(pid, res.sent ? null : `E-posten til ${inv.email} kunne ikke sendes. Invitasjonen er fortsatt lagret.`);
      if (res.sent) act.toast("Invitasjonen er sendt på nytt.");
    }));
  }
  if (inv.delivery_status === "send_failed") {
    const share = button("Del invitasjonen manuelt", "pt-btn-soft pt-btn-small", (e) => shareCoLandlordLink(e.currentTarget, inv));
    actions.append(share);
  }
  actions.append(button("Kanseller", "pt-btn-quiet-destructive pt-btn-small", async () => {
    if (!(await act.confirmAction({ title: "Kanseller invitasjonen til med-utleier?", text: "Tidligere lenker blir ugyldige, og personen får ikke tilgang.", confirmLabel: "Kanseller invitasjon" }))) return;
    const res = await act.cancelCoLandlordInvitation(inv.invitation_id);
    if (res.error) return reloadCo(pid, "Invitasjonen kunne ikke kanselleres. Prøv igjen.");
    if (res.data === "cancelled") return reloadCo(pid, null);
    return reloadCo(pid, res.data === "accepted" ? "Invitasjonen er allerede godtatt." : "Invitasjonen er ikke lenger aktiv.");
  }));
  li.append(actions);
  return li;
};

// PropertyDetail rooms (bofellesskap): add, rename and retire rooms with the
// same RPCs as the app. A room with a tenancy or a pending invitation stays.
const roomForm = (pid, rooms, room = null) => act.openForm({
  title: room ? "Endre navn" : "Legg til rom",
  submitLabel: room ? "Lagre" : "Legg til rom",
  fields: [{ name: "label", label: "Navn på rom", type: "text", required: true, requiredMessage: "Skriv inn et navn på rommet.", maxLength: 80, placeholder: "For eksempel Rom 1", value: room ? room.label : act.nextRoomLabel(rooms) }],
  onSubmit: async (v) => {
    const invalid = act.roomLabelError(v.label, rooms, room?.id ?? null);
    if (invalid) return invalid;
    if (room && v.label.trim() === room.label.trim()) return null;
    const res = room ? await act.renameRoom(room.id, v.label) : await act.createRoom(pid, v.label);
    if (res.error) return res.error;
    await refresh(room ? "Romnavnet er endret." : "Rommet er lagt til.");
    return null;
  },
});

const roomsCard = async (pid) => {
  const res = await cached(`rooms:${pid}`, () => act.propertyRooms(pid));
  const c = card("Rom", "building");
  if (res.error) {
    c.append(h("p", null, "Rommene kunne ikke hentes akkurat nå. Prøv igjen."),
      actionsRow(button("Prøv igjen", "pt-btn-secondary pt-btn-small", () => { state.cache.delete(`rooms:${pid}`); refresh(); })));
    return c;
  }
  const rooms = res.data;
  if (!rooms.length) c.append(h("p", "pt-muted", "Ingen rom ennå. Legg til det første rommet."));
  else {
    const list = h("ul", "pt-list");
    for (const r of rooms) {
      const li = h("li", "pt-row");
      const main = h("div", "pt-row-main");
      main.append(h("strong", null, r.label));
      li.append(main, h("span", `pt-chip${r.status ? " is-info" : ""}`, r.status ?? "Ledig"));
      const actions = h("div", "pt-row-actions");
      if (r.kind === "room") actions.append(button("Endre navn", "pt-btn-soft pt-btn-small", () => roomForm(pid, rooms, r)));
      if (r.canRetire) {
        actions.append(button("Lukk rom", "pt-btn-quiet-destructive pt-btn-small", async () => {
          if (!(await act.confirmAction({ title: `Lukke ${r.label}?`, text: "Rommet blir ikke lenger tilgjengelig for nye leieforhold. Historikk beholdes. Rom med et aktivt leieforhold kan ikke lukkes.", confirmLabel: `Lukk ${r.label}` }))) return;
          const out = await act.retireRoom(r.id);
          if (out.error) return act.toast(out.error);
          await refresh("Rommet er lukket.");
        }));
      }
      li.append(actions);
      list.append(li);
    }
    c.append(list);
  }
  const full = rooms.filter((r) => r.kind === "room").length >= act.ROOM_LIMIT;
  c.append(h("p", "pt-muted", full ? "Et bofellesskap kan ha opptil 10 rom." : "Rom leies ut hver for seg. Hvert rom har eget leieforhold og egen leiekontrakt."));
  if (!full) c.append(actionsRow(button("Legg til rom", "pt-btn-primary pt-btn-small", () => roomForm(pid, rooms))));
  return c;
};

const landlordsCard = async (pid) => {
  const [mgr, coinv] = await Promise.all([
    cached(`mgr:${pid}`, () => act.propertyManagers(pid)),
    cached(`coinv:${pid}`, () => act.coLandlordInvitations(pid)),
  ]);
  const managers = mgr.data ?? [];
  const c = card(managers.length > 1 ? "Utleiere" : "Utleier", "key");
  if (mgr.error && !managers.length) {
    c.append(h("p", null, "Utleierne ble ikke hentet. Ingenting ble endret. Prøv igjen."),
      actionsRow(button("Prøv igjen", "pt-btn-secondary pt-btn-small", () => reloadCo(pid, null))));
    return c;
  }
  const list = h("ul", "pt-list");
  for (const m of managers) {
    const li = h("li", "pt-row");
    const name = m.display_name || m.email || "Utleier";
    li.append(h("span", "pt-avatar pt-avatar-sm", name.charAt(0).toUpperCase()));
    const main = h("div", "pt-row-main");
    main.append(h("strong", null, name), h("span", null, [m.email, m.phone_number].filter(Boolean).join(" · ")));
    li.append(main, h("span", `pt-chip${m.role === "owner" ? " is-info" : ""}`, m.role === "owner" ? "Eier" : "Medutleier"));
    if (m.role === "co_landlord" && m.user_id !== state.user?.id) {
      li.append(button("Fjern", "pt-btn-quiet-destructive pt-btn-small", async () => {
        if (!(await act.confirmAction({ title: "Fjerne med-utleier?", text: "Personen mister umiddelbart tilgang til denne boligen og tilhørende data.", confirmLabel: "Fjern tilgang" }))) return;
        const res = await act.removeCoLandlord(pid, m.user_id);
        await reloadCo(pid, res.error ? "Kunne ikke fjerne utleieren. Prøv igjen." : null);
        if (!res.error) act.toast("Med-utleieren er fjernet.");
      }));
    }
    list.append(li);
  }
  c.append(list);
  const pending = (coinv.data ?? []).filter((i) => !i.status || i.status === "pending");
  if (pending.length) {
    const plist = h("ul", "pt-list");
    pending.forEach((i) => plist.append(coInvitationRow(pid, i)));
    c.append(h("p", "pt-label", "Venter på godkjenning"), plist);
  }
  if (coinv.error) {
    c.append(h("p", "pt-text-danger", pending.length
      ? "Kunne ikke oppdatere invitasjonene til med-utleier. Invitasjonene under vises fortsatt."
      : "Invitasjonene til med-utleier ble ikke hentet. Ingenting ble endret. Prøv igjen."));
  }
  const notice = coNotice.get(pid);
  coNotice.delete(pid);
  if (notice) c.append(h("p", "pt-banner is-danger", notice));
  c.append(h("p", "pt-muted", "En medutleier kan administrere boligen sammen med deg."),
    actionsRow(button("Legg til medutleier", "pt-btn-primary pt-btn-small", () => { setCoNotice(pid, null); coLandlordForm(pid); })));
  return c;
};

// IncomingCoLandlordInvitationsCard: shown on the overview while someone has invited you.
let incomingCoNotice = null;
const incomingCoLandlordCard = async () => {
  const res = await cached("coinv:mine", () => act.myCoLandlordInvitations());
  const rows = res.data ?? [];
  const notice = incomingCoNotice;
  if (!rows.length && !res.error && !notice) return null;
  const c = card("Invitasjon som med-utleier", "key");
  if (res.error && !rows.length) {
    c.append(h("p", null, "Invitasjonene som med-utleier ble ikke hentet. Ingenting ble endret. Prøv igjen."),
      actionsRow(button("Prøv igjen", "pt-btn-secondary pt-btn-small", () => { state.cache.delete("coinv:mine"); refresh(); })));
    return c;
  }
  if (!rows.length) {
    incomingCoNotice = null;
    c.append(h("p", `pt-banner ${notice.ok ? "is-success" : "is-danger"}`, notice.text));
    return c;
  }
  const done = async (n) => {
    incomingCoNotice = n;
    state.cache.delete("coinv:mine");
    await refresh();
  };
  const list = h("ul", "pt-list");
  for (const i of rows) {
    const li = h("li", "pt-row");
    const main = h("div", "pt-row-main");
    main.append(h("strong", null, i.property_display_name),
      h("span", null, [i.property_location, `Fra ${i.inviter_display_name}`].filter(Boolean).join(" · ")),
      h("span", null, `Sendt til ${i.email}. Du får først tilgang når du godtar.`));
    const actions = h("div", "pt-row-actions");
    actions.append(
      button("Godta som med-utleier", "pt-btn-primary pt-btn-small", async (e) => {
        e.currentTarget.disabled = true;
        const r = await act.acceptCoLandlordInvitation(i.invitation_id);
        if (r.error) return done({ text: "Kunne ikke godta invitasjonen. Prøv igjen." });
        const outcome = r.result?.outcome;
        if (outcome === "accepted") return done({ ok: true, text: `Du er nå med-utleier for ${r.result.property_display_name || i.property_display_name}.` });
        if (outcome === "email_unconfirmed") return done({ text: "E-postadressen må være bekreftet før du kan godta invitasjonen." });
        if (outcome === "expired") return done({ text: "Invitasjonen er utløpt. Be utleieren sende en ny." });
        return done({ text: "Invitasjonen er ikke lenger aktiv." });
      }),
      button("Avslå invitasjon", "pt-btn-quiet-destructive pt-btn-small", async () => {
        if (!(await act.confirmAction({ title: "Avslå invitasjonen som med-utleier?", text: "Invitasjonen fjernes, og e-postlenken blir ugyldig.", confirmLabel: "Avslå invitasjon" }))) return;
        const r = await act.declineCoLandlordInvitation(i.invitation_id);
        if (r.error || r.data !== "declined") return done({ text: "Kunne ikke avslå invitasjonen. Prøv igjen." });
        return done({ ok: true, text: "Invitasjonen som med-utleier er avslått." });
      }),
    );
    li.append(main, actions);
    list.append(li);
  }
  c.append(list);
  if (notice) {
    incomingCoNotice = null;
    c.append(h("p", `pt-banner ${notice.ok ? "is-success" : "is-danger"}`, notice.text));
  }
  if (res.error) c.append(h("p", "pt-text-danger", "Kunne ikke oppdatere invitasjoner som med-utleier. Invitasjonene under vises fortsatt."));
  return c;
};

/* ---------- Boligbilder (PropertyDetailTopCard / PropertyGalleryViewer) ---------- */
const linkButton = (label, href) => {
  const l = h("a", "pt-btn pt-btn-soft pt-btn-small", label);
  l.href = href;
  return l;
};
const GALLERY_LIMIT_TEXT = "Du kan ha opptil 12 bilder per bolig. Slett et bilde for å legge til et nytt.";

const galleryViewer = (images, start, urls, onRemove) => {
  let index = start;
  const dialog = h("dialog", "pt-modal pt-gallery-modal");
  const box = h("div", "pt-modal-card");
  const head = h("div", "pt-card-head");
  head.append(h("h2", null, "Boligbilder"));
  const img = h("img", "pt-gallery-full");
  const page = h("p", "pt-muted pt-gallery-page");
  const close = () => { dialog.close(); dialog.remove(); };
  const show = async () => {
    const image = images[index];
    page.textContent = `${index + 1} av ${images.length}`;
    img.alt = `Boligbilde ${index + 1} av ${images.length}`;
    img.removeAttribute("src");
    const url = urls.get(image.id) ?? (await act.propertyImageUrl(image.storage_path).catch(() => null));
    if (url && images[index] === image) { urls.set(image.id, url); img.src = url; }
  };
  const prev = button("Forrige", "pt-btn-soft pt-btn-small", () => { index = (index - 1 + images.length) % images.length; show(); });
  const next = button("Neste", "pt-btn-soft pt-btn-small", () => { index = (index + 1) % images.length; show(); });
  prev.disabled = next.disabled = images.length < 2;
  const remove = button("Fjern dette bildet", "pt-btn-quiet-destructive pt-btn-small", async () => {
    const ok = await act.confirmAction({ title: "Fjern dette bildet", text: "Bildet blir fjernet fra boligen.", confirmLabel: "Fjern" });
    if (!ok) return;
    remove.disabled = true;
    const err = await onRemove(images[index]);
    remove.disabled = false;
    if (err) return act.toast(err);
    close();
  });
  const actions = h("div", "pt-modal-actions");
  actions.append(remove, prev, next, button("Ferdig", "pt-btn-primary", close));
  box.append(head, img, page, actions);
  dialog.append(box);
  dialog.addEventListener("cancel", close);
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" && images.length > 1) prev.click();
    if (e.key === "ArrowRight" && images.length > 1) next.click();
  });
  document.body.append(dialog);
  dialog.showModal();
  show();
};

const galleryCard = async (p) => {
  const c = card("Boligbilder", "photo");
  const res = await act.galleryImages(p.id);
  if (res.error) {
    c.append(inline("Kunne ikke hente bildene. Prøv igjen."));
    return c;
  }
  const images = res.data;
  const urls = new Map();
  const remove = async (image) => {
    const err = await act.deletePropertyImage(image.id);
    if (err) return err;
    await refresh("Bildet er slettet.");
    return null;
  };
  if (images.length) {
    const grid = h("div", "pt-gallery-grid");
    images.forEach((image, i) => {
      const b = h("button", "pt-gallery-item");
      b.type = "button";
      b.setAttribute("aria-label", `Åpne boligbilde ${i + 1} av ${images.length}`);
      const img = mtThumb(async () => {
        const url = await act.propertyImageUrl(image.storage_path).catch(() => null);
        if (url) urls.set(image.id, url);
        return url;
      }, `Boligbilde ${i + 1}`);
      b.append(img);
      b.addEventListener("click", () => galleryViewer(images, i, urls, remove));
      grid.append(b);
    });
    c.append(grid, h("p", "pt-muted", `${images.length} av ${act.GALLERY_LIMIT} bilder`));
  } else {
    c.append(inline("Ingen bilder ennå."));
  }
  c.append(h("p", "pt-muted", "Bare synlig for deg og andre utleiere på boligen. Deles ikke med leietaker."));
  const input = h("input", "pt-visually-hidden");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.addEventListener("change", async () => {
    const files = [...input.files];
    input.value = "";
    if (!files.length) return;
    const room = act.GALLERY_LIMIT - images.length;
    if (files.length > room) act.toast("Du kan legge til inntil 12 bilder per bolig.");
    const chosen = files.slice(0, room);
    let added = 0;
    for (const file of chosen) {
      if (!file.type?.startsWith("image/")) { act.toast("Velg en bildefil."); break; }
      const err = await act.uploadPropertyPhoto(p.id, state.user.id, file).catch(() => "Bildet kunne ikke lagres. Prøv igjen.");
      if (err) { act.toast(err); break; }
      added += 1;
    }
    if (added) await refresh(added === 1 ? "Bildet er lastet opp." : `${added} bilder er lastet opp.`);
  });
  const add = button(images.length ? "Legg til flere bilder" : "Legg til boligbilde", "pt-btn-secondary pt-btn-small", () => {
    if (images.length >= act.GALLERY_LIMIT) return act.toast(GALLERY_LIMIT_TEXT);
    input.click();
  });
  c.append(input, actionsRow(add));
  return c;
};

const PAGES = {
  async oversikt() {
    const out = [band()];
    const incoming = await incomingCoLandlordCard();
    if (incoming) out.push(incoming);
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
  async okonomi(sub) {
    const p = property();
    if (!p) return [noProperty()];
    if (sub === "kjorebok") return mileagePage(p.id);
    if (sub === "mobler") return assetsPage(p.id);
    if (sub === "arsoppgave") return annualPage(p.id);
    return [await kpis(p.id), economyTiles(), ...(await transactionList(p.id))];
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
    [["Boligperm", "#boligperm"], ["Dokumenter og maler", "#dokumenter"], ["Vedlikeholdshistorikk", isManager() ? "#vedlikehold/historikk" : "#vedlikehold"]].forEach(([t, href]) => {
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
        linkButton("Boligbilder", "#bilder"),
      ));
    }
    if (p.finn_code) {
      const d = h("div");
      dl.append(d);
      d.append(h("dt", null, "Finn-kode"), h("dd", null, p.finn_code));
    }
    out.push(c);
    if (isManager(p.id) && p.housing_kind === "shared") out.push(await roomsCard(p.id));
    out.push(await tenancyCard(p.id));
    if (isManager(p.id)) out.push(await landlordsCard(p.id));
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
  async kalender(sub, extra) {
    if (sub) return calendarDetail(sub, extra);
    const p = property();
    return p ? [await calendarCard(p.id, true)] : [noProperty()];
  },
  async vedlikehold(sub) {
    if (!property()) return [noProperty()];
    if (sub === "historikk") return maintenanceHistory(state.propertyId);
    if (sub) return maintenanceDetail(state.propertyId, sub);
    return maintenanceList(state.propertyId);
  },
  async bilder() {
    const p = property();
    if (!p) return [noProperty()];
    if (!isManager(p.id)) return [emptyPage("photo", "Bilder", "Boligbildene er bare synlige for utleiere på boligen.")];
    return [await galleryCard(p)];
  },
  async "inn-utflytting"(sub) {
    const p = property();
    if (!p) return [noProperty()];
    const t = hoTenancy(p.id);
    if (!t) return [emptyPage("handover", "Inn- og utflytting", "Inn- og utflytting åpnes når det finnes et aktivt leieforhold.")];
    const d = await hoLoad(t);
    if (!d) return [inline("Statusen kunne ikke hentes akkurat nå.")];
    if (sub === "innflytting") return hoMoveInPage(p, t, d);
    if (sub === "utflytting") return hoMoveOutPage(p, t, d);
    if (sub === "depositum") return hoDepositPage(p, t, d);
    return hoOverview(p, t, d);
  },
  async leiekontrakt() {
    const p = property();
    if (!p) return [noProperty()];
    if (!isManager(p.id)) return tenantContractCards(p);
    return [await landlordContractCard(p)];
  },
  dokumenter: documentsPage,
  async meldinger() { return chatPage(); },
  async historikk(sub) {
    const p = property();
    if (!p) return [noProperty()];
    if (!isManager(p.id)) return [emptyPage("history", "Leiehistorikk", "Ingen tidligere leieforhold ennå.")];
    return sub ? tenancyHistoryDetail(p.id, sub) : tenancyHistoryList(p.id);
  },
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
    return isLandlord() ? [c, privacyExportCard(), await archivedCard()] : [c, privacyExportCard()];
  },
};

/* ---------- Last ned mine data (PrivacyCenterView / PrivacyExportDeliveryViewModel) ---------- */
const PRIVACY_TEXT = {
  idle: "Last ned en kopi av personopplysningene dine som PDF.",
  preparing: "Klargjør dataene dine…",
  reviewing: "Forespørselen din er under behandling. Du får beskjed når dataene er klare.",
  delayed: "Det tar lengre tid enn vanlig å klargjøre dataene dine. Forespørselen er registrert, og du kan prøve igjen senere.",
  timedOut: "Det tok for lang tid å klargjøre dataene dine. Prøv igjen.",
  error: "Kunne ikke klargjøre data",
  downloaded: "Dataene dine er lastet ned.",
  blocked: "Nettleseren fikk ikke kontakt med eksporttjenesten. Dataene dine kan foreløpig lastes ned i appen under Mine personvernforespørsler.",
};
const PRIVACY_POLL_MS = 10_000;
const PRIVACY_STALL_MS = 180_000;
const PRIVACY_TOTAL_MS = 300_000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function privacyExportCard() {
  const c = card("Last ned mine data", "doc");
  const text = h("p", "pt-muted");
  const row = h("div", "pt-links");
  c.append(text, row);
  const uid = state.user.id;
  let run = 0;
  const show = (key, actions = []) => {
    text.textContent = PRIVACY_TEXT[key];
    row.replaceChildren(...actions);
  };
  const startButton = (label = "Last ned") => button(label, "pt-btn-primary pt-btn-small", () => start());
  const busy = () => {
    const b = button("Last ned", "pt-btn-primary pt-btn-small", () => {});
    b.disabled = true;
    return b;
  };
  const idle = () => show("idle", [startButton()]);

  const save = async (caseId) => {
    const dl = await act.downloadPrivacyExport(caseId);
    if (dl.error) return dl.error;
    let bytes;
    try {
      bytes = letter.letterPdf(privacy.exportBlocks(privacy.zipEntries(dl.zip)), { logo: await act.letterLogoJpeg(), title: privacy.PDF_TITLE });
    } catch {
      return "failed";
    }
    const a = h("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    a.download = privacy.FILE_NAME;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    // The browser has the file; finalize like completeUserSave.
    if (await act.confirmPrivacyExportSaved(caseId)) act.privacyExportCase.clear(uid);
    return "saved";
  };

  const start = async () => {
    const mine = ++run;
    const alive = () => mine === run && c.isConnected;
    show("preparing", [busy()]);
    let caseId = act.privacyExportCase.get(uid);
    let replaced = false;
    let failure = "error";
    const fresh = async () => {
      const r = await act.requestPrivacyExport();
      if (r.error === "blocked") failure = "blocked";
      if (!r.case_id) return false;
      act.privacyExportCase.set(uid, r.case_id);
      caseId = r.case_id;
      return true;
    };
    if (!caseId && !(await fresh())) { if (alive()) show(failure, [startButton("Prøv igjen")]); return; }
    const began = Date.now();
    let progressAt = Date.now();
    let lastStage = null;
    while (alive()) {
      const r = await act.privacyExportStatus(caseId);
      if (!alive()) return;
      const s = r.status;
      const needsNew = r.error === "not_available" || s?.state === "expired" || s?.state === "downloaded";
      if (needsNew) {
        if (replaced || !(await fresh())) { show(failure, [startButton("Prøv igjen")]); return; }
        replaced = true;
        progressAt = Date.now();
      } else if (r.error) {
        show("error", [startButton("Prøv igjen")]);
        return;
      } else if (s.state === "processing" && s.processing_stage === "reviewing") {
        show("reviewing");
        return;
      } else if (s.state === "failed") {
        show("error", [startButton("Prøv igjen")]);
        return;
      } else if (s.state === "ready") {
        const out = await save(caseId);
        if (!alive()) return;
        if (out === "saved") { show("downloaded", [startButton()]); return; }
        if (out === "blocked") { show("blocked", [startButton("Prøv igjen")]); return; }
        if (out === "not_available" && !replaced) { act.privacyExportCase.clear(uid); caseId = null; if (!(await fresh())) { show(failure, [startButton("Prøv igjen")]); return; } replaced = true; continue; }
        show("error", [startButton("Prøv igjen")]);
        return;
      } else {
        const stage = `${s.processing_stage}|${s.updated_at}`;
        if (stage !== lastStage) { lastStage = stage; progressAt = Date.now(); }
      }
      if (Date.now() - began > PRIVACY_TOTAL_MS) { show("timedOut", [startButton("Prøv igjen")]); return; }
      if (Date.now() - progressAt > PRIVACY_STALL_MS) {
        show("delayed", [startButton("Prøv igjen"), button("Lukk", "pt-btn-secondary pt-btn-small", idle)]);
        return;
      }
      await wait(PRIVACY_POLL_MS);
    }
  };

  // restoreStatus: a stored case resumes where it was (no automatic download).
  const restore = async () => {
    const caseId = act.privacyExportCase.get(uid);
    if (!caseId) return idle();
    show("preparing", [busy()]);
    const r = await act.privacyExportStatus(caseId);
    if (!c.isConnected) return;
    const s = r.status;
    if (s?.state === "processing" && s.processing_stage === "reviewing") return show("reviewing");
    if (s?.state === "processing") return start();
    if (s?.state === "ready") return idle();
    if (s?.state === "failed") return show("error", [startButton("Prøv igjen")]);
    act.privacyExportCase.clear(uid);
    return s?.state === "downloaded" ? show("downloaded", [startButton()]) : idle();
  };
  idle();
  queueMicrotask(restore);
  return c;
}

/* ---------- Varsler i bjella (NotificationsView) ---------- */
const notificationTime = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
  return today ? `I dag ${time}` : `${d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" })} ${time}`;
};

const bell = { scope: null, rows: [], more: false, loading: false, loadingMore: false, failed: false, open: false, token: 0, wakeTimer: null, stop: null };
const bellScope = () => (isLandlord() ? "manager" : "tenant");
const bellEls = () => ({ wrap: root.querySelector("[data-bell-wrap]"), btn: root.querySelector("[data-bell]") });

const loadBell = async ({ quiet = false } = {}) => {
  const scope = bell.scope;
  const token = ++bell.token;
  if (!quiet || !bell.rows.length) { bell.loading = !bell.rows.length; drawBell(); }
  const res = await act.listNotifications(scope);
  if (token !== bell.token || scope !== bell.scope) return;
  bell.loading = false;
  if (res.error) {
    if (bell.rows.length) act.toast("Kunne ikke oppdatere varslene. Listen du allerede ser er beholdt.");
    else bell.failed = true;
  } else {
    bell.failed = false;
    bell.rows = res.data ?? [];
    bell.more = bell.rows.length >= act.NOTIFICATION_PAGE_SIZE;
  }
  drawBell();
};
const loadMoreBell = async () => {
  if (bell.loadingMore || !bell.rows.length) return;
  const scope = bell.scope;
  const token = bell.token;
  bell.loadingMore = true;
  drawBell();
  const res = await act.listNotifications(scope, bell.rows[bell.rows.length - 1]);
  bell.loadingMore = false;
  if (token !== bell.token || scope !== bell.scope) return drawBell();
  if (res.error) { act.toast("Kunne ikke hente flere varsler."); return drawBell(); }
  const seen = new Set(bell.rows.map((r) => r.notification_id));
  const next = (res.data ?? []).filter((r) => !seen.has(r.notification_id));
  bell.rows = bell.rows.concat(next);
  bell.more = (res.data ?? []).length >= act.NOTIFICATION_PAGE_SIZE;
  drawBell();
};
const syncBellScope = () => {
  if (!bellEls().btn) return;
  const scope = bellScope();
  if (scope === bell.scope) return;
  bell.scope = scope;
  bell.rows = [];
  bell.more = false;
  bell.failed = false;
  loadBell();
};
const wakeBell = () => {
  clearTimeout(bell.wakeTimer);
  bell.wakeTimer = setTimeout(() => { if (bell.scope) loadBell({ quiet: true }); }, 400);
};

const openNotification = (n) => {
  const scope = bell.scope;
  if (n.is_unread) {
    n.is_unread = false;
    drawBell();
    act.markNotificationRead(scope, n.notification_id).then((res) => {
      if (!res.error) return;
      n.is_unread = true;
      drawBell();
      act.toast("Kunne ikke merke varselet som lest. Prøv igjen.");
    });
  }
  const target = notificationRoute(n, scope);
  if (!target) return act.toast("Denne hendelsen har ingen egen detaljside. Varselet hører likevel hjemme i listen.");
  if (n.property_id && n.property_id !== state.propertyId) {
    if (!state.properties.some((p) => p.id === n.property_id)) return act.toast("Varsel er ikke tilgjengelig. Dette varselet er ikke lenger i listen.");
    selectProperty(n.property_id, false);
  }
  closeBell();
  if (location.hash === target) render(); else location.hash = target;
};
const markAllBell = async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const res = await act.markAllNotificationsRead(bell.scope);
  if (res.error) { btn.disabled = false; return act.toast("Kunne ikke merke alle varsler som lest. Prøv igjen."); }
  bell.rows.forEach((r) => { r.is_unread = false; });
  drawBell();
};

const drawBell = () => {
  const { wrap, btn } = bellEls();
  if (!btn) return;
  const unread = bell.rows.filter((r) => r.is_unread).length;
  btn.innerHTML = ICONS.bell;
  btn.setAttribute("aria-expanded", String(bell.open));
  btn.setAttribute("aria-label", unread ? `Varsler, ${unread} uleste` : "Varsler");
  if (unread) btn.append(h("span", "pt-badge", unread >= act.NOTIFICATION_PAGE_SIZE && bell.more ? `${unread}+` : String(unread)));
  wrap.querySelector(".pt-notif")?.remove();
  if (!bell.open) return;
  const panel = h("section", "pt-notif");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Varsler");
  const head = h("div", "pt-notif-head");
  head.append(h("h2", null, "Varsler"));
  const all = button("Merk alle som lest", "pt-btn-soft pt-btn-small", markAllBell);
  all.disabled = !unread;
  head.append(all);
  panel.append(head);
  const body = h("div", "pt-notif-body");
  if (bell.loading) body.append(h("p", "pt-muted pt-notif-note", "Laster varsler …"));
  else if (bell.failed) {
    const box = h("div", "pt-notif-empty");
    box.append(h("strong", null, "Varslene er ikke tilgjengelige"), h("p", null, "Listen kunne ikke lastes. Trykk Prøv igjen."),
      button("Prøv igjen", "pt-btn-secondary pt-btn-small", () => loadBell()));
    body.append(box);
  } else if (!bell.rows.length) {
    const box = h("div", "pt-notif-empty");
    box.append(icon("bell"), h("strong", null, "Ingen varsler ennå"),
      h("p", null, "Når noe skjer i et leieforhold, vedlikehold eller kalenderpunkt, vises det her for den aktive rollen din."));
    body.append(box);
  } else {
    const list = h("ul", "pt-notif-list");
    for (const n of bell.rows) {
      const li = h("li");
      const row = h("button", `pt-notif-row${n.is_unread ? " is-unread" : ""}`);
      row.type = "button";
      const main = h("span", "pt-notif-main");
      main.append(h("strong", null, notificationTitle(n)));
      const summary = notificationText(n, bell.scope, act.TERMINATION_REASONS);
      if (summary) main.append(h("span", "pt-notif-summary", summary));
      main.append(h("span", "pt-notif-time", notificationTime(n.occurred_at || n.relevant_at)));
      const dot = h("span", "pt-notif-dot");
      if (n.is_unread) dot.setAttribute("aria-label", "Ulest");
      row.append(dot, main);
      row.addEventListener("click", () => openNotification(n));
      li.append(row);
      list.append(li);
    }
    body.append(list);
    if (bell.more) {
      const more = button(bell.loadingMore ? "Laster varsler …" : "Last inn flere", "pt-btn-secondary pt-btn-small", loadMoreBell);
      more.disabled = bell.loadingMore;
      const foot = h("div", "pt-notif-foot");
      foot.append(more);
      body.append(foot);
    }
  }
  panel.append(body);
  wrap.append(panel);
};
const closeBell = () => {
  if (!bell.open) return;
  bell.open = false;
  drawBell();
};
const startBell = () => {
  const { wrap, btn } = bellEls();
  if (!btn) return;
  btn.addEventListener("click", () => {
    bell.open = !bell.open;
    drawBell();
    if (bell.open) loadBell({ quiet: true });
  });
  document.addEventListener("click", (e) => { if (bell.open && !wrap.contains(e.target)) closeBell(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && bell.open) { closeBell(); btn.focus(); } });
  window.addEventListener("focus", wakeBell);
  // ForegroundRefreshCadence.notificationReminder: refetch every 5 minutes while open.
  setInterval(() => { if (!document.hidden) wakeBell(); }, 300_000);
  bell.stop = act.subscribeNotifications(wakeBell);
  drawBell();
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
// A page may leave something running (the chat's realtime channel); stop it on the next render.
let pageCleanup = null;
const setPageCleanup = (fn) => { pageCleanup?.(); pageCleanup = fn; };
const render = async () => {
  setPageCleanup(null);
  const items = allItems();
  closeBell();
  // Sub-routes: #vedlikehold/<sak-id>, #vedlikehold/historikk and #kalender/<id>[/<sak-id>].
  let [id, sub, extra] = location.hash.slice(1).split("/");
  if (id === "overtakelse") id = "inn-utflytting";
  if (!items.some((i) => i.id === id)) { id = "oversikt"; sub = undefined; extra = undefined; }
  renderNav(id);
  const item = items.find((i) => i.id === id);
  root.querySelector("[data-page-title]").textContent = !isLandlord() && item.tenantLabel ? item.tenantLabel : item.label;
  const role = property() ? roleOf(state.propertyId) : null;
  root.querySelector("[data-user-role]").textContent = role ?? (state.roles.size ? "Utleier" : "");
  syncBellScope();
  const token = ++renderToken;
  let nodes;
  try {
    nodes = await PAGES[id](sub, extra);
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
    supabase.from("properties").select("id, address_line1, address_line2, postal_code, city, unit_identifier, housing_kind, rental_profile, finn_code, payment_account_override, municipality_number, municipality_name")
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
  if (!isRefresh) startBell();
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
