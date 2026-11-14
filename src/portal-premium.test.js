import assert from "node:assert/strict";
import test from "node:test";
import { portalFeatureAllowed, propertyInsertPremiumRejection } from "./portal-premium.js";

test("no subscription can open the property list and the empty overview", () => {
  const none = { premium: false, propertyCount: 0 };
  assert.equal(portalFeatureAllowed("boliger", none), true);
  assert.equal(portalFeatureAllowed("oversikt", none), true);
  assert.equal(portalFeatureAllowed("okonomi", none), false);
  assert.equal(portalFeatureAllowed("om-boligen", none), false);
  assert.equal(portalFeatureAllowed("innstillinger", none), false);
});

test("a property list stays open after the first bolig; the rest does not", () => {
  const one = { premium: false, propertyCount: 1 };
  assert.equal(portalFeatureAllowed("boliger", one), true);
  assert.equal(portalFeatureAllowed("oversikt", one), false);
  assert.equal(portalFeatureAllowed("kalender", one), false);
});

test("Premium opens every screen", () => {
  assert.equal(portalFeatureAllowed("okonomi", { premium: true, propertyCount: 0 }), true);
  assert.equal(portalFeatureAllowed("oversikt", { premium: true, propertyCount: 2 }), true);
});

test("only a premium insert error opens the paywall", () => {
  assert.equal(propertyInsertPremiumRejection({ message: "premium_required", code: "P0001" }), true);
  assert.equal(propertyInsertPremiumRejection({ message: "consumer_property_cap", code: "P0001" }), false);
  assert.equal(propertyInsertPremiumRejection({ message: "duplicate key", code: "23505" }), false);
  assert.equal(propertyInsertPremiumRejection({ code: "P0001" }), false);
  assert.equal(propertyInsertPremiumRejection(null), false);
});
