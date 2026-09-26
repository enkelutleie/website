import { supabase, setAuthState } from "./supabase.js";
import { initHeader } from "./header.js";
import "./portal.css";

// Read-only overview. Every query runs with the user's own session, so RLS
// decides what is visible. No writes, no service key.

const header = document.querySelector("[data-site-header]");
if (header) {
  const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}
initHeader();

const root = document.querySelector("[data-portal]");
const toLogin = () => location.replace("/logg-inn/");

const OPEN_TASK_STATUSES = ["reported", "in_progress", "waiting"];
const VISIBLE_TENANCY_STATUSES = ["draft", "invited", "active"];
const TENANCY_LABEL = { draft: "Utkast", invited: "Invitert", active: "Aktivt" };

const $ = (selector) => root.querySelector(selector);

const firstNameOf = (profile, user) => {
  const first = profile?.first_name?.trim();
  if (first) return first;
  const display = profile?.display_name?.trim();
  if (display) return display;
  const metaName = user?.user_metadata?.full_name?.trim() || user?.user_metadata?.name?.trim();
  if (metaName) return metaName;
  const email = user?.email ?? "";
  if (email && !/@privaterelay\.appleid\.com$/i.test(email)) return email;
  return null;
};

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
};

const addressOf = (property) => {
  const line = [property.address_line1, property.address_line2].filter(Boolean).join(", ");
  const place = [property.postal_code, property.city].filter(Boolean).join(" ");
  return { line: line || "Bolig uten adresse", place };
};

const tenancyText = (tenancy) => {
  const label = TENANCY_LABEL[tenancy.status] ?? tenancy.status;
  const from = formatDate(tenancy.start_date);
  const to = formatDate(tenancy.end_date);
  if (from && to) return `${label} · ${from}–${to}`;
  if (from) return `${label} · fra ${from}`;
  return label;
};

const renderProperty = (property, roleLabel, tenancies) => {
  const item = document.createElement("li");
  item.className = "portal-item";

  const top = document.createElement("div");
  top.className = "portal-item-top";
  const title = document.createElement("p");
  title.className = "portal-item-title";
  const { line, place } = addressOf(property);
  title.textContent = property.unit_identifier ? `${line} (${property.unit_identifier})` : line;
  top.append(title);
  if (roleLabel) {
    const role = document.createElement("span");
    role.className = "portal-chip";
    role.textContent = roleLabel;
    top.append(role);
  }
  item.append(top);

  if (place) {
    const sub = document.createElement("p");
    sub.className = "portal-item-sub";
    sub.textContent = place;
    item.append(sub);
  }

  const tenancyLine = document.createElement("p");
  tenancyLine.className = "portal-item-meta";
  tenancyLine.textContent = tenancies.length
    ? tenancies.map(tenancyText).join(" · ")
    : "Ingen leieforhold";
  item.append(tenancyLine);
  return item;
};

const showEmpty = (title, text) => {
  $("[data-portal-empty-title]").textContent = title;
  $("[data-portal-empty-text]").textContent = text;
  $("[data-portal-empty]").hidden = false;
};

const done = () => {
  $("[data-portal-status]").hidden = true;
  root.setAttribute("aria-busy", "false");
};

const load = async (session) => {
  const user = session.user;
  const [profileRes, propertiesRes, propertyRolesRes, tenancyRolesRes, tenanciesRes, tasksRes] = await Promise.all([
    supabase.from("profiles").select("first_name, display_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("properties")
      .select("id, address_line1, address_line2, postal_code, city, unit_identifier")
      .eq("lifecycle_status", "active")
      .order("created_at", { ascending: false }),
    supabase.from("property_members").select("property_id, role").eq("user_id", user.id).is("valid_until", null),
    supabase.from("tenancy_members").select("tenancy_id, role").eq("user_id", user.id).is("valid_until", null),
    supabase
      .from("tenancies")
      .select("id, property_id, status, start_date, end_date")
      .in("status", VISIBLE_TENANCY_STATUSES)
      .is("archived_at", null)
      .order("start_date", { ascending: false }),
    supabase.from("maintenance_requests").select("id", { count: "exact", head: true }).in("status", OPEN_TASK_STATUSES),
  ]);

  const name = firstNameOf(profileRes.data, user);
  $("[data-portal-greeting]").textContent = name ? `Hei, ${name}` : "Hei!";

  const failed = [propertiesRes, propertyRolesRes, tenancyRolesRes, tenanciesRes, tasksRes].some((res) => res.error);
  const properties = propertiesRes.data ?? [];
  const tenancies = tenanciesRes.data ?? [];
  const propertyRoles = new Map((propertyRolesRes.data ?? []).map((row) => [row.property_id, row.role]));
  const tenantOf = new Set(
    (tenancyRolesRes.data ?? []).filter((row) => row.role === "tenant").map((row) => row.tenancy_id),
  );

  done();

  if (failed && !properties.length) {
    showEmpty(
      "Vi fikk ikke hentet oversikten",
      "Prøv å laste siden på nytt om litt. Alt er tilgjengelig i appen i mellomtiden.",
    );
    return;
  }

  $("[data-stat=properties]").textContent = String(properties.length);
  $("[data-stat=tenancies]").textContent = String(tenancies.filter((t) => t.status === "active").length);
  $("[data-stat=tasks]").textContent = tasksRes.error ? "–" : String(tasksRes.count ?? 0);
  $("[data-portal-stats]").hidden = false;

  if (!properties.length) {
    showEmpty(
      "Ingen boliger her ennå",
      "Når du legger til en bolig eller blir invitert til et leieforhold i appen, dukker det opp her.",
    );
    return;
  }

  const list = $("[data-portal-properties]");
  for (const property of properties) {
    const own = tenancies.filter((t) => t.property_id === property.id);
    const role = propertyRoles.get(property.id);
    const roleLabel =
      role === "owner" ? "Utleier" : role === "co_landlord" ? "Medutleier" : own.some((t) => tenantOf.has(t.id)) ? "Leietaker" : null;
    list.append(renderProperty(property, roleLabel, own));
  }
  $("[data-portal-list]").hidden = false;
};

if (root) {
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
        done();
        showEmpty(
          "Vi fikk ikke hentet oversikten",
          "Prøv å laste siden på nytt om litt. Alt er tilgjengelig i appen i mellomtiden.",
        );
      }
    }
  }
}
