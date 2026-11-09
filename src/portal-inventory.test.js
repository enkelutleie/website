import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildReport, furnitureLines, furnitureName, reportBlocks } from "./portal-annual.js";
import {
  PRIVATE_SCOPE, history, itemInput, statement, taxEffectMinor, yearView,
} from "./portal-inventory.js";

// 50 000 kr and 10 000 kr. Group D from 2024 is 30 000 kr.
const GROUP = 5_000_000;
const DIRECT = 1_000_000;

const item = (over) => ({
  propertyId: "p1", propertyName: "Testveien 1", kind: "loose_inventory", lifeUnderThreeYears: false,
  fixedTreatment: null, countsForTaxableRental: true, disposalDate: null, disposalProceedsMinor: null,
  disposalProceedsKnown: true, scope: PRIVATE_SCOPE, notes: "", sourceTransactionId: null, ...over,
});

// Sofa bought in 2024 and "disposed" in 2025, a 2025 purchase that is also marked disposed,
// and a direct-deduction lamp sold the same year. None of the disposal fields may change the saldo.
const sofa = item({
  id: "sofa", name: "Sofa", purchaseDate: "2024-03-01", purchaseAmountMinor: GROUP,
  disposalDate: "2025-06-15", disposalProceedsMinor: 1_000_000, disposalProceedsKnown: true,
});
const table = item({
  id: "table", name: "Bord", purchaseDate: "2025-04-01", purchaseAmountMinor: GROUP,
  disposalDate: "2025-11-01", disposalProceedsMinor: 500_000, disposalProceedsKnown: true,
});
const lamp = item({
  id: "lamp", name: "Lampe", purchaseDate: "2025-02-01", purchaseAmountMinor: DIRECT,
  disposalDate: "2025-09-01", disposalProceedsMinor: 400_000, disposalProceedsKnown: true,
});
const items = [sofa, table, lamp];

test("saldo, year rows and the annual report ignore disposal proceeds", () => {
  const rows = history(items, 2026, {});
  for (const row of rows) {
    assert.equal(row.basisMinor, row.openingMinor + row.additionsMinor, String(row.taxYear));
    assert.equal(row.proceedsMinor, 0, String(row.taxYear));
    assert.equal(row.directSaleIncomeMinor, 0, String(row.taxYear));
    assert.equal(row.missingProceeds, false, String(row.taxYear));
  }
  const y2024 = rows.find((r) => r.taxYear === 2024);
  const y2025 = rows.find((r) => r.taxYear === 2025);
  const y2026 = rows.find((r) => r.taxYear === 2026);
  assert.equal(y2024.openingMinor, 0);
  assert.equal(y2024.additionsMinor, GROUP);
  assert.equal(y2024.basisMinor, GROUP);
  assert.equal(y2024.depreciationMinor, 1_000_000);
  assert.equal(y2024.closingMinor, 4_000_000);
  assert.equal(y2025.openingMinor, y2024.closingMinor);
  assert.equal(y2025.additionsMinor, GROUP);
  assert.equal(y2025.basisMinor, 9_000_000);
  assert.equal(y2025.directDeductionMinor, DIRECT);
  assert.equal(y2025.depreciationMinor, 1_800_000);
  assert.equal(y2025.incomeRecognitionMinor, 0);
  assert.equal(y2025.closingMinor, 7_200_000);
  assert.equal(taxEffectMinor(y2025), DIRECT + 1_800_000);
  assert.equal(y2026.openingMinor, y2025.closingMinor);
  assert.equal(y2026.additionsMinor, 0);
  assert.equal(y2026.basisMinor, 7_200_000);

  const unknown = item({
    id: "sofa", name: "Sofa", purchaseDate: "2024-03-01", purchaseAmountMinor: GROUP,
    disposalDate: "2025-06-15", disposalProceedsMinor: null, disposalProceedsKnown: false,
  });
  const open = statement([unknown], 2025, {});
  assert.equal(open.missingProceeds, false);
  assert.equal(open.basisMinor, open.openingMinor + open.additionsMinor);
  assert.equal(open.basisMinor, 4_000_000);
  assert.equal(open.proceedsMinor, 0);
  assert.equal(open.directSaleIncomeMinor, 0);

  const view = yearView(items, 2026, {});
  assert.equal(view.rows.sofa.isDisposal, false);
  assert.equal(view.rows.table.isDisposal, false);
  assert.equal(view.rows.sofa.depreciationMinor, 640_000);
  assert.equal(view.rows.sofa.closingMinor, 2_560_000);
  assert.equal(view.rows.table.depreciationMinor, 800_000);
  assert.equal(view.rows.lamp, undefined);

  const lines = furnitureLines(items, 2025, {}, []);
  assert.deepEqual(lines.map((l) => furnitureName(l, 2025)), ["Lampe", "Sofa · kjøpt 2024", "Bord"]);
  assert.equal(lines.every((l) => l.isDisposal === false), true);
  const sofaLine = lines.find((l) => l.id === "sofa");
  assert.equal(sofaLine.openingMinor, 4_000_000);
  assert.equal(sofaLine.depreciationMinor, 800_000);
  assert.equal(sofaLine.closingMinor, 3_200_000);

  const report = buildReport({
    year: 2025, transactions: [], trips: [], links: [], documents: [], items, elections: {},
    categoryTitle: () => "", landlordName: "Kari", propertyTitle: "Testveien 1", tenantNames: [],
    generatedAt: new Date("2026-02-01T12:00:00Z"),
  });
  assert.equal(report.summary.incomeMinor, 0);
  const block = reportBlocks(report).find((b) => String(b.title).includes("Møbler"));
  assert.deepEqual(block.rows.map((r) => r[0]), ["Lampe", "Sofa · kjøpt 2024", "Bord"]);
  assert.equal(JSON.stringify(block).includes("avhendet"), false);
});

test("decoding keeps disposal fields and still shows the row as active furniture", () => {
  const decoded = itemInput({
    id: "sofa", property_id: "p1", name: "Sofa", item_kind: "loose_inventory",
    purchase_date: "2024-03-01", purchase_amount_minor: "5000000", life_under_three_years: false,
    counts_for_taxable_rental: true, disposal_date: "2025-06-15", disposal_proceeds_minor: "1000000",
    disposed_at: "2025-06-15T22:30:00Z", notes: null,
  }, "Testveien 1", PRIVATE_SCOPE);
  assert.equal(decoded.name, "Sofa");
  assert.equal(decoded.purchaseAmountMinor, GROUP);
  assert.equal(decoded.disposalDate, "2025-06-15");
  assert.equal(decoded.disposalProceedsMinor, 1_000_000);
  assert.equal(decoded.disposalProceedsKnown, true);

  const onlyStamp = itemInput({
    id: "chair", property_id: "p1", name: "Stol", item_kind: "loose_inventory",
    purchase_date: "2024-05-01", purchase_amount_minor: GROUP, life_under_three_years: false,
    disposed_at: "2025-06-15T12:00:00Z", disposal_proceeds_minor: 0,
  }, "Testveien 1", PRIVATE_SCOPE);
  assert.equal(onlyStamp.disposalDate, "2025-06-15");
  assert.equal(onlyStamp.disposalProceedsMinor, 0);
  assert.equal(onlyStamp.disposalProceedsKnown, true);
  const later = yearView([onlyStamp], 2026, {});
  assert.equal(later.rows.chair.isDisposal, false);
  assert.equal(later.rows.chair.depreciationMinor, 640_000);
  assert.equal(later.rows.chair.closingMinor, 2_560_000);
  assert.equal(later.outlooks[0].statement.basisMinor, later.outlooks[0].statement.openingMinor);

  const legacy = itemInput({
    id: "old", property_id: "p1", name: "Bord", category: "furnishings",
    purchase_date: "2023-01-01", purchase_amount_minor: GROUP,
  }, "Testveien 1", PRIVATE_SCOPE);
  assert.equal(legacy.kind, "loose_inventory");
  assert.equal(legacy.disposalDate, null);
  assert.equal(legacy.disposalProceedsMinor, null);
  assert.equal(yearView([legacy], 2024, {}).rows.old.isDisposal, false);

  assert.doesNotThrow(() => itemInput({
    id: "bad", property_id: "p1", name: "X", purchase_date: "2024-01-01", purchase_amount_minor: DIRECT,
    disposal_date: { bad: true }, disposed_at: "ikke-en-dato", disposal_proceeds_minor: { nope: 1 },
  }, "", PRIVATE_SCOPE));
  const junk = itemInput({
    id: "bad", property_id: "p1", name: "X", item_kind: "loose_inventory",
    purchase_date: "2025-01-01", purchase_amount_minor: DIRECT, life_under_three_years: false,
    disposal_date: null, disposed_at: "ikke-en-dato", disposal_proceeds_minor: "nope",
  }, "", PRIVATE_SCOPE);
  assert.equal(junk.disposalDate, null);
  assert.equal(junk.disposalProceedsMinor, null);
  const shown = yearView([junk], 2025, {});
  assert.equal(shown.rows.bad.isDisposal, false);
  assert.equal(shown.rows.bad.isPurchase, true);
  assert.equal(shown.rows.bad.depreciationMinor, DIRECT);
  assert.equal(furnitureName(furnitureLines([junk], 2025, {}, [])[0], 2025), "X");
});

test("dispose_property_asset is not called and the sale sheet is gone", () => {
  const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
  for (const name of ["./portal-inventory.js", "./portal.js", "./portal-annual.js", "./portal-actions.js"]) {
    const src = read(name);
    assert.equal(src.includes("dispose_property_asset"), false, name);
    assert.equal(src.includes("disposeAsset"), false, name);
  }
  const portal = read("./portal.js");
  for (const text of ["Selg eller utranger", "Salg eller utrangering", "Solgt eller utrangert", "Møbelhistorikk", "Salgssum"]) {
    assert.equal(portal.includes(text), false, text);
  }
  assert.equal(read("./portal-annual.js").includes("avhendet"), false);
});
