import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// The public signing page (/signer/<token>). The edge function is mocked, so no
// request reaches Production. The page runs under the same CSP as Cloudflare Pages.
const TOKEN = "T".repeat(40) + "o_-";
const ENDPOINT = "https://jfrorhixjsuomwtjwqla.supabase.co/functions/v1/contract-public-signing";
const CSP = /Content-Security-Policy: (.+)/u.exec(readFileSync(new URL("../public/_headers", import.meta.url), "utf8"))[1];

function tinyPDF(text) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 28 Tf 72 760 Td (${text}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1").toString("base64");
}

async function install(page) {
  const calls = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.url().startsWith(ENDPOINT)) {
      const body = request.postDataJSON();
      calls.push(body);
      const json = (status, data) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      if (body.action === "view") {
        return json(200, { status: "ready_to_sign", landlord_name: "Ola Utleier", party: { name: "Kari Nordmann", role: "tenant" },
          property: { address: "Testveien 1", postal_code: "0150", city: "Oslo", unit: null },
          parties: [{ name: "Ola Utleier", role: "landlord" }, { name: "Kari Nordmann", role: "tenant" }],
          version_number: 1, signed_on: null, expires_at: "2026-11-21T09:00:00Z",
          pdf: { content_type: "application/pdf", base64: tinyPDF("Leiekontrakt test") } });
      }
      if (body.action === "sign") return json(200, { status: "signed" });
      return json(400, { error: "invalid_request" });
    }
    if (request.resourceType() === "document") {
      const response = await route.fetch();
      return route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": CSP } });
    }
    return route.continue();
  });
  return calls;
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("the link opens the contract straight away; the tenant draws and signs without any code", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });
  const calls = await install(page);
  await page.goto(`/signer/${TOKEN}`);
  await expect(page.getByRole("heading", { name: "Les leiekontrakten" })).toBeVisible();
  await expect(page.getByText("Leiekontrakt for Testveien 1, 0150 Oslo")).toBeVisible();
  await expect(page.getByText("Ola Utleier har sendt deg denne leiekontrakten til signering.")).toBeVisible();
  await expect(page.getByText(/engangskode/i)).toHaveCount(0);
  await expect(page.locator("input[autocomplete='one-time-code']")).toHaveCount(0);
  await expect(page.locator(".signer-page-canvas")).toHaveCount(1);
  await expect(page.getByText("Slutt på kontrakten (1 sider).")).toBeVisible();
  if (process.env.SIGNER_SHOTS) await page.screenshot({ path: `${process.env.SIGNER_SHOTS}/direkte-1-kontrakt.png`, fullPage: true });
  const submit = page.getByRole("button", { name: "Signer og send inn" });
  await expect(submit).toBeDisabled();
  const pad = page.locator(".signer-pad-canvas");
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i += 1) await page.mouse.move(box.x + 20 + i * 12, box.y + box.height / 2 + Math.sin(i) * 20);
  await page.mouse.up();
  await expect(submit).toBeDisabled();
  await page.getByLabel("Jeg har lest leiekontrakten og godkjenner den.").check();
  await page.getByLabel("Sted (valgfritt)").fill("Oslo");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole("heading", { name: "Leiekontrakten er signert" })).toBeVisible();
  await expect(page.getByText("Ola Utleier og du får den ferdige")).toBeVisible();
  if (process.env.SIGNER_SHOTS) await page.screenshot({ path: `${process.env.SIGNER_SHOTS}/direkte-2-ferdig.png` });
  const sign = calls.find((c) => c.action === "sign");
  expect(Object.keys(sign).sort().join(",")).toBe("action,approved,signature,token");
  expect(sign.token).toBe(TOKEN);
  expect(sign.signature.place).toBe("Oslo");
  expect(sign.signature.signer_name).toBe("Kari Nordmann");
  expect(sign.signature.jpeg_base64.length).toBeGreaterThan(200);
  expect(calls.map((c) => c.action)).toEqual(["view", "sign"]);
  expect(calls.some((c) => "session" in c || "code" in c)).toBe(false);
  expect(errors).toEqual([]);
});

test("a revoked (resent) link explains that a newer email is needed", async ({ page }) => {
  await page.route(ENDPOINT, (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "superseded" }) }));
  await page.goto(`/signer/${TOKEN}`);
  await expect(page.getByRole("heading", { name: "Lenken kan ikke brukes" })).toBeVisible();
  await expect(page.getByText(/Bruk den nyeste e-posten/)).toBeVisible();
});

test("an already signed link cannot be signed again", async ({ page }) => {
  await page.route(ENDPOINT, (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "already_signed" }) }));
  await page.goto(`/signer/${TOKEN}`);
  await expect(page.getByRole("heading", { name: "Allerede signert" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Signer og send inn" })).toHaveCount(0);
});

test("an expired link explains what to do", async ({ page }) => {
  await page.route(ENDPOINT, (route) => route.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ error: "token_expired" }) }));
  await page.goto(`/signer/${TOKEN}`);
  await expect(page.getByRole("heading", { name: "Lenken har utløpt" })).toBeVisible();
  await expect(page.getByText("Be utleier sende en ny signeringslenke fra appen.")).toBeVisible();
});

test("a broken link never calls the server", async ({ page }) => {
  let called = false;
  await page.route(ENDPOINT, (route) => { called = true; return route.abort(); });
  await page.goto("/signer/kort");
  await expect(page.getByRole("heading", { name: "Lenken kan ikke brukes" })).toBeVisible();
  expect(called).toBe(false);
});
