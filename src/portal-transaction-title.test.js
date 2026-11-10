import assert from "node:assert/strict";
import test from "node:test";
import { rentIncomeTitle, transactionListTitle } from "./portal-transaction-title.js";

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

