import assert from "node:assert/strict";
import test from "node:test";
import { exportBlocks } from "../src/portal-privacy.js";

const bytes = (value) => new TextEncoder().encode(JSON.stringify(value));

// Current renderer behavior. personnummer is not collected in the portal UI;
// this locks the fact that an unrecognized national-id key in the export JSON
// is still printed. Update the assertion when those keys are omitted.
test("privacy PDF text prints unrecognized national-id keys and hides *_id", () => {
  const blocks = exportBlocks([
    {
      path: "manifest.json",
      data: bytes({
        components: [{ component_path: "data/profile.v1.json", stable_ordinal: 1 }],
        omitted: { explanation: "Noen interne felt er utelatt." },
      }),
    },
    {
      path: "data/profile.v1.json",
      data: bytes({
        domain_key: "profile",
        data: {
          display_name: "Kari Utleier",
          user_id: "secret-user-id",
          personnummer: "01010112345",
          fodselsnummer: "02020212345",
          fødselsnummer: "04040412345",
          national_id: "03030312345",
        },
      }),
    },
  ]);
  const text = blocks.map((block) => block.text ?? "").join("\n");
  assert.match(text, /Kari Utleier/);
  assert.doesNotMatch(text, /secret-user-id/);
  // national_id is omitted only because the key ends with _id, not because it is an identity number.
  assert.doesNotMatch(text, /03030312345/);
  assert.match(text, /01010112345/);
  assert.match(text, /02020212345/);
  assert.match(text, /04040412345/);
});
