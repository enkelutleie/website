import assert from "node:assert/strict";
import test from "node:test";
import { explain } from "../src/portal-actions.js";

test("explain keeps known cases and hides the raw database message", () => {
  assert.match(explain({ message: "JWT expired" }), /Økten er utløpt/);
  assert.match(explain({ message: "permission denied" }), /ikke tilgang/);
  assert.match(explain({ message: "duplicate key value violates unique constraint \"property_handbook_sections_pkey\"" }), /^Det gikk ikke\. Prøv igjen om litt\.$/);
  assert.equal(explain(null), "Det gikk ikke. Prøv igjen om litt.");
});
