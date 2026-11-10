import assert from "node:assert/strict";
import test from "node:test";
import { formHomeUse, halfUseChoiceValue, halfUseOptions, rentalProfileOf, usesAtLeastHalfFor } from "./portal-own-home.js";

const KNOWN = ["other_home", "own_home", "holiday_home"];

test("uses_at_least_half is only sent for own_home", () => {
  assert.equal(usesAtLeastHalfFor("own_home", "yes"), true);
  assert.equal(usesAtLeastHalfFor("own_home", "no"), false);
  assert.equal(usesAtLeastHalfFor("own_home", ""), null);
  assert.equal(usesAtLeastHalfFor("other_home", "yes"), null);
  assert.equal(usesAtLeastHalfFor("holiday_home", "no"), null);
});

test("rentalProfileOf keeps the stored duration from the tax facts, not the masked profile", () => {
  const masked = { landlord_kind: "individual", legal_form: null, business_name: "", organization_number: "", home_use: "unknown", rental_duration: "unknown" };
  const p = rentalProfileOf("own_home", masked, { home_use: "own_home", rental_duration: "short_term", uses_at_least_half: null }, "no");
  assert.deepEqual(p, { landlord_kind: "individual", legal_form: null, business_name: "", organization_number: "", home_use: "own_home", rental_duration: "short_term", uses_at_least_half: false });
  assert.equal(rentalProfileOf("other_home", masked, null, "yes").rental_duration, "long_term");
  assert.equal(rentalProfileOf("other_home", masked, null, "yes").uses_at_least_half, null);
  assert.equal(rentalProfileOf("own_home", null, null, "yes").uses_at_least_half, true);
});

test("formHomeUse prefers the tax facts over the masked profile", () => {
  assert.equal(formHomeUse({ home_use: "own_home" }, { home_use: "unknown" }, KNOWN), "own_home");
  assert.equal(formHomeUse(null, { home_use: "holiday_home" }, KNOWN), "holiday_home");
  assert.equal(formHomeUse({ home_use: "unknown" }, { home_use: "unknown" }, KNOWN), "other_home");
  assert.equal(formHomeUse(null, null, KNOWN), "other_home");
});

test("ja/nei control: empty until answered", () => {
  assert.equal(halfUseChoiceValue(true), "yes");
  assert.equal(halfUseChoiceValue(false), "no");
  assert.equal(halfUseChoiceValue(null), "");
  assert.deepEqual(halfUseOptions(null).map(([v]) => v), ["", "yes", "no"]);
  assert.deepEqual(halfUseOptions(true).map(([v]) => v), ["yes", "no"]);
});
