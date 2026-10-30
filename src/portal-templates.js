// Landlord letter templates (LandlordDocumentTemplates.swift): fields for the form,
// validation, and the PDF blocks. Pure module; the PDF itself is portal-letter.js.
import { unsupportedCharacters } from "./portal-letter.js";

export const TEMPLATES = [
  { id: "reference", title: "Referanse", subtitle: "Vurdering av leietaker", icon: "person", fileName: "Referanse.pdf" },
  { id: "paymentReminder", title: "Betalingspåminnelse", subtitle: "Påminnelse om husleie", icon: "banknote", fileName: "Betalingspaaminnelse.pdf" },
  { id: "landlordTermination", title: "Oppsigelse fra utleier", subtitle: "Utkast, ikke juridisk råd", icon: "contract", fileName: "Oppsigelse-fra-utleier.pdf" },
  { id: "writtenWarning", title: "Skriftlig advarsel", subtitle: "Dokumentere brudd på leieavtalen", intro: "Her kan du sende en skriftlig advarsel til leietakeren ved brudd på leieavtalen eller husordensreglene. Fyll inn informasjonen under, så sendes dokumentet direkte i chatten.", icon: "info", fileName: "Skriftlig-advarsel.pdf" },
];
export const WARNING_REASONS = ["Støy og forstyrrelser", "Brudd på husordensregler", "Manglende vedlikehold", "Ulovlig fremleie", "Skade på boligen", "Annet"];
export const SIGNED = new Set(["reference", "landlordTermination", "writtenWarning"]);
const TEXT_MAX = 4000;
const NAME_MAX = 160;
const SIGN_MAX = 120;

const pad = (v) => String(v).padStart(2, "0");
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dotDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
};
export const leasePeriodText = (start, end) =>
  start && end ? `${dotDate(start)}–${dotDate(end)}` : start ? `Fra ${dotDate(start)}` : "";
// Last day of the month `months` after the notice month (husleieloven § 9-6, default 3).
export function suggestedEndDate(noticeISO, months = 3) {
  const m = /^(\d{4})-(\d{2})/.exec(noticeISO ?? "");
  if (!m) return "";
  return isoOf(new Date(Number(m[1]), Number(m[2]) - 1 + Number(months || 3) + 1, 0));
}
// Next rent due date from the payday (1–31) as of today.
export function nextDueDate(payday, today = new Date()) {
  const day = Number(payday);
  if (!day) return "";
  const at = (y, mo) => new Date(y, mo, Math.min(day, new Date(y, mo + 1, 0).getDate()));
  let d = at(today.getFullYear(), today.getMonth());
  if (isoOf(d) < isoOf(today)) d = at(today.getFullYear(), today.getMonth() + 1);
  return isoOf(d);
}
export function kronerText(raw) {
  const s = String(raw ?? "").replace(/kr/i, "").replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [int, dec] = s.split(".");
  const grouped = int.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return dec && Number(dec) ? `${grouped},${dec.padEnd(2, "0")} kr` : `${grouped} kr`;
}
const digits = (s) => String(s ?? "").replace(/[\s.]/g, "");

/**
 * auto: { tenants: [[value,label]], landlordName, landlordPhone, landlordEmail, today }
 * Prefilled values per tenant come in later through the form's onChange.
 */
export function templateFields(id, auto) {
  const tenant = { name: "tenant", label: "Leietaker", type: "choice", required: true, options: [["", "Velg leietaker"], ...auto.tenants], help: "Velg leietakeren. Navn, adresse og øvrige opplysninger fylles inn." };
  const t = (name, label, extra = {}) => ({ name, label, type: "text", maxLength: NAME_MAX, ...extra });
  const landlord = [
    t("landlordName", "Navn (utleier)", { value: auto.landlordName }),
    t("landlordPhone", "Telefon (utleier)", { value: auto.landlordPhone }),
    t("landlordEmail", "E-post (utleier)", { type: "email", value: auto.landlordEmail }),
  ];
  const signing = [
    t("place", "Sted", { maxLength: SIGN_MAX, placeholder: "Sted" }),
    { name: "date", label: "Dato", type: "date", value: auto.today },
    t("signatureName", "Navn (blokkbokstaver)", { required: true, maxLength: SIGN_MAX, placeholder: "Navn (blokkbokstaver)" }),
  ];
  const contact = [t("tenantAddress", "Adresse"), t("tenantEmail", "E-post", { type: "email" }), t("tenantPhone", "Telefon")];
  if (id === "reference") {
    return [tenant, t("tenantAddress", "Adresse"), t("leasePeriod", "Leieperiode"), ...landlord,
      { name: "assessment", label: "Vurdering", type: "textarea", rows: 6, required: true, maxLength: TEXT_MAX, placeholder: "Skriv din vurdering her...", help: "Her kan du skrive din vurdering av leietakeren. Eksempler: betalingsevne, forhold til husregler, vedlikehold, kommunikasjon, og generell oppførsel." }, ...signing];
  }
  if (id === "paymentReminder") {
    return [tenant, ...contact, t("propertyAddress", "Adresse på bolig"), t("leasePeriod", "Leieperiode"),
      { name: "dueDate", label: "Forfallsdato", type: "date", required: true },
      { name: "amount", label: "Beløp", type: "money", required: true, placeholder: "0 kr" },
      t("accountNumber", "Kontonummer", { required: true, placeholder: "11 siffer" }),
      t("kid", "KID (hvis relevant)"),
      { name: "note", label: "Merknad", type: "textarea", rows: 3, maxLength: TEXT_MAX, placeholder: "Valgfri merknad" }];
  }
  if (id === "landlordTermination") {
    return [tenant, ...contact, t("propertyAddress", "Adresse på bolig"), t("leasePeriod", "Leieperiode"),
      { name: "noticeDate", label: "Oppsigelse gitt", type: "date", required: true, value: auto.today },
      { name: "endDate", label: "Leieforholdet opphører", type: "date", required: true, help: "Foreslått ut fra oppsigelsestiden i kontrakten. Sjekk datoen før du sender." },
      { name: "reason", label: "Begrunnelse", type: "textarea", rows: 5, maxLength: TEXT_MAX, placeholder: "Skriv begrunnelse her ...", help: "Her kan du skrive årsaken til oppsigelsen." }, ...signing];
  }
  return [tenant, t("tenantAddress", "Adresse"), ...landlord,
    { name: "warningReason", label: "Årsak til advarsel", type: "choice", required: true, options: [["", "Velg årsak"], ...WARNING_REASONS.map((r) => [r, r])] },
    { name: "description", label: "Beskrivelse", type: "textarea", rows: 5, required: true, maxLength: TEXT_MAX, placeholder: "Skriv beskrivelsen her..." },
    { name: "correction", label: "Hva må rettes opp?", type: "textarea", rows: 3, maxLength: TEXT_MAX, placeholder: "Skriv hva som må rettes opp her..." },
    { name: "deadline", label: "Frist for retting", type: "date" }, ...signing];
}

const SUBTITLE = { reference: "Vurdering av leietaker", writtenWarning: "Brudd på leieavtalen eller husordensreglene" };
export const DISCLAIMER = "Dette er en mal og ikke juridisk rådgivning. Vi anbefaler å sette deg inn i husleieloven eller kontakte juridisk bistand ved behov.";
export const letterTitle = (id) => (id === "landlordTermination" ? "Oppsigelse av leieforhold" : TEMPLATES.find((x) => x.id === id).title);

export function templateBlocks(id, v, strokes) {
  const b = [{ type: "title", text: letterTitle(id) }];
  if (SUBTITLE[id]) b.push({ type: "subtitle", text: SUBTITLE[id] });
  const sec = (text) => b.push({ type: "section", text });
  const row = (label, value) => b.push({ type: "row", label, value });
  const signature = () => b.push({ type: "signature", place: v.place, date: dotDate(v.date), name: v.signatureName, strokes });
  const landlord = () => { sec("Utleier"); row("Navn", v.landlordName); row("Telefon", v.landlordPhone); row("E-post", v.landlordEmail); };
  if (id === "reference") {
    sec("Leietaker"); row("Navn", v.tenantName); row("Adresse", v.tenantAddress); row("Leieperiode", v.leasePeriod);
    landlord();
    sec("Vurdering"); b.push({ type: "paragraph", text: v.assessment });
    signature();
  } else if (id === "paymentReminder") {
    sec("Leietaker"); row("Navn", v.tenantName); row("Adresse", v.tenantAddress); row("E-post", v.tenantEmail); row("Telefon", v.tenantPhone);
    sec("Leieforhold"); row("Adresse på bolig", v.propertyAddress); row("Leieperiode", v.leasePeriod); row("Forfallsdato", dotDate(v.dueDate));
    b.push({ type: "callout", title: "Vi har ikke mottatt betaling for husleie", body: `Vennligst betal utestående beløp innen ${dotDate(v.dueDate) || "–"} for å unngå videre oppfølging.` });
    sec("Betalingsinformasjon"); row("Kontonummer", v.accountNumber); row("KID (hvis relevant)", v.kid); row("Utestående beløp", kronerText(v.amount) ?? v.amount);
    if (v.note) { sec("Merknad"); b.push({ type: "paragraph", text: v.note }); }
  } else if (id === "landlordTermination") {
    sec("Leietaker"); row("Navn", v.tenantName); row("Adresse", v.tenantAddress); row("E-post", v.tenantEmail); row("Telefon", v.tenantPhone);
    sec("Leieforhold"); row("Adresse på bolig", v.propertyAddress); row("Leieperiode", v.leasePeriod); row("Oppsigelsesdato", dotDate(v.noticeDate)); row("Fraflyttingsdato", dotDate(v.endDate));
    sec("Begrunnelse"); b.push({ type: "paragraph", text: v.reason });
    signature();
  } else {
    sec("Leietaker"); row("Navn", v.tenantName); row("Adresse", v.tenantAddress);
    landlord();
    sec("Årsak til advarsel"); row("Årsak", v.warningReason);
    sec("Beskrivelse"); b.push({ type: "paragraph", text: v.description });
    if (v.correction || v.deadline) {
      sec("Hva må rettes opp?");
      if (v.correction) b.push({ type: "paragraph", text: v.correction });
      if (v.deadline) row("Frist for retting", dotDate(v.deadline));
    }
    signature();
  }
  return b;
}

// Returns a message for the first problem, or null (LandlordDocumentTemplateDraft.issues).
export function templateIssue(id, v, strokes, confirmedEmails = []) {
  if (!v.tenantName?.trim() || v.tenantName.includes("@")) return "Velg leietaker.";
  if ([...Object.values(v)].some((x) => typeof x === "string" && x.length > TEXT_MAX)) return "Teksten kan være på opptil 4 000 tegn.";
  if (id === "paymentReminder") {
    if (!/^\d{11}$/.test(digits(v.accountNumber))) return "Kontonummeret må ha 11 siffer.";
    if (!kronerText(v.amount) || kronerText(v.amount) === "0 kr") return "Fyll inn beløpet.";
    if (!v.dueDate) return "Fyll inn forfallsdato.";
  }
  if (id === "landlordTermination" && v.noticeDate && v.endDate && v.endDate < v.noticeDate) return "Datoen leieforholdet opphører kan ikke være før oppsigelsen.";
  if (id === "writtenWarning" && (!v.warningReason || !v.description?.trim())) return "Fyll inn det som mangler i dokumentet.";
  if (id === "writtenWarning" && v.deadline && v.date && v.deadline < v.date) return "Fyll inn det som mangler i dokumentet.";
  if (id === "reference" && !v.assessment?.trim()) return "Fyll inn det som mangler i dokumentet.";
  if (SIGNED.has(id) && (!v.signatureName?.trim() || !strokes.some((s) => Array.isArray(s) && s.length))) return "Skriv navnet ditt og signer før du sender.";
  if (["paymentReminder", "landlordTermination"].includes(id) && v.tenantEmail &&
    !confirmedEmails.includes(v.tenantEmail.trim().toLowerCase())) return "E-posten må tilhøre en godkjent leietaker i dette leieforholdet.";
  const bad = unsupportedCharacters(Object.values(v).filter((x) => typeof x === "string").join(" "));
  if (bad.length) return `PDF-en kan ikke tegne noen av disse tegnene. Fjern dem før du sender. (${bad.join(" ")})`;
  return null;
}
