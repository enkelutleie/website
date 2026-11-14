// Colors on «Siste transaksjoner» / «Transaksjoner»: Kjørebok system blue, furniture yellow,
// ordinary expenses red, income green. Visual only; detection mirrors existing helpers.
import { isFurnishingPurchase, isMileageExpense } from "./portal-actions.js";

export function transactionListTone(row) {
  if (row?.transaction_type === "income") return { icon: "is-success", amount: "is-income" };
  if (isMileageExpense(row)) return { icon: "is-mileage", amount: "is-mileage" };
  if (isFurnishingPurchase(row)) return { icon: "is-furnishings", amount: "is-furnishings" };
  return { icon: "is-danger", amount: "is-expense" };
}
