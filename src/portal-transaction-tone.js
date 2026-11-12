// Colors on «Siste transaksjoner» / «Transaksjoner»: Kjørebok purple, furniture gold,
// ordinary expenses red, income green. Visual only; detection mirrors existing helpers.
import { isFurnishingPurchase, isMileageExpense } from "./portal-actions.js";

export function transactionListTone(row) {
  if (row?.transaction_type === "income") return { icon: "is-success", amount: "is-income" };
  if (isMileageExpense(row)) return { icon: "is-tax", amount: "is-tax" };
  if (isFurnishingPurchase(row)) return { icon: "is-warning", amount: "is-warning" };
  return { icon: "is-danger", amount: "is-expense" };
}
