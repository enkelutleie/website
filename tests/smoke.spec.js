import { expect, test } from "@playwright/test";
import { installSupabase } from "./supabase-mock.js";

// Logged-in portal tests use a mocked Supabase client. No request is sent to
// Production, and "Ny bolig" / Finn import is never opened.
//
// Tests marked test.fail() after their setup are known bugs. Setup failures
// still fail the run; only the final assertion is an expected failure.

const PAGES = [
  ["Oversikt", "Oversikt"],
  ["Boliger", "Boliger"],
  ["Økonomi", "Økonomi"],
  ["Om boligen", "Om boligen"],
  ["Boligperm", "Boligperm"],
  ["Dokumenter og maler", "Dokumenter og maler"],
  ["Vedlikeholdshistorikk", "Vedlikeholdshistorikk"],
  ["Boligbilder", "Boligbilder"],
  ["Kalender", "Kalender"],
  ["Vedlikehold", "Vedlikehold"],
  ["Inn- og utflytting", "Inn- og utflytting"],
  ["Leiekontrakt", "Leiekontrakt"],
  ["Meldinger", "Meldinger"],
  ["Leiehistorikk", "Leiehistorikk"],
  ["Innstillinger", "Innstillinger"],
];

async function openPortal(page, options = {}) {
  const errors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => errors.push(error));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const writes = [];
  await installSupabase(page, { ...options, writes });
  await page.goto("/portal/#oversikt");
  await expect(page.locator("[data-portal]")).toHaveAttribute("aria-busy", "false");
  return { writes, errors, consoleErrors };
}

async function portalReady(page) {
  await expect(page.getByText("Testveien 1").first()).toBeVisible();
  await expect(page.getByText("Noe gikk galt")).toHaveCount(0);
}

test.describe("public pages", () => {
  test("coming soon home, login, privacy, account deletion and 404", async ({ page }) => {
    const hits = [];
    await page.route(/jfrorhixjsuomwtjwqla\.supabase\.co/, (route) => {
      hits.push(route.request().url());
      return route.fulfill({ status: 500, body: "blocked" });
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Kommer snart" })).toBeVisible();
    await expect(page.getByRole("link", { name: "hei@enkelutleie.com" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Logg inn" })).toHaveCount(0);

    await page.goto("/personvern");
    await expect(page.getByRole("heading", { name: "Personvern" })).toBeVisible();
    await page.goto("/slett-konto/");
    await expect(page.getByRole("heading", { name: "Slett kontoen din" })).toBeVisible();
    await page.goto("/om-oss/");
    await expect(page.getByRole("heading", { name: "Historien bak Enkel Utleie" })).toBeVisible();
    await page.goto("/nope-not-a-page");
    await expect(page.getByRole("heading", { name: "Siden finnes ikke" })).toBeVisible();
    expect(hits).toEqual([]);
  });

  test("FAQ accordion and landing preview", async ({ page }) => {
    await page.goto("/landing-full.html");
    await expect(page).toHaveTitle(/utleie, helt enkelt/);
    await expect(page.getByRole("link", { name: "Logg inn" })).toBeVisible();
    await page.goto("/sporsmal-svar/");
    const first = page.locator("details.faq-item").nth(0);
    const second = page.locator("details.faq-item").nth(1);
    await first.locator("summary").click();
    await expect(first).toHaveAttribute("open", "");
    await second.locator("summary").click();
    await expect(second).toHaveAttribute("open", "");
    await expect(first).not.toHaveAttribute("open", "");
  });

  test("demo modal opens, traps Escape, and closes", async ({ page }) => {
    await page.goto("/landing-full.html");
    await page.getByRole("button", { name: "Se hvordan det fungerer" }).click();
    const dialog = page.getByRole("dialog", { name: "Se hvordan det fungerer" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("button", { name: "Lukk" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("known bug: demo video file is missing from the build", async ({ request }) => {
    const response = await request.get("/brand/slik-fungerer-det.mp4");
    test.fail(true, "public/brand has no slik-fungerer-det.mp4");
    expect(response.status()).toBe(200);
  });

  test("known bug: vite preview does not serve /forhandsvisning", async ({ page }) => {
    await page.goto("/forhandsvisning");
    test.fail(true, "previewNotFound does not know the landing preview path");
    await expect(page).toHaveTitle(/utleie, helt enkelt/);
  });

  test("known bug: phone header hides the landing menu", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/landing-full.html");
    await expect(page.getByRole("button", { name: "Se hvordan det fungerer" })).toBeVisible();
    test.fail(true, ".nav is display:none below 640px and there is no menu button");
    await expect(page.getByRole("navigation", { name: "Hovedmeny" })).toBeVisible();
  });

  test("video modal scroll lock under the production CSP", async ({ page }) => {
    const violations = [];
    page.on("console", (message) => {
      if (/content security policy/i.test(message.text())) violations.push(message.text());
    });
    await page.route("**/*", async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      if (route.request().resourceType() === "document") {
        headers["content-security-policy"] = "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
      }
      await route.fulfill({ response, headers });
    });
    await page.goto("/landing-full.html");
    await page.getByRole("button", { name: "Se hvordan det fungerer" }).click();
    await expect(page.getByRole("dialog", { name: "Se hvordan det fungerer" })).toBeVisible();
    const position = await page.evaluate(() => document.body.style.position);
    expect(position).toBe("fixed");
    expect(violations).toEqual([]);
  });
});

test.describe("login", () => {
  test("empty submit stays on the page and a wrong password is explained", async ({ page }) => {
    const writes = [];
    await installSupabase(page, { session: false, invalidPassword: true, writes });
    await page.goto("/logg-inn/");
    await expect(page.getByRole("heading", { name: "Logg inn" })).toBeVisible();
    await expect(page.getByLabel("E-post")).toBeVisible();
    await expect(page.getByText("Ekte kode kommer når iOS kan bekrefte den.")).toBeVisible();
    await page.getByRole("button", { name: "Logg inn", exact: true }).click();
    await expect(page.getByLabel("E-post")).toBeFocused();
    expect(writes.filter((entry) => entry.path.includes("/token"))).toEqual([]);

    await page.getByLabel("E-post").fill("kari@example.com");
    await page.getByLabel("Passord").fill("feil-passord");
    await page.getByRole("button", { name: "Logg inn", exact: true }).click();
    await expect(page.getByText("Feil e-post eller passord.")).toBeVisible();
    await expect(page).toHaveURL(/\/logg-inn\/?$/);
  });

  test("Google sign-in starts at the production return address", async ({ page }) => {
    await installSupabase(page, { session: false });
    await page.goto("/logg-inn/");
    await page.getByRole("button", { name: "Fortsett med Google" }).click();
    await expect.poll(() => page.url()).toContain("/auth/v1/authorize");
    const target = decodeURIComponent(page.url());
    expect(target).toContain("provider=google");
    expect(target).toContain("https://enkelutleie.com/logg-inn/");
  });

  test("a stored session on the login page continues to the portal", async ({ page }) => {
    await installSupabase(page, {});
    await page.goto("/logg-inn/");
    await expect(page).toHaveURL(/\/portal\/?/);
    await expect(page.locator("[data-portal]")).toHaveAttribute("aria-busy", "false");
    await portalReady(page);
  });

  test("logged-out portal returns to login", async ({ page }) => {
    await installSupabase(page, { session: false });
    await page.goto("/portal/");
    await expect(page).toHaveURL(/\/logg-inn\/?/);
    await expect(page.getByRole("heading", { name: "Logg inn" })).toBeVisible();
  });
});

test.describe("portal", () => {
  test("every landlord page renders and the main actions open", async ({ page }) => {
    test.setTimeout(120_000);
    const { writes, errors } = await openPortal(page);
    await portalReady(page);
    await page.screenshot({ path: "/opt/cursor/artifacts/portal-desktop.png" });
    await expect(page.locator("select")).toHaveCount(0);
    await expect(page.locator("[data-page-title]")).toHaveText("Oversikt");
    await expect(page.getByText("12 000,00 kr").first()).toBeVisible();
    await expect(page.getByText("Ola Leietaker").first()).toBeVisible();
    await expect(page.getByText("Visning").first()).toBeVisible();

    for (const [label, title] of PAGES) {
      await page.getByRole("link", { name: label, exact: true }).click();
      await expect(page.locator("[data-page-title]")).toHaveText(title);
      await expect(page.getByText("Noe gikk galt")).toHaveCount(0);
      if (label === "Økonomi") await expect(page.getByText("Husleie november")).toBeVisible();
    }

    await page.getByRole("link", { name: "Økonomi", exact: true }).click();
    await page.getByRole("link", { name: /Kjørebok/ }).click();
    await expect(page.getByRole("heading", { name: "Kjøregodtgjørelse" })).toBeVisible();
    await page.getByRole("link", { name: "Økonomi", exact: true }).click();
    await page.getByRole("link", { name: /Møbler og inventar/ }).click();
    await expect(page.getByRole("heading", { name: "Møbler og inventar" })).toBeVisible();
    await page.getByRole("link", { name: "Økonomi", exact: true }).click();
    await page.getByRole("link", { name: /Årsoppgave/ }).click();
    await expect(page.getByRole("heading", { name: "Årsoppgave" })).toBeVisible();

    await page.getByRole("link", { name: "Kalender", exact: true }).click();
    await page.getByRole("button", { name: /15\. november 2026/ }).click();
    await expect(page.getByText("Visning").first()).toBeVisible();
    await page.getByRole("button", { name: "+ Ny hendelse" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Ny hendelse" })).toBeVisible();
    await expect(page.locator("select")).toHaveCount(0);
    await page.getByRole("button", { name: "Avbryt" }).click();

    await page.getByRole("link", { name: "Vedlikehold", exact: true }).click();
    await page.getByRole("link", { name: /Drypp i kran/ }).click();
    await expect(page.getByText("Drypp i kran").first()).toBeVisible();
    await expect(page.getByText("Noe gikk galt")).toHaveCount(0);

    await page.getByRole("link", { name: "Leiehistorikk", exact: true }).click();
    const historyOpen = page.getByRole("link", { name: "Åpne" });
    await expect(historyOpen).toBeVisible();
    await historyOpen.click();
    await expect(page.getByText("Skrivebeskyttet")).toBeVisible();
    await expect(page.getByText("Ola Nordmann").first()).toBeVisible();

    await page.getByRole("link", { name: "Leiekontrakt", exact: true }).click();
    await expect(page.getByText("Utkast", { exact: true })).toBeVisible();
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Forhåndsvis" }).click();
    const popup = await popupPromise;
    await expect.poll(() => popup.url()).toMatch(/^blob:/);
    await popup.close();

    await page.getByRole("link", { name: "Meldinger", exact: true }).click();
    await page.getByLabel("Melding").fill("Hei");
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => writes.some((entry) => entry.path.endsWith("/send_chat_message"))).toBe(true);

    await page.getByRole("link", { name: "Dokumenter og maler" }).click();
    await page.getByRole("button", { name: /Referanse/ }).click();
    await expect(page.getByRole("heading", { name: "Referanse" })).toBeVisible();
    await page.getByRole("button", { name: "Avbryt" }).click();

    await page.getByRole("link", { name: "Oversikt", exact: true }).click();
    const picker = page.getByRole("button", { name: /Testveien 1/ });
    await picker.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#om-boligen$/);
    await expect(page.getByText("Fjellveien 2").first()).toBeVisible();

    await page.getByRole("link", { name: "Oversikt", exact: true }).click();
    await page.getByRole("button", { name: "Inviter leietaker" }).click();
    await expect(page.getByRole("heading", { name: "Inviter leietaker" })).toBeVisible();
    await page.getByRole("button", { name: "Avbryt" }).click();

    const bell = page.getByRole("button", { name: "Varsler" });
    await bell.evaluate((el) => el.click());
    await expect(page.getByRole("dialog", { name: "Varsler" })).toBeVisible();
    await expect(page.getByText("Ingen varsler ennå")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Varsler" })).toHaveAttribute("aria-expanded", "false");

    await page.getByRole("button", { name: "Logg ut" }).click();
    await expect(page).toHaveURL(/\/logg-inn\/?/);

    const unexpected = errors.filter((error) => !/websocket|WebSocket/i.test(String(error)));
    expect(unexpected).toEqual([]);
  });

  test("custom listbox keyboard selects a category and a valid income saves", async ({ page }) => {
    const { writes, errors } = await openPortal(page);
    await page.getByRole("link", { name: "Økonomi", exact: true }).click();
    await page.getByRole("button", { name: "Ny inntekt" }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Ny inntekt" }) });
    const category = dialog.getByRole("button", { name: /Kategori/ });
    await category.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(category).toHaveAttribute("aria-label", /Husleie/);
    await expect(page.locator("select")).toHaveCount(0);
    await dialog.getByLabel("Beløp").fill("1500");
    await dialog.getByLabel("Hva gjelder inntekten?").fill("Husleie for november");
    await dialog.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Posten er lagret.")).toBeVisible();
    expect(writes.some((entry) => /create_.*financial_transaction/.test(entry.path))).toBe(true);
    expect(errors).toEqual([]);
  });

  test("empty required field shows a message and does not throw", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await openPortal(page);
    await page.getByRole("link", { name: "Økonomi", exact: true }).click();
    await page.getByRole("button", { name: "Ny inntekt" }).click();
    const income = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Ny inntekt" }) });
    await income.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(income.getByText("Velg kategori")).toBeVisible();
    await income.getByRole("button", { name: "Avbryt" }).click();

    await page.getByRole("link", { name: "Oversikt", exact: true }).click();
    await page.getByRole("button", { name: "Ny bolig" }).click();
    const create = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Ny bolig" }) });
    await create.getByRole("button", { name: "Opprett bolig" }).click();
    await expect(create.getByText("Fyll ut «Adresse».")).toBeVisible();
    await create.getByLabel("Adresse").fill("Testveien 9");
    await create.getByLabel("Postnummer").fill("0150");
    await create.getByLabel("Poststed").fill("Oslo");
    await create.getByRole("button", { name: "Opprett bolig" }).click();
    await expect(create).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("editing a property keeps the stored municipality", async ({ page }) => {
    const { writes } = await openPortal(page);
    await page.getByRole("link", { name: "Om boligen", exact: true }).click();
    await page.getByRole("button", { name: "Rediger informasjon" }).click();
    await page.getByRole("button", { name: "Lagre endringer" }).click();
    await expect.poll(() => writes.find((entry) => entry.method === "PATCH" && entry.path.includes("/properties"))).toBeTruthy();
    const saved = writes.find((entry) => entry.method === "PATCH" && entry.path.includes("/properties"));
    expect(saved.body).not.toHaveProperty("municipality_number");
    expect(saved.body).not.toHaveProperty("municipality_name");
    expect(saved.body.address_line1).toBeTruthy();
  });

  test("known bug: handbook save nulls link_url and shows database text", async ({ page }) => {
    const { writes } = await openPortal(page, { errorOn: ["property_handbook_sections"] });
    await page.getByRole("link", { name: "Boligperm", exact: true }).click();
    await page.getByRole("button", { name: "Rediger" }).first().click();
    await page.getByLabel("Innhold").fill("Ring vaktmester.");
    await page.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect.poll(() => writes.find((entry) => String(entry.path).includes("property_handbook_sections"))).toBeTruthy();
    const saved = writes.find((entry) => String(entry.path).includes("property_handbook_sections"));
    await expect(page.getByText(/property_handbook_sections_pkey/)).toBeVisible();
    test.fail(true, "saveHandbookSection sets link_url null and explain() appends the raw error");
    expect(saved.body.link_url).not.toBeNull();
    await expect(page.getByText(/property_handbook_sections_pkey/)).toHaveCount(0);
  });

  test("known bug: a failed membership read looks like no properties", async ({ page }) => {
    await openPortal(page, { fail: ["property_members"] });
    await expect(page.getByRole("heading", { name: "Ingen boliger ennå" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ny bolig" })).toBeVisible();
    test.fail(true, "property_members errors are not treated as a failed load");
    await expect(page.getByText("Vi fikk ikke hentet oversikten")).toBeVisible();
  });

  test("known bug: a failed tenancy read looks like no tenancy", async ({ page }) => {
    await openPortal(page, { fail: ["tenancies"] });
    await portalReady(page);
    await expect(page.getByRole("button", { name: "Inviter leietaker" }).first()).toBeVisible();
    test.fail(true, "tenancies errors are ignored and the list becomes empty");
    await expect(page.getByText("Vi fikk ikke hentet oversikten")).toBeVisible();
  });

  test("known bug: an unknown hash stays in the address bar", async ({ page }) => {
    await openPortal(page);
    await page.evaluate(() => { location.hash = "#finnes-ikke"; });
    await expect(page.locator("[data-page-title]")).toHaveText("Oversikt");
    test.fail(true, "render falls back to oversikt without replacing the hash");
    await expect(page).toHaveURL(/#oversikt$/);
  });

  test("known bug: the portal does not stack on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openPortal(page);
    await portalReady(page);
    await page.screenshot({ path: "/opt/cursor/artifacts/portal-mobile.png" });
    const box = await page.locator(".pt-content").boundingBox();
    test.fail(true, ".pt-app keeps a 220px sidebar at 860px and never stacks");
    expect(box.width).toBeGreaterThan(300);
  });

  test("known bug: clicking the bell icon closes the panel on the same click", async ({ page }) => {
    await openPortal(page);
    await page.getByRole("button", { name: "Varsler" }).click();
    test.fail(true, "drawBell replaces the SVG during click, so the outside-click listener sees a detached target");
    await expect(page.getByRole("dialog", { name: "Varsler" })).toBeVisible({ timeout: 1000 });
  });

  test("known bug: the notification panel does not take focus", async ({ page }) => {
    await openPortal(page);
    const bell = page.getByRole("button", { name: "Varsler" });
    await bell.evaluate((el) => el.click());
    await expect(page.getByRole("dialog", { name: "Varsler" })).toBeVisible();
    test.fail(true, "opening the bell dialog leaves focus on the button");
    const inside = await page.evaluate(() => document.activeElement?.closest("[role=dialog]") != null);
    expect(inside).toBe(true);
  });

  test("premium gate when the account has no entitlement", async ({ page }) => {
    await openPortal(page, { premium: false });
    await expect(page.getByRole("heading", { name: "Nettportalen er en del av Premium" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Økonomi" })).toHaveCount(0);
  });
});

test.describe("production", () => {
  test("live routes, preview landing and the missing demo video", async ({ request }) => {
    const home = await request.get("https://enkelutleie.com/");
    expect(home.status()).toBe(200);
    const login = await request.get("https://enkelutleie.com/logg-inn", { maxRedirects: 0 });
    expect(login.status()).toBe(308);
    const about = await request.get("https://enkelutleie.com/om-oss/", { maxRedirects: 0 });
    expect(about.status()).toBe(302);
    expect(about.headers().location).toBe("/");
    const faq = await request.get("https://enkelutleie.com/sporsmal-svar/", { maxRedirects: 0 });
    expect(faq.status()).toBe(302);
    expect(faq.headers().location).toBe("/");
    const preview = await request.get("https://enkelutleie.com/forhandsvisning");
    expect(preview.status()).toBe(200);
    expect(await preview.text()).toContain("Se hvordan det fungerer");
    const missing = await request.get("https://enkelutleie.com/brand/slik-fungerer-det.mp4", { maxRedirects: 0 });
    expect(missing.status()).toBe(404);
    const unknown = await request.get("https://enkelutleie.com/nope-not-a-page", { maxRedirects: 0 });
    expect(unknown.status()).toBe(404);
  });

  test("contract-pdf CORS allows the production origins only", async ({ request }) => {
    const headers = { "access-control-request-method": "POST" };
    const apex = await request.fetch("https://jfrorhixjsuomwtjwqla.supabase.co/functions/v1/contract-pdf", {
      method: "OPTIONS",
      headers: { ...headers, origin: "https://enkelutleie.com" },
    });
    expect(apex.headers()["access-control-allow-origin"]).toBe("https://enkelutleie.com");
    const local = await request.fetch("https://jfrorhixjsuomwtjwqla.supabase.co/functions/v1/contract-pdf", {
      method: "OPTIONS",
      headers: { ...headers, origin: "http://localhost:4173" },
    });
    expect(local.headers()["access-control-allow-origin"] ?? "").not.toBe("http://localhost:4173");
  });
});
