// Årsoppgave: port of iOS Features/Accounting (AnnualReportBuilder, AnnualReportPDF,
// FurnitureAnnualReport, AnnualReportOwnership). A documentation package with income,
// expenses, furniture, mileage and receipts for one property and year. All expenses count
// (no deductible split, as in the app). No tax is computed.
import { supabase } from "./supabase.js";
import * as inv from "./portal-inventory.js";

const FULL_BPS = 10000;
export const FURNITURE_NOTE = "Fradrag føres via saldo/direkte fradrag";
export const DIRECT_TREATMENT = "Direkte fradrag";
export const SUPPLEMENTS = "Noe av årsrapportgrunnlaget (kjørebok, eiendeler eller eierandel) kunne ikke lastes. Rapporten under kan være ufullstendig. Prøv å laste året på nytt.";

// AnnualReportController.defaultYear: January–April shows last year.
export function defaultYear(now = new Date()) {
  const [y, m] = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(now).split("-").map(Number);
  return m <= 4 ? y - 1 : y;
}
export const displayDate = (iso) => {
  const [y, m, d] = String(iso ?? "").slice(0, 10).split("-");
  return y && m && d ? `${d}.${m}.${y}` : "";
};
export const periodText = (year) => `01.01–31.12.${year}`;
export const receiptRef = (index) => `K-${String(index).padStart(2, "0")}`;
export const kronerText = (minor) => {
  const v = Number(minor) / 100;
  const whole = Number.isInteger(v);
  return `${new Intl.NumberFormat("nb-NO", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(v).replace(/\u2212/g, "-")} kr`;
};
export const kmText = (meters) => `${String(Math.round(Number(meters) / 100) / 10).replace(".", ",")} km`;
export const fileName = (year, address) => `Årsoppgave ${year} – ${String(address || "Bolig").replace(/[/:\\]/g, "-")}.pdf`;

// OwnershipShare.shareNearestKrone
export function shareNearestKrone(amountMinor, bps) {
  const points = Math.min(Math.max(Number(bps) || 0, 0), FULL_BPS);
  const product = BigInt(amountMinor) * BigInt(points);
  const negative = product < 0n;
  const magnitude = negative ? -product : product;
  const ore = ((magnitude + 500000n) / 1000000n) * 100n;
  return Number(negative ? -ore : ore);
}
export const percentText = (bps) => {
  const c = inv.clampRate(bps);
  return c % 100 === 0 ? `${c / 100} %` : `${Math.floor(c / 100)},${String(c % 100).padStart(2, "0")} %`;
};
const sharePercent = (bps) => {
  const v = Math.round(bps / 10) / 10;
  return `${String(v).replace(".", ",")} %`;
};

// AnnualReportOwnership.isSoleOwner for one property.
export function isSoleOwner(roster, viewerId) {
  const rows = roster ?? [];
  const others = rows.filter((r) => (viewerId ? r.user_id !== viewerId : !r.is_current_user));
  if (others.length) return false;
  const own = rows[0];
  if (own && own.stored_share_bps != null) return own.stored_share_bps >= FULL_BPS;
  return true;
}
export function viewerShareBps(roster, viewerId) {
  if (!roster?.length) return FULL_BPS;
  const row = roster.find((r) => (viewerId ? r.user_id === viewerId : r.is_current_user));
  return row ? Number(row.ownership_share_bps ?? 0) : 0;
}

// FurnitureAnnualReport.treatment
export function treatment(item, taxYear, electionsAll) {
  const rate = () => percentText(electionsAll[item.scope?.key ?? "private"]?.[taxYear]?.rate_bps ?? inv.GROUP_D_MAX_RATE_BPS);
  const d = inv.decision(item);
  if (d === "directCost" || d === "directLife" || d === "maintenance") return DIRECT_TREATMENT;
  if (d === "groupD") return rate();
  const year = inv.yearOf(item.purchaseDate) ?? taxYear;
  return item.lifeUnderThreeYears || item.purchaseAmountMinor < inv.thresholdMinor(year) ? DIRECT_TREATMENT : rate();
}

const furnitureLine = (row, item, sourceTransactionId, taxYear, electionsAll) => ({
  id: item.id, sourceTransactionId,
  name: item.name || "Møbler og inventar",
  purchaseAmountMinor: row?.countedPurchaseMinor ?? item.purchaseAmountMinor,
  treatment: treatment(item, taxYear, electionsAll),
  purchaseYear: row?.purchaseYear ?? inv.yearOf(item.purchaseDate) ?? taxYear,
  isDisposal: row?.isDisposal ?? false,
  openingMinor: row?.openingMinor ?? null,
  depreciationMinor: row?.depreciationMinor ?? null,
  closingMinor: row?.closingMinor ?? null,
  historicalPurchaseMinor: item.purchaseAmountMinor,
});
// FurnitureReportLine.sortAmount: «Kjøp/1.1.» value.
const startValue = (l) => (l.purchaseAmountMinor > 0 ? l.purchaseAmountMinor : l.openingMinor ?? l.historicalPurchaseMinor);
const sortFurniture = (lines) => lines.sort((a, b) => startValue(a) - startValue(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));

// Inventory rows for the year plus a synthesized line for each furniture expense without one.
export function furnitureLines(items, year, electionsAll, furnitureExpenses) {
  const { rows } = inv.yearView(items, year, electionsAll);
  const lines = items.filter((i) => rows[i.id]).map((i) => furnitureLine(rows[i.id], i, i.sourceTransactionId, year, electionsAll));
  const linked = new Set(items.map((i) => i.sourceTransactionId).filter(Boolean));
  for (const t of furnitureExpenses) {
    if (linked.has(t.id)) continue;
    const item = {
      id: t.id, propertyId: t.property_id, name: String(t.description ?? "").trim() || "Møbler og inventar", kind: "loose_inventory",
      purchaseDate: String(t.transaction_date).slice(0, 10), purchaseAmountMinor: Number(t.amount_minor), lifeUnderThreeYears: false,
      fixedTreatment: null, countsForTaxableRental: true, disposalDate: null, disposalProceedsMinor: null, disposalProceedsKnown: true, scope: inv.PRIVATE_SCOPE,
    };
    const y = inv.yearOf(item.purchaseDate) ?? year;
    lines.push(furnitureLine(inv.yearView([item], y, {}).rows[item.id], item, t.id, y, {}));
  }
  return sortFurniture(lines);
}
export const furnitureName = (l, year) => `${l.name}${l.purchaseYear !== year ? ` · kjøpt ${l.purchaseYear}` : ""}${l.isDisposal ? " · avhendet" : ""}`;

const isFurnishing = (t) => t.category === "furnishings_equipment" || t.legacy_category === "furnishings_equipment";

/**
 * AnnualReportBuilder.build for one property.
 * input: { year, transactions, trips, links, documents, items, elections, roster, viewerId,
 *          scope: "whole"|"mine", categoryTitle(row), landlordName, propertyTitle, tenantNames, generatedAt }
 */
export function buildReport(input) {
  const { year, viewerId } = input;
  const roster = input.roster ?? [];
  const sole = isSoleOwner(roster, viewerId);
  const scope = sole ? "whole" : input.scope === "mine" ? "mine" : "whole";
  const share = scope === "mine" ? viewerShareBps(roster, viewerId) : FULL_BPS;
  const scaled = (minor) => (scope === "mine" ? shareNearestKrone(Number(minor), share) : Number(minor));
  // AccountingLedger.lines: not voided, no financing costs (expected rent is not a stored row).
  const lines = (input.transactions ?? [])
    .filter((t) => !t.voided_at && t.category !== "financing_costs" && String(t.transaction_date).startsWith(String(year)))
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date) || String(a.created_at).localeCompare(String(b.created_at)) || (a.id < b.id ? -1 : 1));
  const trips = (input.trips ?? []).filter((t) => !t.voided_at)
    .sort((a, b) => a.trip_date.localeCompare(b.trip_date) || (a.id < b.id ? -1 : 1));
  const mileageIds = new Set(trips.map((t) => t.financial_transaction_id).filter(Boolean));
  const incomes = lines.filter((t) => t.transaction_type === "income");
  const posted = lines.filter((t) => t.transaction_type === "expense" && !mileageIds.has(t.id));
  const docs = new Map((input.documents ?? []).map((d) => [d.id, d]));
  const byTx = new Map();
  for (const l of input.links ?? []) (byTx.get(l.transaction_id) ?? byTx.set(l.transaction_id, []).get(l.transaction_id)).push(l.document_id);
  const describe = (t) => {
    let text = String(t.description ?? "").trim();
    const party = String(t.counterparty ?? "").trim();
    if (party) text = text ? `${text} – ${party}` : party;
    if (t.series_occurrence_date && t.transaction_date > t.series_occurrence_date) text = `${text} (avtalt ${displayDate(t.series_occurrence_date)} (forsinket))`.trim();
    return text;
  };
  let next = 1;
  const receipts = [];
  const refsOf = new Map();
  for (const t of posted) {
    const ids = [...(byTx.get(t.id) ?? [])].sort();
    const refs = ids.map((id) => {
      const ref = receiptRef(next++);
      const d = docs.get(id);
      const available = Boolean(d && d.status === "ready" && d.storage_path);
      receipts.push({ id, transactionId: t.id, ref, dateText: displayDate(t.transaction_date), description: describe(t), amountMinor: Number(t.amount_minor), document: available ? d : null, unavailable: !available });
      return ref;
    });
    if (refs.length) refsOf.set(t.id, refs.join(", "));
  }
  const furnitureExpenses = posted.filter((t) => isFurnishing(t));
  const furniture = furnitureLines(input.items ?? [], year, input.elections ?? {}, furnitureExpenses);
  const furnitureIds = new Set([...furniture.map((l) => l.sourceTransactionId).filter(Boolean), ...furnitureExpenses.map((t) => t.id)]);
  const expenseLines = posted.filter((t) => !furnitureIds.has(t.id));
  const shownExpenses = scope === "mine" ? expenseLines.filter((t) => !t.personal_for_user_id) : expenseLines;
  const shownTrips = scope === "mine" ? trips.filter((t) => (t.driver_user_id ?? t.created_by) === viewerId) : trips;
  const entry = (t) => ({
    id: t.id, date: t.transaction_date, dateText: displayDate(t.transaction_date), category: input.categoryTitle(t),
    description: describe(t), receiptRef: refsOf.get(t.id) ?? null, amountMinor: scaled(t.amount_minor),
  });
  const incomeEntries = incomes.map(entry);
  const expenseEntries = shownExpenses.map(entry);
  const incomeMinor = incomeEntries.reduce((a, e) => a + e.amountMinor, 0);
  const expenseMinor = expenseEntries.reduce((a, e) => a + e.amountMinor, 0);
  const drivingMeters = shownTrips.reduce((a, t) => a + Number(t.distance_meters), 0);
  return {
    year, scope, isSoleOwner: sole, shareBps: share,
    scopeTitle: sole ? "" : scope === "mine" ? `Min andel (${sharePercent(share)})` : "Hele boligen",
    landlordName: input.landlordName || "–", propertyTitle: input.propertyTitle || "–",
    periodText: periodText(year), tenantText: input.tenantNames?.length ? input.tenantNames.join(", ") : "–",
    generatedText: displayDate(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(input.generatedAt ?? new Date())),
    incomes: incomeEntries, expenses: expenseEntries, furniture, receipts,
    trips: shownTrips.map((t) => ({
      id: t.id, dateText: displayDate(t.trip_date), route: `${t.from_place} → ${t.to_place}`,
      purpose: [String(t.purpose ?? "").trim(), input.driverNames?.[t.driver_user_id ?? t.created_by] ?? ""].filter(Boolean).join(" · "),
      meters: Number(t.distance_meters),
    })),
    summary: { incomeMinor, expenseMinor, differenceMinor: incomeMinor - expenseMinor, drivingMeters },
    supplementsFailed: Boolean(input.supplementsFailed),
  };
}
export const isEmpty = (r) => !r.incomes.length && !r.expenses.length && !r.trips.length && !r.furniture.length;

// AnnualReportPDF layout as letter blocks (tables with sum rows).
export function reportBlocks(r) {
  const blocks = [
    { type: "title", text: `Årsoppgave ${r.year}` },
    { type: "subtitle", text: "Dokumentasjon av leieinntekter og utgifter" },
    { type: "infocard", rows: [["Utleier", r.landlordName, "Periode", r.periodText], ["Bolig", r.propertyTitle, "Leietaker", r.tenantText], ["Generert", r.generatedText]] },
  ];
  if (r.supplementsFailed) blocks.push({ type: "callout", title: "Kan være ufullstendig", body: SUPPLEMENTS });
  const right = "right";
  blocks.push({
    type: "table", title: "1  Inntekter",
    columns: [{ label: "Dato", w: 62 }, { label: "Kategori", w: 92 }, { label: "Beskrivelse", w: 0 }, { label: "Ref", w: 40 }, { label: "Beløp", w: 78, align: right }],
    rows: r.incomes.map((e) => [e.dateText, e.category, e.description, "", kronerText(e.amountMinor)]),
    sum: [`Sum inntekter ${r.year}`, kronerText(r.summary.incomeMinor)],
  });
  blocks.push({
    type: "table", title: "2  Utgifter", trailing: "Kvittering → vedlegg",
    columns: [{ label: "Dato", w: 62 }, { label: "Kategori", w: 92 }, { label: "Beskrivelse", w: 0 }, { label: "Kvittering", w: 58 }, { label: "Beløp", w: 78, align: right }],
    rows: r.expenses.map((e) => [e.dateText, e.category, e.description, e.receiptRef ?? "–", kronerText(e.amountMinor)]),
    sum: ["Sum utgifter", kronerText(r.summary.expenseMinor)],
  });
  let n = 3;
  if (r.furniture.length) {
    const dashOr = (v) => (v == null ? "—" : kronerText(v));
    blocks.push({
      type: "table", title: `${n++}  Møbler og inventar`, note: FURNITURE_NOTE,
      columns: [{ label: "Type møbel", w: 0 }, { label: "Kjøp/1.1.", w: 74, align: right }, { label: "Behandling", w: 84 }, { label: "I år", w: 70, align: right }, { label: "31.12.", w: 70, align: right }],
      rows: r.furniture.map((l) => [furnitureName(l, r.year), kronerText(startValue(l)), l.treatment, dashOr(l.depreciationMinor), dashOr(l.closingMinor)]),
    });
  }
  blocks.push({
    type: "table", title: `${n++}  Kjørebok`,
    columns: [{ label: "Dato", w: 62 }, { label: "Fra → til", w: 150 }, { label: "Formål", w: 0 }, { label: "Km", w: 60, align: right }],
    rows: r.trips.map((t) => [t.dateText, t.route, t.purpose, kmText(t.meters)]),
    sum: ["Sum kjøring", kmText(r.summary.drivingMeters)],
  });
  blocks.push({
    type: "table", title: `${n++}  Oppsummering`, trailing: r.scopeTitle,
    columns: [{ label: "", w: 0 }, { label: "", w: 110, align: right }],
    rows: [["Sum inntekter", kronerText(r.summary.incomeMinor)], ["Sum utgifter", kronerText(r.summary.expenseMinor)]],
    sum: ["Differanse inntekter minus utgifter", kronerText(r.summary.differenceMinor)],
  });
  blocks.push({
    type: "table", title: `${n++}  Vedlegg`,
    columns: [{ label: "Ref", w: 44 }, { label: "Dato", w: 62 }, { label: "Beskrivelse", w: 0 }, { label: "Side", w: 92 }, { label: "Beløp", w: 78, align: right }],
    rows: r.receipts.map((x) => [x.ref, x.dateText, x.description, x.unavailable ? "Kunne ikke hentes" : "Egen fil", kronerText(x.amountMinor)]),
  });
  return blocks;
}

/* ---------- Loading, as SupabaseAccountingYearRemote ---------- */
const paged = async (fn, params) => {
  const out = [];
  for (;;) {
    const { data, error } = await supabase.rpc(fn, { ...params, requested_offset: out.length, requested_page_size: 200 });
    if (error) return { error };
    if (!data?.length) return { data: out };
    out.push(...data);
  }
};
export const listTransactions = (pid, start, end) => paged("list_accounting_transactions", { requested_property_id: pid, requested_start_date: start, requested_end_date: end });
export const listLinks = (pid, start, end) => paged("list_accounting_document_links", { requested_property_id: pid, requested_start_date: start, requested_end_date: end });
export const ownershipShares = (pid, year) => supabase.rpc("list_property_ownership_shares", { requested_property_id: pid, requested_tax_year: year });
export const linkedDocuments = (ids) => supabase.from("documents").select("id, title, original_file_name, storage_path, mime_type, status").in("id", ids);
