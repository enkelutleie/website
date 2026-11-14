import assert from "node:assert/strict";
import test from "node:test";
import { isMileageExpense, mileageFields, mileageListFields } from "./portal-actions.js";
import { mileageDetailTitle, mileageListTitle, rentIncomeTitle, transactionListTitle } from "./portal-transaction-title.js";

test("expense: the description is the title", () => {
  assert.equal(transactionListTitle({ transaction_type: "expense", category: "other_expense", description: "Reparasjon av vaskemaskin" }, "Utgift"), "Reparasjon av vaskemaskin");
});

test("expense without description: category name, then «Utgift»", () => {
  assert.equal(transactionListTitle({ transaction_type: "expense", category: "maintenance", description: "  " }, "Vedlikehold"), "Vedlikehold");
  assert.equal(transactionListTitle({ transaction_type: "expense", category: "electricity_heating", description: null }, "Strøm og oppvarming"), "Strøm og oppvarming");
  assert.equal(transactionListTitle({ transaction_type: "expense", category: null, description: "" }, null), "Utgift");
});

test("income: description, then «Leieinntekt <måned år>» for rent, then category, then «Inntekt»", () => {
  assert.equal(transactionListTitle({ transaction_type: "income", category: "rent", description: "Husleie for oktober" }, "Husleie"), "Husleie for oktober");
  assert.equal(transactionListTitle({ transaction_type: "income", category: "rent", description: "", transaction_date: "2026-10-03", series_occurrence_date: "2026-09-01" }, "Husleie"), "Leieinntekt september 2026");
  assert.equal(transactionListTitle({ transaction_type: "income", category: "rent", description: "", transaction_date: "2026-10-03" }, "Husleie"), "Leieinntekt oktober 2026");
  assert.equal(transactionListTitle({ transaction_type: "income", category: "parking", description: "" }, "Parkering"), "Parkering");
  assert.equal(transactionListTitle({ transaction_type: "income", category: null, description: "" }, null), "Inntekt");
});

test("rentIncomeTitle needs a yyyy-MM-dd date", () => {
  assert.equal(rentIncomeTitle("2026-01-31"), "Leieinntekt januar 2026");
  assert.equal(rentIncomeTitle(null), null);
  assert.equal(rentIncomeTitle("okt"), null);
});

const ROUTE = "Øvre Fergested 21, 4614 Kristiansand S, Norge – Oksevollveien 27B, 4514 Mandal, Norge";
const part = (...bits) => bits.join(" \u00b7 ");
const trip = (...tail) => ({ transaction_type: "expense", description: part("Kjørebok", ROUTE, ...tail) });

test("kjørebok list title is «Kjørebok · formål» with U+00B7, or just «Kjørebok»", () => {
  assert.equal(mileageListTitle("Visning"), "Kjørebok \u00b7 Visning");
  assert.equal(mileageListTitle("  Visning  "), "Kjørebok \u00b7 Visning");
  assert.equal(mileageListTitle("Visning").charCodeAt("Kjørebok".length + 1), 0x00b7);
  assert.equal(mileageListTitle(null), "Kjørebok");
  assert.equal(mileageListTitle(""), "Kjørebok");
  assert.equal(mileageListTitle("   "), "Kjørebok");
  assert.equal(mileageDetailTitle("Stoler"), "Stoler");
  assert.equal(mileageDetailTitle(null), "Kjørebok");
  assert.equal(mileageDetailTitle("  "), "Kjørebok");
});

test("list title drops route, kilometres and tolls, including when tolls follow the kilometres", () => {
  const chairs = trip("Stoler", "39.1000000000000000 km");
  assert.equal(mileageListTitle(mileageListFields(chairs).purpose), "Kjørebok \u00b7 Stoler");
  assert.equal(mileageListTitle(mileageListFields(chairs).purpose).includes("Kristiansand"), false);
  assert.equal(mileageListTitle(mileageListFields(chairs).purpose).includes("km"), false);
  assert.deepEqual(mileageFields(chairs), { purpose: "Stoler", meters: 39100, fromPlace: "Øvre Fergested 21, 4614 Kristiansand S, Norge", toPlace: "Oksevollveien 27B, 4514 Mandal, Norge" });

  const noPurpose = trip("12 km");
  assert.equal(mileageListFields(noPurpose).purpose, null);
  assert.equal(mileageListTitle(mileageListFields(noPurpose).purpose), "Kjørebok");
  assert.equal(mileageFields(noPurpose).purpose, null);

  const withToll = trip("Stoler", "39.1 km", "bompenger 86 kr");
  assert.equal(mileageListTitle(mileageListFields(withToll).purpose), "Kjørebok \u00b7 Stoler");
  assert.equal(mileageListTitle(mileageListFields(withToll).purpose).includes("bompenger"), false);
  assert.equal(mileageListTitle(mileageListFields(withToll).purpose).includes("86"), false);
  assert.equal(mileageFields(withToll), null);
  assert.equal(isMileageExpense(withToll), true);

  const tollOnly = trip("12 km", "bompenger 10 kr");
  assert.equal(mileageListTitle(mileageListFields(tollOnly).purpose), "Kjørebok");
  assert.equal(mileageFields(tollOnly), null);

  const comma = trip("Levere stoler", "39,1 km");
  assert.equal(mileageListTitle(mileageListFields(comma).purpose), "Kjørebok \u00b7 Levere stoler");
  assert.equal(mileageFields(comma).meters, 39100);
});

test("mileageFields keeps route and purpose for the detail, not the list", () => {
  const row = { transaction_type: "expense", description: "Kjørebok · Hjemme – Testveien 1 · Visning · 20 km" };
  assert.deepEqual(mileageFields(row), { purpose: "Visning", meters: 20000, fromPlace: "Hjemme", toPlace: "Testveien 1" });
  assert.deepEqual(mileageFields({ transaction_type: "expense", description: "Kjørebok · Oslo S - Sandvika · 25,5 km" }), {
    purpose: null, meters: 25500, fromPlace: "Oslo S", toPlace: "Sandvika",
  });
  assert.equal(mileageFields({ transaction_type: "expense", description: "Kjørebok-hefte" }), null);
  assert.equal(mileageListFields({ transaction_type: "expense", description: "Kjørebok-hefte" }), null);
  assert.equal(mileageFields({ transaction_type: "income", description: "Kjørebok · Hjemme – Testveien 1 · Visning · 20 km" }), null);
  assert.equal(mileageListFields({ transaction_type: "income", description: "Husleie" }), null);
  assert.equal(transactionListTitle({ transaction_type: "income", category: "rent", description: "Husleie" }, "Husleie"), "Husleie");
});

