import assert from "node:assert/strict";
import test from "node:test";
import {
  PREMIUM_APP_NOTE,
  PREMIUM_BODY,
  PREMIUM_FREE_LINE,
  PREMIUM_MONTHLY_MINOR,
  PREMIUM_PLAN_MONTHLY,
  PREMIUM_PLAN_YEARLY,
  PREMIUM_TITLE,
  PREMIUM_YEARLY_MINOR,
  PROPERTY_CAP_TEXT,
  premiumFromReads,
  premiumGateApplies,
  premiumPriceText,
  premiumSavingsLabel,
  premiumYearlySavingsMinor,
  propertyInsertCap,
  propertyInsertPremiumRejection,
} from "./portal-premium.js";

test("a tenant is never gated, a landlord without Premium is", () => {
  assert.equal(premiumGateApplies({ premium: false, role: "tenant" }), false);
  assert.equal(premiumGateApplies({ premium: true, role: "tenant" }), false);
  assert.equal(premiumGateApplies({ premium: false, role: "owner" }), true);
  assert.equal(premiumGateApplies({ premium: false, role: "co_landlord" }), true);
  assert.equal(premiumGateApplies({ premium: true, role: "owner" }), false);
  assert.equal(premiumGateApplies({ premium: false }), true);
});

test("Premium is an active subscription or complimentary access", () => {
  const future = "2030-01-01T00:00:00Z";
  const past = "2020-01-01T00:00:00Z";
  assert.equal(premiumFromReads({ complimentary: true, entitlements: [] }).ok, true);
  assert.equal(premiumFromReads({ complimentary: true, complimentaryError: true, entitlementsError: true }).ok, true);
  assert.equal(premiumFromReads({ entitlements: [{ status: "active", expires_at: future }] }).ok, true);
  assert.equal(premiumFromReads({ entitlements: [{ status: "grace", expires_at: future }] }).ok, true);
  assert.equal(premiumFromReads({ entitlements: [{ status: "canceled", expires_at: future }] }).ok, true);
  assert.equal(premiumFromReads({ entitlements: [{ status: "active", expires_at: past }] }).ok, false);
  assert.equal(premiumFromReads({ entitlements: [{ status: "hold", expires_at: future }] }).ok, false);
  assert.equal(premiumFromReads({ entitlements: [{ status: "expired", expires_at: future }] }).ok, false);
  assert.equal(premiumFromReads({ entitlements: [] }).ok, false);
  assert.equal(premiumFromReads({ entitlementsError: true, complimentaryError: true }).unknown, true);
  assert.equal(premiumFromReads({ entitlementsError: true, complimentary: false }).ok, false);
});

test("plan names, prices and the yearly savings pill", () => {
  assert.equal(PREMIUM_TITLE, "Premium for utleier");
  assert.equal(PREMIUM_PLAN_MONTHLY, "Premium månedlig");
  assert.equal(PREMIUM_PLAN_YEARLY, "Premium årlig");
  assert.equal(premiumPriceText(PREMIUM_MONTHLY_MINOR), "49 kr");
  assert.equal(premiumPriceText(PREMIUM_YEARLY_MINOR), "449 kr");
  assert.equal(premiumYearlySavingsMinor(), 13900);
  assert.equal(premiumSavingsLabel(), "Spar 139 kr per år");
  assert.equal(premiumYearlySavingsMinor(100, 5000), null);
  assert.equal(premiumSavingsLabel(null), null);
  assert.equal(premiumYearlySavingsMinor(4901, 44900), null);
  assert.match(PREMIUM_BODY, /Få full kontroll på utleien/);
  assert.match(PREMIUM_FREE_LINE, /Opprett bolig gratis/);
  assert.equal(PREMIUM_APP_NOTE, "Premium kjøpes i Enkel Utleie-appen.");
});

test("premium_required and the four-home cap stay distinct", () => {
  assert.equal(propertyInsertPremiumRejection({ message: "premium_required", code: "P0001" }), true);
  assert.equal(propertyInsertCap({ message: "consumer_property_cap", code: "P0001" }), true);
  assert.equal(propertyInsertPremiumRejection({ message: "consumer_property_cap", code: "P0001" }), false);
  assert.equal(propertyInsertCap({ code: "P0001" }), false);
  assert.equal(propertyInsertPremiumRejection(null), false);
  assert.match(PROPERTY_CAP_TEXT, /inntil fire boliger/);
});
