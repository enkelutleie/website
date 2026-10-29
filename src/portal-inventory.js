// Møbler og inventar: port of iOS Features/Assets (AssetController, InventorySaldo,
// InventoryYearRow, InventoryItemAllocations). The saldo is computed on the client, as in
// the app; the server stores the items (property_assets) and the yearly rate elections.
import { supabase } from "./supabase.js";

export const GROUP_D_MAX_RATE_BPS = 2000;
export const thresholdMinor = (taxYear) => (taxYear >= 2024 ? 3_000_000 : 1_500_000);
export const clampRate = (bps) => Math.min(Math.max(Number(bps) || 0, 0), GROUP_D_MAX_RATE_BPS);
export const yearOf = (date) => {
  const y = Number(String(date ?? "").slice(0, 4));
  return Number.isInteger(y) && y > 1900 ? y : null;
};

export const DECISION_TEXT = {
  directCost: "Direkte fradrag i år. Prisen er under 30 000 kr.",
  directLife: "Direkte fradrag i år. Levetiden er under tre år.",
  groupD: "Legges i den felles potten. Prisen er 30 000 kr eller mer, og det ventes å vare minst tre år.",
  maintenance: "Fast innredning avskrives ikke. Samme standard kan trekkes fra som vedlikehold når utleien er skattepliktig.",
  improvement: "Fast innredning avskrives ikke. Høyere standard er påkostning og trekkes ikke fra i årets utleie.",
  taxFree: "Ikke fradrag. Fradrag gis bare når utleien er skattepliktig.",
};
export const BADGE = {
  directCost: ["Direkte fradrag", "is-success"], directLife: ["Direkte fradrag", "is-success"],
  groupD: ["Avskrivning", "is-warning"], maintenance: ["Vedlikehold", ""], improvement: ["Påkostning", ""], taxFree: ["Ikke skattepliktig", ""],
};

export const classification = (priceMinor, purchaseYear, lastsAtLeastThreeYears) => {
  if (!lastsAtLeastThreeYears) return "directLife";
  return priceMinor < thresholdMinor(purchaseYear) ? "directCost" : "groupD";
};

// PropertyAsset.decoded + inventoryInput: legacy rows without item_kind / life fall back like iOS.
export function itemInput(asset, propertyName, scope) {
  const kind = asset.item_kind || (asset.category === "improvement" ? "fixed_fitting" : "loose_inventory");
  const life = asset.life_under_three_years ?? (asset.useful_life_years != null ? asset.useful_life_years < 3 : false);
  const treatment = kind === "fixed_fitting" ? asset.fixed_treatment || "improvement" : null;
  const disposalDate = asset.disposal_date || (asset.disposed_at ? osloDate(asset.disposed_at) : null);
  return {
    id: asset.id, propertyId: asset.property_id, propertyName: propertyName ?? "", name: asset.name, kind,
    purchaseDate: asset.purchase_date, purchaseAmountMinor: Number(asset.purchase_amount_minor),
    lifeUnderThreeYears: Boolean(life), fixedTreatment: treatment,
    countsForTaxableRental: asset.counts_for_taxable_rental ?? true,
    disposalDate, disposalProceedsMinor: asset.disposal_proceeds_minor == null ? null : Number(asset.disposal_proceeds_minor),
    disposalProceedsKnown: !disposalDate || asset.disposal_proceeds_minor != null,
    scope: scope ?? PRIVATE_SCOPE, notes: asset.notes ?? "", sourceTransactionId: asset.source_transaction_id ?? null,
  };
}
const osloDate = (ts) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date(ts));

export function decision(item) {
  if (!item.countsForTaxableRental) return "taxFree";
  if (item.kind === "fixed_fitting") return item.fixedTreatment === "maintenance" ? "maintenance" : "improvement";
  const y = yearOf(item.purchaseDate);
  if (y == null) return item.lifeUnderThreeYears ? "directLife" : "directCost";
  return classification(item.purchaseAmountMinor, y, !item.lifeUnderThreeYears);
}

// InventorySaldoScope: private rental is one combined saldo; business is per municipality.
export const PRIVATE_SCOPE = { key: "private", title: "", municipalityNumber: null };
export function scopeFor(mode, property) {
  if (mode !== "bookkeeping_business") return PRIVATE_SCOPE;
  const number = property?.municipality_number;
  if (!number) {
    const label = propertyLabel(property);
    return { key: `business:property:${String(property?.id ?? "").toLowerCase()}`, title: label ? `Næring · kommune mangler · ${label}` : "Næring · kommune mangler", municipalityNumber: null };
  }
  return { key: `business:${String(number).toLowerCase()}`, title: `Næring · ${property.municipality_name || number}`, municipalityNumber: number };
}
const propertyLabel = (p) => [p?.address_line1, p?.unit_identifier].filter(Boolean).join(" ");
export const scopeNeedsMunicipality = (scope) => scope.key !== "private" && !scope.municipalityNumber;

const depreciation = (basis, rate) => (basis > 0 && rate > 0 ? Math.floor((basis * rate) / 10000) : 0);
const minimumIncome = (magnitude, rate) => (magnitude > 0 && rate > 0 ? Math.min(magnitude, Math.floor((magnitude * rate + 9999) / 10000)) : 0);

function yearRow(items, taxYear, opening, election) {
  const rate = clampRate(election?.rate_bps ?? GROUP_D_MAX_RATE_BPS);
  const takeRemainder = election?.take_remainder ?? false;
  let additions = 0, proceeds = 0, missingProceeds = false, direct = 0, maintenance = 0, directSale = 0;
  for (const item of items) {
    const d = decision(item);
    const py = yearOf(item.purchaseDate);
    const dy = item.disposalDate ? yearOf(item.disposalDate) : null;
    if (d === "groupD" && py === taxYear) additions += item.purchaseAmountMinor;
    if (d === "groupD" && dy === taxYear) {
      if (item.disposalProceedsKnown) proceeds += item.disposalProceedsMinor ?? 0;
      else missingProceeds = true;
    }
    if (py === taxYear) {
      if (d === "directCost" || d === "directLife") direct += item.purchaseAmountMinor;
      else if (d === "maintenance") maintenance += item.purchaseAmountMinor;
    }
    if (dy === taxYear && (d === "directCost" || d === "directLife") && item.disposalProceedsKnown) directSale += item.disposalProceedsMinor ?? 0;
  }
  const basis = opening + additions - proceeds;
  const threshold = thresholdMinor(taxYear);
  let dep = 0, income = 0, canTakeRemainder = false, negative = false;
  if (basis < 0) {
    negative = true;
    income = -basis < threshold ? -basis : minimumIncome(-basis, GROUP_D_MAX_RATE_BPS);
  } else if (basis > 0 && basis < threshold) {
    canTakeRemainder = true;
    dep = takeRemainder ? basis : depreciation(basis, rate);
  } else {
    dep = depreciation(basis, rate);
  }
  return {
    taxYear, openingMinor: opening, additionsMinor: additions, proceedsMinor: proceeds, basisMinor: basis,
    depreciationMinor: dep, incomeRecognitionMinor: income, closingMinor: basis - dep + income,
    directDeductionMinor: direct, maintenanceDeductionMinor: maintenance, directSaleIncomeMinor: directSale,
    canTakeRemainder, negativeBalanceIsIncome: negative, missingProceeds, rateBps: rate,
  };
}

// elections: { [taxYear]: {rate_bps, take_remainder} } for one scope.
export function history(items, toYear, elections, fromYear = null) {
  if (fromYear != null && fromYear > toYear) return [];
  const groupYears = items.filter((i) => decision(i) === "groupD").map((i) => yearOf(i.purchaseDate)).filter((y) => y != null);
  const first = groupYears.length ? Math.min(...groupYears) : toYear;
  const start = Math.min(first, fromYear ?? toYear, toYear);
  let closing = 0;
  const rows = [];
  for (let y = start; y <= toYear; y++) {
    const row = yearRow(items, y, closing, elections[y]);
    closing = row.closingMinor;
    if (y >= (fromYear ?? start)) rows.push(row);
  }
  return rows;
}
export const statement = (items, taxYear, elections) => history(items, taxYear, elections).at(-1) ?? yearRow(items, taxYear, 0, elections[taxYear]);
export const taxEffectMinor = (s) => s.directDeductionMinor + s.maintenanceDeductionMinor + s.depreciationMinor - s.incomeRecognitionMinor - s.directSaleIncomeMinor;

function split(total, weights) {
  const sorted = weights.filter((w) => w.amount > 0).sort((a, b) => (a.amount === b.amount ? (a.id < b.id ? -1 : 1) : b.amount - a.amount));
  const sum = sorted.reduce((a, w) => a + w.amount, 0);
  const shares = {};
  if (!(total > 0) || !(sum > 0)) return shares;
  let allocated = 0;
  for (const w of sorted) {
    const share = Number((BigInt(total) * BigInt(w.amount)) / BigInt(sum));
    shares[w.id] = share;
    allocated += share;
  }
  shares[sorted[0].id] += total - allocated;
  return shares;
}

// InventoryItemAllocations.allocate: the group saldo split back onto each item.
export function allocate(items, rows) {
  const group = items.filter((i) => decision(i) === "groupD");
  let closing = {};
  let result = {};
  for (const row of rows) {
    if (row.missingProceeds) return {};
    const active = group.filter((i) => {
      const py = yearOf(i.purchaseDate);
      if (py == null || py > row.taxYear) return false;
      const dy = i.disposalDate ? yearOf(i.disposalDate) : null;
      return dy == null || dy > row.taxYear;
    });
    const carried = Object.fromEntries(active.map((i) => [i.id, closing[i.id] ?? 0]));
    let weights = active.map((i) => ({ id: i.id, amount: carried[i.id] + (yearOf(i.purchaseDate) === row.taxYear ? i.purchaseAmountMinor : 0) }));
    if (weights.every((w) => w.amount === 0)) weights = active.map((i) => ({ id: i.id, amount: i.purchaseAmountMinor }));
    const basis = split(Math.max(0, row.basisMinor), weights);
    const dep = split(row.depreciationMinor, weights.map((w) => ({ id: w.id, amount: basis[w.id] ?? 0 })));
    result = {};
    closing = {};
    for (const i of active) {
      const share = basis[i.id] ?? 0;
      const d = dep[i.id] ?? 0;
      closing[i.id] = share - d;
      if (!row.negativeBalanceIsIncome) {
        result[i.id] = { openingMinor: carried[i.id], basisMinor: share, depreciationMinor: d, closingMinor: share - d, rateBps: row.rateBps, takesRemainder: row.canTakeRemainder && row.closingMinor === 0 };
      }
    }
  }
  return result;
}

// InventoryYearRow.make: whether (and how) an item shows in a year.
function makeRow(item, alloc, year, rate, carriedOpening, uncertain) {
  const py = yearOf(item.purchaseDate);
  if (py == null || py > year) return null;
  const dy = item.disposalDate ? yearOf(item.disposalDate) : null;
  if (dy != null && dy < year) return null;
  const d = decision(item);
  const isPurchase = py === year;
  const isDisposal = dy === year;
  const row = (purchase, counted, opening, dep, closing, rateBps, takesRemainder) =>
    ({ id: item.id, purchaseYear: py, isPurchase: purchase, isDisposal, countedPurchaseMinor: counted, openingMinor: opening, depreciationMinor: dep, closingMinor: closing, rateBps, takesRemainder });
  if (d === "directCost" || d === "directLife" || d === "maintenance") return isPurchase ? row(true, item.purchaseAmountMinor, null, item.purchaseAmountMinor, 0, 0, false) : null;
  if (d === "improvement" || d === "taxFree") return isPurchase ? row(true, item.purchaseAmountMinor, null, null, null, rate, false) : null;
  if (uncertain) return row(isPurchase, isPurchase ? item.purchaseAmountMinor : 0, null, null, null, rate, false);
  if (alloc) {
    if (!(alloc.basisMinor > 0 || alloc.depreciationMinor > 0) && !isDisposal) return null;
    return row(isPurchase, isPurchase ? item.purchaseAmountMinor : 0, isPurchase ? null : alloc.openingMinor, alloc.depreciationMinor, alloc.closingMinor, alloc.rateBps, alloc.takesRemainder);
  }
  if (!isDisposal) return null;
  return row(isPurchase, isPurchase ? item.purchaseAmountMinor : 0, isPurchase ? null : carriedOpening ?? null, null, 0, rate, false);
}

const groupByScope = (items) => {
  const map = new Map();
  for (const i of items) {
    if (!map.has(i.scope.key)) map.set(i.scope.key, { scope: i.scope, items: [] });
    map.get(i.scope.key).items.push(i);
  }
  return map;
};
// electionsAll: { [scopeKey]: { [year]: election } }
export function yearView(items, year, electionsAll) {
  const rows = {};
  const allocations = {};
  const outlooks = [];
  const groups = groupByScope(items);
  if (!groups.size) groups.set("private", { scope: PRIVATE_SCOPE, items: [] });
  const keys = [...groups.keys()].sort((a, b) => (a === "private" ? -1 : b === "private" ? 1 : a < b ? -1 : 1));
  for (const key of keys) {
    const { scope, items: subset } = groups.get(key);
    const el = electionsAll[key] ?? {};
    const hist = history(subset, year, el);
    const alloc = allocate(subset, hist);
    Object.assign(allocations, alloc);
    const uncertain = hist.some((r) => r.missingProceeds);
    const needsOpening = !uncertain && subset.some((i) => decision(i) === "groupD" && i.disposalDate && yearOf(i.disposalDate) === year && !alloc[i.id]);
    const previous = needsOpening ? allocate(subset, history(subset, year - 1, el)) : {};
    const rate = el[year]?.rate_bps ?? GROUP_D_MAX_RATE_BPS;
    for (const i of subset) {
      const r = makeRow(i, alloc[i.id], year, rate, previous[i.id]?.closingMinor, uncertain && decision(i) === "groupD");
      if (r) rows[i.id] = r;
    }
    outlooks.push({ scope, statement: hist.at(-1) ?? yearRow(subset, year, 0, el[year]), election: el[year] ?? null });
  }
  return { rows, allocations, outlooks };
}

// RPCs, exactly as SupabaseAssetRemote.
export async function listAssets(propertyId) {
  const out = [];
  for (;;) {
    const { data, error } = await supabase.rpc("list_property_assets", { requested_property_id: propertyId, requested_offset: out.length, requested_page_size: 200 });
    if (error) return { error };
    if (!data?.length) return { data: out };
    out.push(...data);
  }
}
export const listElections = () => supabase.rpc("list_inventory_saldo_elections");
export const saveElection = (taxYear, rateBps, takeRemainder, scopeKey) =>
  supabase.rpc("upsert_inventory_saldo_election", { requested_tax_year: taxYear, requested_rate_bps: clampRate(rateBps), requested_take_remainder: takeRemainder, requested_scope_key: scopeKey });
export const accountingMode = (propertyId) => supabase.rpc("get_property_economy_accounting_mode", { requested_property_id: propertyId });
export const homeUse = async (propertyId) => {
  const { data, error } = await supabase.rpc("list_managed_property_rental_tax_facts", { requested_property_ids: [propertyId] });
  if (error) return null;
  return (data ?? []).find((r) => r.property_id === propertyId)?.home_use ?? null;
};
// AssetLedger.legacyCategory
const legacyCategory = (kind, treatment) => (kind === "loose_inventory" ? "furnishings" : treatment === "maintenance" ? "other" : "improvement");
export function createAsset(propertyId, v, clientRequestId) {
  const treatment = v.kind === "fixed_fitting" ? v.fixedTreatment || "maintenance" : null;
  return supabase.rpc("create_property_asset", {
    requested_property_id: propertyId, requested_name: v.name.trim(), requested_category: legacyCategory(v.kind, treatment),
    requested_purchase_date: v.purchaseDate, requested_purchase_amount_minor: v.amountMinor,
    requested_useful_life_years: v.lifeUnderThreeYears ? 1 : null, requested_notes: v.notes?.trim() || null,
    requested_client_request_id: clientRequestId, requested_item_kind: v.kind, requested_life_under_three_years: v.lifeUnderThreeYears,
    requested_fixed_treatment: treatment, requested_counts_for_taxable_rental: v.countsForTaxableRental,
  });
}
export function updateAsset(assetId, v) {
  const treatment = v.kind === "fixed_fitting" ? v.fixedTreatment || "maintenance" : null;
  return supabase.rpc("update_property_asset", {
    requested_asset_id: assetId, requested_name: v.name.trim(), requested_purchase_date: v.purchaseDate,
    requested_purchase_amount_minor: v.amountMinor, requested_notes: v.notes?.trim() || null, requested_item_kind: v.kind,
    requested_life_under_three_years: v.lifeUnderThreeYears, requested_fixed_treatment: treatment,
    requested_counts_for_taxable_rental: v.countsForTaxableRental,
  });
}
export const disposeAsset = (assetId, date, proceedsMinor) =>
  supabase.rpc("dispose_property_asset", { requested_asset_id: assetId, requested_disposal_date: date, requested_proceeds_minor: proceedsMinor });
