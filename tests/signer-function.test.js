import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, onRequestHead } from "../functions/signer/[token].js";

const token = "A".repeat(43);

test("/signer/<token> serves the signing page in place with private headers", async () => {
  const fetched = [];
  const env = { ASSETS: { fetch: async (url) => { fetched.push(String(url)); return new Response("<html>signer</html>", { status: 200 }); } } };
  const response = await onRequestGet({ request: new Request(`https://enkelutleie.com/signer/${token}`), env });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<html>signer</html>");
  assert.deepEqual(fetched, ["https://enkelutleie.com/signer/"]);
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Security-Policy"), /script-src 'self'/);
  assert.match(response.headers.get("X-Robots-Tag"), /noindex/);
  const head = await onRequestHead({ request: new Request(`https://enkelutleie.com/signer/${token}`), env });
  assert.equal(head.status, 200);
});

test("a missing page asset is a 503, never a redirect", async () => {
  const env = { ASSETS: { fetch: async () => new Response("nope", { status: 404 }) } };
  const response = await onRequestGet({ request: new Request(`https://enkelutleie.com/signer/${token}`), env });
  assert.equal(response.status, 503);
});
