import test from "node:test";
import assert from "node:assert/strict";
import { ERROR_TEXT, FINAL_ERRORS, addressLine, callSigning, errorText, osloDateISO, signatureBody, tokenFromPath } from "./signer-api.js";

const token = "A".repeat(40) + "b_-";

test("the token is read only from /signer/<43 tegn>", () => {
  assert.equal(tokenFromPath(`/signer/${token}`), token);
  assert.equal(tokenFromPath(`/signer/${token}/`), token);
  assert.equal(tokenFromPath("/signer/kort"), null);
  assert.equal(tokenFromPath(`/signer/${token}x`), null);
  assert.equal(tokenFromPath("/portal/"), null);
});

test("every server error has Norwegian text and unknown errors fall back", () => {
  for (const code of ["token_invalid", "token_expired", "already_signed", "superseded", "cancelled", "agreement_changed", "rate_limited", "invalid_signature"]) {
    assert.ok(ERROR_TEXT[code], code);
  }
  assert.equal(errorText("noe_nytt"), ERROR_TEXT.server_error);
  assert.ok(FINAL_ERRORS.has("token_expired"));
  assert.ok(!FINAL_ERRORS.has("rate_limited"));
  for (const removed of Object.keys(ERROR_TEXT)) assert.ok(!removed.startsWith("otp_") && removed !== "session_required", removed);
  assert.ok(!Object.values(ERROR_TEXT).some((text) => /kode/iu.test(text)));
});

test("sign body matches the edge function's exact keys", () => {
  const body = signatureBody({ token, jpegBase64: "x", width: 900, height: 300, signerName: " Kari ", place: " Oslo ", now: new Date("2026-11-14T23:30:00Z") });
  assert.equal(Object.keys(body).sort().join(","), "action,approved,signature,token");
  assert.equal(Object.keys(body.signature).sort().join(","), "date,height,jpeg_base64,place,signer_name,width");
  assert.equal(body.signature.date, "2026-11-15");
  assert.equal(body.signature.signer_name, "Kari");
  assert.equal(body.signature.place, "Oslo");
  assert.equal(osloDateISO(new Date("2026-07-01T21:59:00Z")), "2026-07-01");
});

test("address line and API errors", async () => {
  assert.equal(addressLine({ address: "Testveien 1", unit: "H0201", postal_code: "0150", city: "Oslo" }), "Testveien 1, H0201, 0150 Oslo");
  const failing = await callSigning({ action: "view", token }, async () => ({ ok: false, status: 410, json: async () => ({ error: "token_expired" }) }));
  assert.deepEqual([failing.ok, failing.error], [false, "token_expired"]);
  const offline = await callSigning({}, async () => { throw new Error("offline"); });
  assert.equal(offline.error, "network");
  const ok = await callSigning({}, async () => ({ ok: true, status: 200, json: async () => ({ status: "ready_to_sign" }) }));
  assert.equal(ok.data.status, "ready_to_sign");
});
