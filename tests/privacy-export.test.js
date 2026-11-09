import assert from "node:assert/strict";
import test from "node:test";
import { exportBlocks } from "../src/portal-privacy.js";

const bytes = (value) => new TextEncoder().encode(JSON.stringify(value));

// The portal never collects a national id. If an export still contains one, the PDF text omits it.
test("privacy PDF text hides national-id keys and *_id", () => {
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
          foedselsnummer: "05050512345",
          national_id: "03030312345",
          birth_number: "06060612345",
        },
      }),
    },
  ]);
  const text = blocks.map((block) => block.text ?? "").join("\n");
  assert.match(text, /Kari Utleier/);
  assert.doesNotMatch(text, /secret-user-id/);
  assert.doesNotMatch(text, /01010112345/);
  assert.doesNotMatch(text, /02020212345/);
  assert.doesNotMatch(text, /03030312345/);
  assert.doesNotMatch(text, /04040412345/);
  assert.doesNotMatch(text, /05050512345/);
  assert.doesNotMatch(text, /06060612345/);
});
