// "Last ned mine data": readable PDF blocks from the privacy-export ZIP.
// Port of iOS PrivacyExportPDF.swift (PackageReader + PrivacyExportPDFText).
// The ZIP stores JSON uncompressed; only that form is accepted.
import { kronerText } from "./portal-annual.js";
import { unsupportedCharacters } from "./portal-letter.js";

export const FILE_NAME = "Enkel Utleie – mine data.pdf";
export const PDF_TITLE = "Enkel Utleie – mine data";

const invalid = () => new Error("invalid_response");
const u16 = (d, o) => d[o] | (d[o + 1] << 8);
const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const validPath = (p) =>
  p && p.length <= 180 && !p.startsWith("/") && !p.includes("\\") && !p.split("/").some((s) => s === "." || s === ".." || s === "");

/** PackageReader.entries: [{path, data: Uint8Array}] */
export function zipEntries(data) {
  if (!data?.length || data.length > 12_000_000) throw invalid();
  const min = 22;
  let eocd = -1;
  for (let c = data.length - min, stop = Math.max(0, data.length - min - 65535); c >= stop; c--) {
    if (u32(data, c) === 0x06054b50) { eocd = c; break; }
  }
  if (eocd < 0) throw invalid();
  const count = u16(data, eocd + 10);
  let pos = u32(data, eocd + 16);
  if (count <= 0 || count > 64 || pos >= data.length) throw invalid();
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  const entries = [];
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    if (pos + 46 > data.length || u32(data, pos) !== 0x02014b50) throw invalid();
    if (u16(data, pos + 8) & 1) throw invalid();
    const method = u16(data, pos + 10);
    const compressed = u32(data, pos + 20);
    const size = u32(data, pos + 24);
    const nameLen = u16(data, pos + 28);
    const extraLen = u16(data, pos + 30);
    const commentLen = u16(data, pos + 32);
    const local = u32(data, pos + 42);
    if (pos + 46 + nameLen > data.length) throw invalid();
    const path = utf8.decode(data.subarray(pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;
    if (method !== 0 || compressed !== size) throw invalid();
    if (local + 30 > data.length || u32(data, local) !== 0x04034b50) throw invalid();
    const start = local + 30 + u16(data, local + 26) + u16(data, local + 28);
    const end = start + size;
    if (end > data.length || size > 8_000_000) throw invalid();
    if (!validPath(path) || seen.has(path)) throw invalid();
    seen.add(path);
    entries.push({ path, data: data.subarray(start, end) });
  }
  return entries;
}

/* ---------- PrivacyExportPDFText ---------- */
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const sortedKeys = (o) => Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const AMOUNT_KEYS = ["rent_amount_minor", "deposit_amount_minor", "security_amount_minor"];
const isAmountKey = (k) => AMOUNT_KEYS.includes(k);
const isHidden = (k) => {
  if (k === "id" || k.endsWith("_id") || k.endsWith("_sha256")) return true;
  const l = k.toLowerCase();
  return ["storage", "queue", "package", "receipt", "token", "url", "path"].some((t) => l.includes(t));
};
const integer = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);

const LABELS = {
  account: "Konto", access: "Tilgang", profile: "Profil",
  display_name: "Visningsnavn", first_name: "Fornavn", last_name: "Etternavn",
  email: "E-post", phone: "Telefonnummer", phone_number: "Telefonnummer",
  preferred_locale: "Språk", active_mode: "Aktiv modus",
  created_at: "Opprettet", updated_at: "Oppdatert", state: "Status",
  deactivated_at: "Deaktivert", address_line1: "Adresse",
  address_line2: "Adresselinje 2", unit_identifier: "Enhet",
  postal_code: "Postnummer", city: "Poststed", country_code: "Land",
  property: "Bolig", tenancy: "Leieforhold", membership: "Medlemskap",
  unit: "Enhet", role: "Rolle", status: "Status",
  start_date: "Startdato", end_date: "Sluttdato",
  rent_amount_minor: "Husleie", deposit_amount_minor: "Depositum",
  security_amount_minor: "Sikkerhet", currency_code: "Valuta",
  payment_day: "Betalingsdag", valid_from: "Gyldig fra",
  valid_until: "Gyldig til", joined_at: "Ble med",
  property_memberships: "Boliger", tenancy_memberships: "Leieforhold",
  invitations: "Invitasjoner", agreements: "Kontrakter", title: "Tittel",
  terms: "Vilkår", inspections: "Inspeksjoner", items: "Punkter",
  area_code: "Område", note: "Notat", comments: "Kommentarer",
  body: "Tekst", conversations: "Samtaler", messages: "Meldinger",
  sent_at: "Sendt", sender_display_name_snapshot: "Avsender",
  sender_role_snapshot: "Rolle", properties: "Boliger",
  sections: "Seksjoner", section_key: "Seksjon", documents: "Dokumenter",
  original_file_name: "Filnavn", requests: "Forespørsler",
  kind: "Type", reason: "Grunn", explanation: "Forklaring",
  subject_role: "Rolle", is_enabled: "Aktiv", mime_type: "Filtype",
  change_requests: "Endringer", request_kind: "Type", response: "Svar",
  actor_role: "Rolle", sender_is_subject: "Egen melding",
  display_name_snapshot: "Navn", invitation_status: "Invitasjonsstatus",
};
const label = (k) => {
  if (LABELS[k]) return LABELS[k];
  const w = k.replace(/_/g, " ");
  return w ? w[0].toUpperCase() + w.slice(1) : k;
};
const DOMAINS = {
  account_profile: "Profil", relationships_invitations: "Leieforhold", contracts_documents: "Kontrakter",
  inspections: "Inn- og utflytting", chat: "Meldinger", property_handbook: "Husbok", maintenance: "Vedlikehold",
};
const domainTitle = (d) => DOMAINS[d] ?? label(d);

const kroner = (minor, currency) => {
  if (currency && currency !== "NOK") return `${kronerText(minor).replace(/\s*kr$/, "")}\u00a0${currency}`;
  return kronerText(minor);
};
const dateFmt = new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
const MAPPED = {
  "area_code:entrance": "gang", "area_code:kitchen": "kjøkken", "area_code:bathroom": "bad",
  "area_code:living_room": "stue", "area_code:bedroom": "soverom",
  "kind:note": "Notat", "kind:image": "Bilde", "kind:comment": "Kommentar",
  "reason:counterparty": "Annen part", "reason:unknown_author": "Ukjent forfatter", "status:active": "Aktiv",
};
const mapped = (k, v) => (v === "tenant" ? "Leietaker" : v === "landlord" ? "Utleier" : MAPPED[`${k}:${v}`] ?? null);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
function display(v, key) {
  if (typeof v === "boolean") return v ? "Ja" : "Nei";
  if (typeof v === "number") return isAmountKey(key) ? kroner(Math.trunc(v)) : String(v);
  if (typeof v !== "string") return "";
  const t = v.trim();
  if (!t) return "";
  if (t.length > 400 && !t.includes(" ")) return "Vedlegg er registrert.";
  if (key.endsWith("_at") && ISO.test(t) && !Number.isNaN(Date.parse(t))) return dateFmt.format(new Date(t));
  return mapped(key, t) ?? t;
}

function rows(value, key, indent) {
  if (value == null) return [];
  if (isObj(value)) {
    const currency = typeof value.currency_code === "string" ? value.currency_code : null;
    const children = [];
    for (const k of sortedKeys(value)) {
      const child = value[k];
      if (isHidden(k) || child == null) continue;
      if (isAmountKey(k) && integer(child) != null) {
        children.push({ indent, text: `${label(k)}: ${kroner(integer(child), currency)}`, bold: false });
        continue;
      }
      children.push(...rows(child, k, indent));
    }
    if (!children.length) return [];
    if (key == null) return children;
    return [{ indent, text: label(key), bold: true }, ...children.map((r) => ({ ...r, indent: r.indent + 1 }))];
  }
  if (Array.isArray(value)) {
    const out = [];
    value.forEach((item, i) => {
      const nested = rows(item, null, indent + 1);
      if (!nested.length) return;
      if (item != null && typeof item === "object") out.push({ indent, text: `${i + 1}.`, bold: true });
      out.push(...nested);
    });
    if (!out.length) return [];
    return key == null ? out : [{ indent, text: label(key), bold: true }, ...out];
  }
  const shown = display(value, key ?? "");
  if (!shown) return [];
  return [{ indent, text: key == null ? shown : `${label(key)}: ${shown}`, bold: false }];
}

function firstAddress(v) {
  if (isObj(v)) {
    if (typeof v.address_line1 === "string" && v.address_line1.trim()) {
      const locality = [v.postal_code, v.city].filter((s) => typeof s === "string" && s).join(" ");
      return [v.address_line1, locality].filter(Boolean).join(", ");
    }
    for (const k of sortedKeys(v)) { const f = firstAddress(v[k]); if (f) return f; }
  } else if (Array.isArray(v)) {
    for (const item of v) { const f = firstAddress(item); if (f) return f; }
  }
  return null;
}

function collectEconomy(value, address, facts) {
  if (Array.isArray(value)) { value.forEach((item) => collectEconomy(item, address, facts)); return; }
  if (!isObj(value)) return;
  const here = firstAddress(value) ?? address;
  const currency = typeof value.currency_code === "string" ? value.currency_code : null;
  const lines = [];
  for (const k of AMOUNT_KEYS) if (integer(value[k]) != null) lines.push(`${label(k)}: ${kroner(integer(value[k]), currency)}`);
  if (integer(value.payment_day) != null) lines.push(`${label("payment_day")}: ${integer(value.payment_day)}`);
  if (lines.length) facts.push({ address: here, lines });
  for (const k of sortedKeys(value)) {
    if (isAmountKey(k) || k === "payment_day" || value[k] == null) continue;
    collectEconomy(value[k], here, facts);
  }
}

/* ---------- PrivacyExportPDFDocument ---------- */
const json = (bytes) => { try { const v = JSON.parse(new TextDecoder().decode(bytes)); return isObj(v) ? v : null; } catch { return null; } };
const PREFERRED = ["Profil", "Leieforhold", "Kontrakter", "Økonomi", "Inn- og utflytting", "Meldinger", "Husbok", "Vedlikehold", "Utelatte opplysninger"];

export function exportSections(entries) {
  const manifest = json(entries.find((e) => e.path === "manifest.json")?.data ?? new Uint8Array());
  const order = (Array.isArray(manifest?.components) ? manifest.components : [])
    .filter(isObj)
    .sort((a, b) => (typeof a.stable_ordinal === "number" ? a.stable_ordinal : Infinity) - (typeof b.stable_ordinal === "number" ? b.stable_ordinal : Infinity))
    .map((c) => c.component_path)
    .filter((p) => typeof p === "string");
  const rank = (p) => { const i = order.indexOf(p); return i < 0 ? Infinity : i; };
  const files = entries
    .filter((e) => e.path.startsWith("data/") && e.path.endsWith(".json"))
    .sort((a, b) => rank(a.path) - rank(b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const components = [];
  for (const f of files) {
    const obj = json(f.data);
    if (!obj) throw invalid();
    const file = f.path.split("/").pop();
    const domain = typeof obj.domain_key === "string" ? obj.domain_key : file.includes(".v") ? file.slice(0, file.indexOf(".v")) : file;
    const payload = "data" in obj ? obj.data : obj;
    if (payload == null) continue;
    components.push({ domain, payload });
  }
  if (!components.length) throw invalid();
  const facts = [];
  components.forEach((c) => collectEconomy(c.payload, null, facts));
  const includeEconomy = facts.length > 0 || components.some((c) => ["relationships_invitations", "contracts_documents"].includes(c.domain));
  const sections = components.map((c) => ({ title: domainTitle(c.domain), rows: rows(c.payload, null, 0) }));
  if (includeEconomy) {
    const r = [];
    if (!facts.length) r.push({ indent: 0, text: "Ingen husleie eller depositum i eksporten.", bold: false });
    for (const f of facts) {
      if (f.address) r.push({ indent: 0, text: f.address, bold: true });
      f.lines.forEach((l) => r.push({ indent: f.address == null ? 0 : 1, text: l, bold: false }));
    }
    sections.push({ title: "Økonomi", rows: r });
  }
  const note = isObj(manifest?.omitted) && typeof manifest.omitted.explanation === "string" ? manifest.omitted.explanation : "";
  if (note) sections.push({ title: "Utelatte opplysninger", rows: [{ indent: 0, text: note, bold: false }] });
  const pr = (t) => { const i = PREFERRED.indexOf(t); return i < 0 ? PREFERRED.length : i; };
  return sections.sort((a, b) => pr(a.title) - pr(b.title) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
}

// The PDF fonts are WinAnsi; anything else (emoji etc.) is drawn as "?".
const drawable = (s) => {
  let out = String(s).replace(/\s*[\r\n]+\s*/g, " ");
  for (const ch of unsupportedCharacters(out)) out = out.split(ch).join("?");
  return out;
};

/** Blocks for letterPdf (Painter: title, intro, sections with indented rows). */
export function exportBlocks(entries) {
  const blocks = [
    { type: "title", text: "Mine data fra Enkel Utleie" },
    { type: "subtitle", text: "Dette er en kopi av personopplysningene i eksporten din." },
  ];
  for (const s of exportSections(entries)) {
    blocks.push({ type: "section", text: s.title });
    const r = s.rows.length ? s.rows : [{ indent: 0, text: "Ingen opplysninger i denne kategorien.", bold: false }];
    r.forEach((row) => blocks.push({ type: "item", text: drawable(row.text), indent: row.indent, bold: row.bold }));
  }
  return blocks;
}
