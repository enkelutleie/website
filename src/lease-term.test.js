import assert from "node:assert/strict";
import test from "node:test";
import { fixedTermError, isBusinessLandlord, minimumFixedTermEnd } from "./portal-actions.js";

const ONE_YEAR = "En tidsbestemt leieavtale må vare i minst 1 år.";
const THREE_YEARS = "En tidsbestemt leieavtale for næringsdrivende må vare i minst 3 år.";

test("a fixed term must cover one year, or three for a business landlord", () => {
  assert.equal(fixedTermError({ termType: "fixed", start: "2026-01-15", end: "2027-01-15" }), null);
  assert.equal(fixedTermError({ termType: "fixed", start: "2026-01-15", end: "2027-01-14" }), ONE_YEAR);
  assert.equal(fixedTermError({ termType: "fixed", start: "2026-01-15", end: "2026-06-01" }), ONE_YEAR);
  assert.equal(fixedTermError({ termType: "indefinite", start: "2026-01-15", end: "2026-02-01" }), null);
  assert.equal(fixedTermError({ termType: "fixed", start: "", end: "" }), null);
  assert.equal(fixedTermError({ termType: "fixed", start: "2026-03-01", end: "2026-03-01" }), null);

  const business = { business: true };
  assert.equal(fixedTermError({ termType: "fixed", start: "2026-01-15", end: "2029-01-15" }, business), null);
  assert.equal(fixedTermError({ termType: "fixed", start: "2026-01-15", end: "2029-01-14" }, business), THREE_YEARS);
  assert.equal(fixedTermError({ termType: "fixed", start: "2026-01-15", end: "2027-01-15" }, business), THREE_YEARS);
});

test("29 February counts as one year on 28 February", () => {
  assert.equal(minimumFixedTermEnd("2024-02-29", 1), "2025-02-28");
  assert.equal(fixedTermError({ termType: "fixed", start: "2024-02-29", end: "2025-02-28" }), null);
  assert.equal(fixedTermError({ termType: "fixed", start: "2024-02-29", end: "2025-02-27" }), ONE_YEAR);
});

test("næringsdrivende is the rental profile, not a private landlord", () => {
  assert.equal(isBusinessLandlord({ rental_profile: { landlord_kind: "individual" } }), false);
  assert.equal(isBusinessLandlord({ rental_profile: { landlord_kind: "business" } }), true);
  assert.equal(isBusinessLandlord({ rental_profile: { landlord_kind: "individual", organization_number: "123456789" } }), true);
  assert.equal(isBusinessLandlord({ rental_profile: { landlord_kind: "individual", business_name: "Utleie AS" } }), true);
  assert.equal(isBusinessLandlord({ rental_profile: { legal_form: "AS" } }), true);
  assert.equal(isBusinessLandlord(null), false);
});
