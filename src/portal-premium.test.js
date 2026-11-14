import assert from "node:assert/strict";
import test from "node:test";
import { PREMIUM_WALL_BODY, PREMIUM_WALL_TITLE, PROPERTY_CAP_TEXT, landlordPremiumWall, propertyInsertCap, propertyInsertPremiumRejection } from "./portal-premium.js";

const resolved = { propertiesResolved: true, premiumLoading: false };

test("no Premium and zero homes: the portal stays open", () => {
  assert.equal(landlordPremiumWall({ ...resolved, premium: false, propertyCount: 0 }), "hidden");
});

test("no Premium and at least one home: the whole portal is behind the wall", () => {
  assert.equal(landlordPremiumWall({ ...resolved, premium: false, propertyCount: 1 }), "wall");
  assert.equal(landlordPremiumWall({ ...resolved, premium: false, propertyCount: 2 }), "wall");
});

test("Premium hides the wall, including at the four-home cap", () => {
  assert.equal(landlordPremiumWall({ ...resolved, premium: true, propertyCount: 0 }), "hidden");
  assert.equal(landlordPremiumWall({ ...resolved, premium: true, propertyCount: 4 }), "hidden");
});

test("an unanswered property list is a spinner, never the portal or the wall", () => {
  assert.equal(landlordPremiumWall({ premium: false, propertyCount: 0, propertiesResolved: false }), "loading");
  assert.equal(landlordPremiumWall({ premium: false, premiumLoading: true, propertyCount: 3, propertiesResolved: false }), "loading");
});

test("homes already known still wait for Premium before showing the wall", () => {
  assert.equal(landlordPremiumWall({ ...resolved, premiumLoading: true, propertyCount: 1 }), "loading");
  assert.equal(landlordPremiumWall({ ...resolved, premiumLoading: true, propertyCount: 0 }), "hidden");
});

test("a server premium rejection forces the wall; the cap does not", () => {
  assert.equal(landlordPremiumWall({ ...resolved, premium: false, propertyCount: 0, forceWall: true }), "wall");
  assert.equal(propertyInsertPremiumRejection({ message: "premium_required", code: "P0001" }), true);
  assert.equal(propertyInsertCap({ message: "consumer_property_cap", code: "P0001" }), true);
  assert.equal(propertyInsertPremiumRejection({ message: "consumer_property_cap", code: "P0001" }), false);
  assert.equal(propertyInsertCap({ code: "P0001" }), false);
  assert.equal(propertyInsertPremiumRejection(null), false);
  assert.equal(PREMIUM_WALL_TITLE, "Premium for utleier");
  assert.equal(PREMIUM_WALL_BODY, "Første bolig kan registreres gratis. Utleier trenger Premium for å bruke appen og for flere boliger. Leietaker er gratis. Premium dekker inntil 4 boliger.");
  assert.match(PROPERTY_CAP_TEXT, /inntil fire boliger/);
});
