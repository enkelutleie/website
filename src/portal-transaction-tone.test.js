import assert from "node:assert/strict";
import test from "node:test";
import { transactionListTone } from "./portal-transaction-tone.js";

test("income is green", () => {
  assert.deepEqual(transactionListTone({ transaction_type: "income", category: "rent", description: "Husleie" }), { icon: "is-success", amount: "is-income" });
});

test("ordinary expense is red", () => {
  assert.deepEqual(transactionListTone({ transaction_type: "expense", category: "other_expense", description: "Maling" }), { icon: "is-danger", amount: "is-expense" });
  assert.deepEqual(transactionListTone({ transaction_type: "expense", category: "maintenance", description: "Reparasjon" }), { icon: "is-danger", amount: "is-expense" });
});

test("Kjørebok expense is purple (tax token), detected like mileageFields", () => {
  const row = {
    transaction_type: "expense",
    category: "other_expense",
    description: "Kjørebok · Hjemme – Testveien 1 · Visning · 20 km",
  };
  assert.deepEqual(transactionListTone(row), { icon: "is-tax", amount: "is-tax" });
});

test("furniture is gold (warning token), including folded legacy_category furnishings_equipment", () => {
  assert.deepEqual(transactionListTone({
    transaction_type: "expense",
    category: "furnishings_equipment",
    description: "Sofa",
  }), { icon: "is-warning", amount: "is-warning" });
  assert.deepEqual(transactionListTone({
    transaction_type: "expense",
    category: "other_expense",
    legacy_category: "furnishings_equipment",
    description: "Sofa",
  }), { icon: "is-warning", amount: "is-warning" });
});

test("a description that is not a trip stays red, even if it mentions Kjørebok", () => {
  assert.deepEqual(transactionListTone({
    transaction_type: "expense",
    category: "other_expense",
    description: "Kjørebok-hefte",
  }), { icon: "is-danger", amount: "is-expense" });
});
