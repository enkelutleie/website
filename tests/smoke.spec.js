import { expect, test } from "@playwright/test";
import { handoverImageBytes, handoverTables, installSupabase, PROPERTY_ID, READY_A, READY_B, READY_C, ROOM_EVENT_ID, roomCalendarTables, READY_PROCESS_A, readyToEndTables, requiresResponseTables, RR_FALSE_ID, RR_NULL_ID, RR_TRUE_ID } from "./supabase-mock.js";

// Logged-in portal tests use a mocked Supabase client. No request is sent to
// Production. The suite asserts the corrected behaviour, including "Ny bolig".

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
  await expect(page.getByRole("heading", { name: /Testveien 1/ })).toBeVisible();
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
    await page.goto("/support/");
    await expect(page.getByRole("heading", { name: "Support" })).toBeVisible();
    await page.goto("/om-oss/");
    await expect(page.getByRole("heading", { name: "Historien bak Enkel Utleie" })).toBeVisible();
    await page.goto("/nope-not-a-page");
    await expect(page.getByRole("heading", { name: "Siden finnes ikke" })).toBeVisible();
    expect(hits).toEqual([]);
  });

  test("terms of use page", async ({ page }) => {
    await page.goto("/vilkar/");
    await expect(page.getByRole("heading", { name: "Vilkår for bruk av Enkel Utleie" })).toBeVisible();
    await expect(page.locator("main")).toContainText("Sist oppdatert: 6. oktober 2026");
    await expect(page.locator("footer").getByRole("link", { name: "Vilkår", exact: true })).toHaveAttribute("href", "/vilkar/");
    await page.goto("/vilkar");
    await expect(page.getByRole("heading", { name: "Vilkår for bruk av Enkel Utleie" })).toBeVisible();
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

  test("demo modal shows a coming-soon state and does not request a video", async ({ page }) => {
    const videos = [];
    page.on("request", (request) => {
      if (request.url().includes(".mp4")) videos.push(request.url());
    });
    await page.goto("/landing-full.html");
    await page.getByRole("button", { name: "Se hvordan det fungerer" }).click();
    await expect(page.getByRole("dialog", { name: "Se hvordan det fungerer" }).getByText("Video kommer snart")).toBeVisible();
    expect(videos).toEqual([]);
  });

  test("vite preview serves the landing at /forhandsvisning", async ({ page }) => {
    await page.goto("/forhandsvisning");
    await expect(page).toHaveTitle(/utleie, helt enkelt/);
    await expect(page.getByRole("button", { name: "Se hvordan det fungerer" })).toBeVisible();
  });

  test("phone header opens the landing menu", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/landing-full.html");
    await expect(page.getByRole("button", { name: "Se hvordan det fungerer" })).toBeVisible();
    const menu = page.getByRole("button", { name: "Meny" });
    await expect(menu).toBeVisible();
    await menu.click();
    const nav = page.getByRole("navigation", { name: "Hovedmeny" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Slik fungerer det" })).toBeVisible();
    await nav.getByRole("link", { name: "Funksjoner" }).click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
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

  test("a dropped login request can be tried again", async ({ page }) => {
    await installSupabase(page, { session: false, abortPassword: true });
    await page.goto("/logg-inn/");
    await page.getByLabel("E-post").fill("kari@example.com");
    await page.getByLabel("Passord").fill("hemmelig");
    const submit = page.getByRole("button", { name: "Logg inn", exact: true });
    await submit.click();
    await expect(page.getByText("Innloggingen kunne ikke fullføres. Prøv igjen.")).toBeVisible();
    await expect(submit).toBeEnabled();
    await expect(page).toHaveURL(/\/logg-inn\/?$/);
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
    await expect(page.getByText("Selg eller utranger")).toHaveCount(0);
    await expect(page.getByText("Salg eller utrangering")).toHaveCount(0);
    await expect(page.getByText("Solgt eller utrangert")).toHaveCount(0);
    await expect(page.getByText("Møbelhistorikk")).toHaveCount(0);
    await expect(page.getByText("avhendet")).toHaveCount(0);
    // The list card has no «Registrerte møbler» heading, count line or estimate note (iOS/Android parity).
    await expect(page.getByText("Registrerte møbler")).toHaveCount(0);
    await expect(page.getByText("Estimater er til din egen planlegging. Det er ikke skatteråd og ikke skattemelding.")).toHaveCount(0);
    await expect(page.getByText(/\d+ møb(el|ler) registrert\./)).toHaveCount(0);
    await expect(page.getByText("Ingen møbler eller inventar registrert.")).toBeVisible();
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

    await page.evaluate(() => sessionStorage.setItem("pt-property", "should-not-survive"));
    await page.getByRole("button", { name: "Logg ut" }).click();
    await expect(page).toHaveURL(/\/logg-inn\/?/);
    await expect.poll(async () => {
      try { return await page.evaluate(() => sessionStorage.getItem("pt-property")); }
      catch { return "pending"; }
    }).toBeNull();

    const unexpected = errors.filter((error) => !/websocket|WebSocket/i.test(String(error)));
    expect(unexpected).toEqual([]);
  });

  test("custom listbox keyboard selects a category and a valid income saves", async ({ page }) => {
    const { writes, errors } = await openPortal(page);
    await page.getByRole("link", { name: "Økonomi", exact: true }).click();
    await page.getByRole("button", { name: "Ny inntekt" }).click();
    const dialog = page.getByRole("dialog", { name: "Ny inntekt" });
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
    await expect(income.getByRole("alert")).toHaveText("Velg kategori");
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

  // Kjørebok and Møbler og inventar: «Les mer» opens the info, «Vis mindre» at its bottom closes it.
  for (const [link, heading] of [[/Kjørebok/, "Kjøregodtgjørelse"], [/Møbler og inventar/, "Møbler og inventar"]]) {
    test(`«${heading}» info has a «Vis mindre» button at the bottom`, async ({ page }) => {
      const { errors } = await openPortal(page);
      await page.getByRole("link", { name: "Økonomi", exact: true }).click();
      await page.getByRole("link", { name: link }).click();
      const head = page.locator(".pt-card").filter({ has: page.getByRole("heading", { name: heading }) });
      const info = head.locator(".pt-mileage-info");
      const top = head.getByRole("button", { name: "Les mer" });
      await expect(info).toBeHidden();
      await top.click();
      await expect(info).toBeVisible();
      await expect(head.getByRole("button", { name: "Les mer" })).toHaveCount(0);
      await expect(head.getByRole("button", { name: "Skjul" })).toHaveCount(0);
      // Two «Vis mindre»: the top toggle and the last element of the open text.
      await expect(head.getByRole("button", { name: "Vis mindre" })).toHaveCount(2);
      const bottom = info.locator(":scope > :last-child");
      await expect(bottom).toHaveText("Vis mindre");
      await expect(bottom).toHaveRole("button");
      await bottom.click();
      await expect(info).toBeHidden();
      await expect(head.getByRole("button", { name: "Les mer" })).toBeVisible();
      await expect(head.getByRole("button", { name: "Vis mindre" })).toHaveCount(0);
      // The top toggle still works after closing from the bottom.
      await head.getByRole("button", { name: "Les mer" }).click();
      await expect(info).toBeVisible();
      await info.getByRole("button", { name: "Vis mindre" }).click();
      await expect(info).toBeHidden();
      expect(errors).toEqual([]);
    });
  }

  // iOS #1607 (TENANT_UPCOMING_NO_RESPONSE): only requires_response === true waits for a reply.
  test("null and false are info events: listed, but without waiting status (iOS #1607)", async ({ page }) => {
    const { errors } = await openPortal(page, { handover: requiresResponseTables() });
    await page.getByRole("link", { name: "Kalender", exact: true }).click();
    const cardFor = (title) => page.locator(`a[href$="${title}"]`);
    for (const id of [RR_TRUE_ID, RR_FALSE_ID, RR_NULL_ID]) await expect(cardFor(id).first()).toBeVisible();
    await expect(cardFor(RR_TRUE_ID).first()).toContainText("Venter på godkjenning");
    await expect(cardFor(RR_FALSE_ID).first()).not.toContainText("Venter på godkjenning");
    await expect(cardFor(RR_NULL_ID).first()).not.toContainText("Venter på godkjenning");
    await expect(page.getByText("Venter på godkjenning")).toHaveCount(1);
    for (const [id, waits] of [[RR_TRUE_ID, true], [RR_FALSE_ID, false], [RR_NULL_ID, false]]) {
      await page.goto(`/portal/#kalender/${id}`);
      await expect(page.getByRole("button", { name: "Rediger", exact: true })).toBeVisible();
      await expect(page.getByText("Venter på svar fra leietaker")).toHaveCount(waits ? 1 : 0);
      await expect(page.getByText("Dette er informasjon. Ingen svar trengs.")).toHaveCount(waits ? 0 : 1);
    }
    expect(errors).toEqual([]);
  });

  test("Endre hendelse starts «Krever svar» from requires_response === true (iOS #1607)", async ({ page }) => {
    await openPortal(page, { handover: requiresResponseTables() });
    for (const [id, on] of [[RR_TRUE_ID, true], [RR_FALSE_ID, false], [RR_NULL_ID, false]]) {
      await page.goto(`/portal/#kalender/${id}`);
      await page.getByRole("button", { name: "Rediger", exact: true }).click();
      const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Endre hendelse" }) });
      const toggle = dialog.getByRole("switch", { name: /Krever svar fra leietaker/ });
      if (on) await expect(toggle).toBeChecked(); else await expect(toggle).not.toBeChecked();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }
  });

  // iOS #1606 (RECURRING_TX_ICON): a post with series_id gets a «Gjentagende» capsule after its title.
  test("recurring transactions show a «Gjentagende» capsule, one-off posts do not (iOS #1606)", async ({ page }) => {
    const tx = (id, type, description, series) => ({
      id, property_id: PROPERTY_ID, transaction_type: type, category: type === "income" ? "rent" : "other_expense", legacy_category: null,
      amount_minor: 100_000, transaction_date: "2026-11-01", series_id: series, series_occurrence_date: series ? "2026-11-01" : null,
      description, counterparty: null, maintenance_request_id: null, updated_at: "2026-11-01T10:00:00Z", voided_at: null,
    });
    const requests = [];
    const { errors } = await openPortal(page, { requests, handover: { financial_transactions: [
      tx("71000000-0000-4000-8000-000000000001", "income", "Husleie fast", "5e000000-0000-4000-8000-000000000001"),
      tx("71000000-0000-4000-8000-000000000002", "expense", "Strøm fast", "5e000000-0000-4000-8000-000000000002"),
      tx("71000000-0000-4000-8000-000000000003", "expense", "Maling engang", null),
    ] } });
    await page.getByRole("link", { name: "Økonomi", exact: true }).click();
    const row = (text) => page.locator("li.pt-row").filter({ hasText: text });
    for (const text of ["Husleie fast", "Strøm fast"]) {
      const badge = row(text).getByRole("img", { name: "Gjentagende" });
      await expect(badge).toBeVisible();
      await expect(badge).toHaveAttribute("title", "Gjentagende");
      // Right after the title, on the same row.
      await expect(row(text).locator(".pt-tx-title > strong + .pt-tx-recurring")).toHaveCount(1);
      const box = await badge.boundingBox();
      expect([Math.round(box.width), Math.round(box.height)]).toEqual([32, 22]);
    }
    await expect(row("Maling engang")).toBeVisible();
    await expect(row("Maling engang").getByRole("img", { name: "Gjentagende" })).toHaveCount(0);
    await expect(page.getByTestId("economy.transaction.recurring")).toHaveCount(2);
    expect(requests.some((r) => r.path.endsWith("/financial_transactions") && /\bseries_id\b/.test(r.select ?? ""))).toBe(true);
    expect(errors).toEqual([]);
  });

  // Per-type colors on «Siste transaksjoner» / «Transaksjoner»: blue, yellow, red, green.
  test("transaction rows color icon and amount by type (Kjørebok, møbler, utgift, inntekt)", async ({ page }) => {
    const tx = (id, over) => ({
      id, property_id: PROPERTY_ID, transaction_type: "expense", category: "other_expense", legacy_category: null,
      amount_minor: 100_000, transaction_date: "2026-11-01", series_id: null, series_occurrence_date: null,
      description: "Post", counterparty: null, maintenance_request_id: null, updated_at: "2026-11-01T10:00:00Z", voided_at: null,
      ...over,
    });
    const { errors } = await openPortal(page, { handover: { financial_transactions: [
      tx("81000000-0000-4000-8000-000000000001", { transaction_type: "income", category: "rent", description: "Husleie farge" }),
      tx("81000000-0000-4000-8000-000000000002", { description: "Maling farge" }),
      tx("81000000-0000-4000-8000-000000000003", { category: "furnishings_equipment", description: "Sofa farge" }),
      tx("81000000-0000-4000-8000-000000000004", { category: "other_expense", legacy_category: "furnishings_equipment", description: "Bord farge" }),
      tx("81000000-0000-4000-8000-000000000005", { description: "Kjørebok · Hjemme – Testveien 1 · Visning · 20 km" }),
    ] } });
    await page.getByRole("link", { name: "Økonomi", exact: true }).click();
    const row = (text) => page.locator("li.pt-row").filter({ hasText: text });
    const rgbOf = async (locator) => locator.evaluate((el) => getComputedStyle(el).color);
    await expect(row("Husleie farge").locator(".pt-icon-circle")).toHaveClass(/is-success/);
    await expect(row("Husleie farge").locator(".pt-amount")).toHaveClass(/is-income/);
    expect(await rgbOf(row("Husleie farge").locator(".pt-amount"))).toBe("rgb(52, 199, 89)");
    await expect(row("Maling farge").locator(".pt-icon-circle")).toHaveClass(/is-danger/);
    await expect(row("Maling farge").locator(".pt-amount")).toHaveClass(/is-expense/);
    expect(await rgbOf(row("Maling farge").locator(".pt-amount"))).toBe("rgb(255, 59, 48)");
    for (const text of ["Sofa farge", "Bord farge"]) {
      await expect(row(text).locator(".pt-icon-circle")).toHaveClass(/is-furnishings/);
      await expect(row(text).locator(".pt-amount")).toHaveClass(/is-furnishings/);
      expect(await rgbOf(row(text).locator(".pt-amount"))).toBe("rgb(219, 158, 33)");
    }
    const trip = row("Visning");
    await expect(trip).toContainText("Kjørebok");
    await expect(trip.locator(".pt-icon-circle")).toHaveClass(/is-mileage/);
    await expect(trip.locator(".pt-amount")).toHaveClass(/is-mileage/);
    expect(await rgbOf(trip.locator(".pt-amount"))).toBe("rgb(0, 136, 255)");
    const furnitureTile = page.locator("a.pt-tile-link").filter({ hasText: "Møbler og inventar" });
    await expect(furnitureTile.locator(".pt-icon-circle")).toHaveClass(/is-furnishings/);
    expect(await rgbOf(furnitureTile.locator(".pt-icon-circle"))).toBe("rgb(219, 158, 33)");
    const mileageTile = page.locator("a.pt-tile-link").filter({ hasText: "Kjørebok" });
    await expect(mileageTile.locator(".pt-icon-circle")).toHaveClass(/is-mileage/);
    expect(await rgbOf(mileageTile.locator(".pt-icon-circle"))).toBe("rgb(0, 136, 255)");
    expect(errors).toEqual([]);
  });

  const furnitureAsset = (id, name) => ({
      id, property_id: PROPERTY_ID, name, item_kind: "loose_inventory", category: "furnishings", purchase_date: "2026-03-01",
      purchase_amount_minor: 1_500_000, useful_life_years: 5, life_under_three_years: false, counts_for_taxable_rental: true,
      fixed_treatment: null, disposal_date: null, disposal_proceeds_minor: null, notes: null, source_transaction_id: null,
  });
  for (const assets of [[furnitureAsset("a5000000-0000-4000-8000-000000000001", "Sofa")], [furnitureAsset("a5000000-0000-4000-8000-000000000001", "Sofa"), furnitureAsset("a5000000-0000-4000-8000-000000000002", "Spisebord")]]) {
    test(`«Møbler og inventar» lists ${assets.length} item(s) without a count line or estimate note`, async ({ page }) => {
      const { errors } = await openPortal(page, { handover: { rpc: { list_property_assets: assets } } });
      await page.goto("/portal/#okonomi/mobler");
      for (const a of assets) await expect(page.getByText(a.name, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/\d+ møb(el|ler) registrert\./)).toHaveCount(0);
      await expect(page.getByText("Estimater er til din egen planlegging. Det er ikke skatteråd og ikke skattemelding.")).toHaveCount(0);
      await expect(page.getByText("Registrerte møbler")).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  // iOS #1613: bompenger i Kjørebok.
  const tollTrip = (id, over = {}) => ({
    id, property_id: PROPERTY_ID, trip_date: "2026-11-05", distance_meters: 20000, amount_minor: 7000,
    purpose: "Visning", from_place: "Hjemme", to_place: "Testveien 1", created_at: "2026-11-05T10:00:00Z", voided_at: null, ...over,
  });
  const TOLL_ID = "7a000000-0000-4000-8000-000000000001";
  const OLD_ID = "7a000000-0000-4000-8000-000000000002";
  const tollTrips = () => [
    tollTrip(TOLL_ID, { toll_amount_minor: 3360, toll_estimated: true, to_place: "Bomveien 2" }),
    tollTrip(OLD_ID, { trip_date: "2026-11-01", to_place: "Gamleveien 3" }), // older row: no toll fields
  ];
  const openMileage = async (page, options = {}) => {
    const opened = await openPortal(page, { ...options, handover: { rpc: { list_mileage_trips: tollTrips(), ...(options.rpc ?? {}) } } });
    await page.goto("/portal/#okonomi/kjorebok");
    await expect(page.getByRole("heading", { name: "Kjøregodtgjørelse" })).toBeVisible();
    return opened;
  };
  const rpcBody = (writes, name) => writes.filter((w) => w.path.endsWith(`/rpc/${name}`)).at(-1)?.body;

  test("Kjørebok shows tolls per trip, «Fradragsgrunnlag» = km + bompenger, no separate sum card, and the settings (iOS #1613)", async ({ page }) => {
    const { errors } = await openMileage(page);
    const row = (text) => page.locator("li.pt-row").filter({ hasText: text });
    await expect(row("Bomveien 2")).toContainText("Bompenger");
    await expect(row("Bomveien 2")).toContainText("33,60");
    await expect(row("Bomveien 2").locator(".pt-amount")).toContainText("103,60");
    await expect(row("Gamleveien 3")).not.toContainText("Bompenger");
    await expect(row("Gamleveien 3").locator(".pt-amount")).toContainText("70,00");
    await expect(page.locator(".pt-kpi").filter({ hasText: "Fradragsgrunnlag" })).toContainText("173,60");
    await expect(page.getByTestId("mileage.tolls.summary")).toHaveCount(0);
    await expect(page.getByText("Kilometerfradrag")).toHaveCount(0);
    await expect(page.getByText("Sum fradrag")).toHaveCount(0);
    // Magnus 2026-11-12: year pill only (no gear), info card, three cards, «+ Legg til tur», «Alle turer».
    await expect(page.getByRole("button", { name: "Innstillinger for kjørebok" })).toHaveCount(0);
    await expect(page.getByTestId("mileage.trip.options")).toHaveCount(0);
    await expect(page.locator(".pt-mileage-toolbar + .pt-card")).toContainText("Kjøregodtgjørelse");
    await expect(page.locator(".pt-kpis + .pt-mileage-add")).toContainText("+ Legg til tur");
    await expect(page.locator(".pt-mileage-add + .pt-card")).toContainText("Alle turer");
    await expect(page.locator(".pt-mileage-toolbar").getByRole("button", { name: /^År: 2026/ })).toBeVisible();
    await page.getByRole("button", { name: "Les mer" }).click();
    await expect(page.getByText("Bompengene er et estimat og kan avvike litt fra AutoPASS-fakturaen, og bompenger som er med i kjøreboken, skal ikke føres under Utgifter i tillegg.", { exact: false })).toBeVisible();
    await expect(page.locator("select")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("Kjørebok without any tolls: «Fradragsgrunnlag» is the kilometer deduction only (iOS #1613)", async ({ page }) => {
    await openPortal(page, { handover: { rpc: { list_mileage_trips: [tollTrip(OLD_ID)] } } });
    await page.goto("/portal/#okonomi/kjorebok");
    await expect(page.locator(".pt-kpi").filter({ hasText: "Fradragsgrunnlag" })).toContainText("70,00");
    await expect(page.getByTestId("mileage.tolls.summary")).toHaveCount(0);
  });

  test("editing a calculated toll turns «Bompenger (beregnet)» into «Bompenger» and sends it by hand (iOS #1613)", async ({ page }) => {
    const { writes, errors } = await openMileage(page);
    await page.locator("li.pt-row").filter({ hasText: "Bomveien 2" }).getByRole("button", { name: "Rediger" }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Rediger kjøretur" }) });
    const field = dialog.getByLabel("Bompenger (beregnet)", { exact: true });
    await expect(field).toHaveValue("33,60");
    await field.fill("40");
    await expect(dialog.getByLabel("Bompenger", { exact: true })).toHaveValue("40");
    await expect(dialog.getByText("Bompenger (beregnet)")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Lagre tur" }).click();
    await expect.poll(() => rpcBody(writes, "correct_mileage_trip")).toBeTruthy();
    expect(rpcBody(writes, "correct_mileage_trip")).toMatchObject({ requested_trip_id: TOLL_ID, requested_toll_amount_minor: 4000, requested_toll_estimated: false });
    expect(errors).toEqual([]);
  });

  test("an unchanged calculated toll stays «beregnet», and an older trip clears with 0 + false (iOS #1613)", async ({ page }) => {
    const { writes } = await openMileage(page);
    await page.locator("li.pt-row").filter({ hasText: "Bomveien 2" }).getByRole("button", { name: "Rediger" }).click();
    let dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Rediger kjøretur" }) });
    await dialog.getByRole("button", { name: "Lagre tur" }).click();
    await expect.poll(() => rpcBody(writes, "correct_mileage_trip")).toBeTruthy();
    expect(rpcBody(writes, "correct_mileage_trip")).toMatchObject({ requested_toll_amount_minor: 3360, requested_toll_estimated: true });
    await page.goto("/portal/#okonomi/kjorebok");
    await page.locator("li.pt-row").filter({ hasText: "Gamleveien 3" }).getByRole("button", { name: "Rediger" }).click();
    dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Rediger kjøretur" }) });
    await expect(dialog.getByLabel("Bompenger", { exact: true })).toHaveValue("");
    const before = writes.filter((w) => w.path.endsWith("/rpc/correct_mileage_trip")).length;
    await dialog.getByRole("button", { name: "Lagre tur" }).click();
    await expect.poll(() => writes.filter((w) => w.path.endsWith("/rpc/correct_mileage_trip")).length).toBe(before + 1);
    expect(rpcBody(writes, "correct_mileage_trip")).toMatchObject({ requested_trip_id: OLD_ID, requested_toll_amount_minor: 0, requested_toll_estimated: false });
  });

  test("Ny kjøretur sends a typed toll, null when empty, and refuses more than 10 000 kr (iOS #1613)", async ({ page }) => {
    const { writes, errors } = await openMileage(page);
    const fill = async () => {
      await page.getByRole("button", { name: "Legg til tur" }).click();
      const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Ny kjøretur" }) });
      await dialog.getByLabel("Fra-adresse").fill("Hjemme");
      await dialog.getByLabel("Til-adresse").fill("Testveien 1");
      await dialog.getByLabel("Formål").fill("Visning");
      await dialog.getByLabel("Kilometer").fill("20");
      return dialog;
    };
    let dialog = await fill();
    await dialog.getByLabel("Bompenger", { exact: true }).fill("10000,50");
    await dialog.getByRole("button", { name: "Lagre tur" }).click();
    await expect(dialog.getByText("Bompenger må være mellom 0 og 10 000 kr.")).toBeVisible();
    expect(rpcBody(writes, "create_mileage_trip")).toBeUndefined();
    await dialog.getByLabel("Bompenger", { exact: true }).fill("25");
    await expect(dialog.getByText(/Beløp: .*95,00/)).toBeVisible();
    await dialog.getByRole("button", { name: "Lagre tur" }).click();
    await expect.poll(() => rpcBody(writes, "create_mileage_trip")).toBeTruthy();
    expect(rpcBody(writes, "create_mileage_trip")).toMatchObject({ requested_distance_meters: 20000, requested_toll_amount_minor: 2500, requested_toll_estimated: false });
    await expect(dialog).toHaveCount(0);
    dialog = await fill();
    await dialog.getByRole("button", { name: "Lagre tur" }).click();
    await expect.poll(() => writes.filter((w) => w.path.endsWith("/rpc/create_mileage_trip")).length).toBe(2);
    const body = rpcBody(writes, "create_mileage_trip");
    expect(body.requested_toll_amount_minor).toBeNull();
    expect(body.requested_toll_estimated).toBeNull();
    expect(errors).toEqual([]);
  });

  // iOS #1614: mileage-route v11 with free-text addresses fills km and «Bompenger (beregnet)».
  const routeCalls = (writes) => writes.filter((w) => w.path.endsWith("/functions/v1/mileage-route"));
  const ROUTE_OK = { body: { distanceMeters: 15234, durationSeconds: 900, resolved: {}, toll_included: true, toll_amount_minor: 3360, toll_estimated: true } };
  const newTrip = async (page) => {
    await page.getByRole("button", { name: "Legg til tur" }).click();
    return page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Ny kjøretur" }) });
  };

  test("Ny kjøretur fills Kilometer and «Bompenger (beregnet)» from mileage-route and saves it as beregnet (iOS #1614)", async ({ page }) => {
    const { writes, errors } = await openMileage(page, { mileageRoute: ROUTE_OK });
    const dialog = await newTrip(page);
    await expect(dialog.getByText("Fylles automatisk eller manuelt.")).toBeVisible();
    await dialog.getByLabel("Fra-adresse").fill("Oslo S");
    await dialog.getByLabel("Til-adresse").fill("Sandvika");
    await expect(dialog.getByLabel("Kilometer")).toHaveValue("15,2");
    await expect(dialog.getByLabel("Bompenger (beregnet)")).toHaveValue("33,60");
    expect(routeCalls(writes)).toHaveLength(1);
    expect(routeCalls(writes)[0].body).toEqual({ from_address: "Oslo S", to_address: "Sandvika", tolls: true, include_tolls: true, vehicle_type: "fossil", uses_autopass: true });
    await dialog.getByLabel("Formål").fill("Visning");
    await dialog.getByRole("button", { name: "Lagre tur" }).click();
    await expect.poll(() => rpcBody(writes, "create_mileage_trip")).toBeTruthy();
    expect(rpcBody(writes, "create_mileage_trip")).toMatchObject({ requested_distance_meters: 15200, requested_toll_amount_minor: 3360, requested_toll_estimated: true, requested_vehicle_type: "fossil", requested_uses_autopass: true, requested_include_tolls: true });
    expect(errors).toEqual([]);
  });

  test("a hand-typed toll or km stays when the estimate comes, and the toll becomes «Bompenger» (iOS #1614)", async ({ page }) => {
    const { writes, errors } = await openMileage(page, { mileageRoute: ROUTE_OK, delayRpc: { "mileage-route": 600 } });
    const dialog = await newTrip(page);
    await dialog.getByLabel("Fra-adresse").fill("Oslo S");
    await dialog.getByLabel("Til-adresse").fill("Sandvika");
    await expect(dialog.getByText("Beregner avstand…")).toBeVisible();
    await dialog.getByLabel("Kilometer").fill("18");
    await dialog.getByLabel("Bompenger", { exact: true }).fill("40");
    await expect(dialog.getByText("Beregner avstand…")).toHaveCount(0);
    await expect(dialog.getByLabel("Kilometer")).toHaveValue("18");
    await expect(dialog.getByLabel("Bompenger", { exact: true })).toHaveValue("40");
    await dialog.getByLabel("Formål").fill("Visning");
    await dialog.getByRole("button", { name: "Lagre tur" }).click();
    await expect.poll(() => rpcBody(writes, "create_mileage_trip")).toBeTruthy();
    expect(rpcBody(writes, "create_mileage_trip")).toMatchObject({ requested_distance_meters: 18000, requested_toll_amount_minor: 4000, requested_toll_estimated: false });
    expect(errors).toEqual([]);
  });

  test("editing «Bompenger (beregnet)» from the estimate makes it «Bompenger» (iOS #1614)", async ({ page }) => {
    const { errors } = await openMileage(page, { mileageRoute: ROUTE_OK });
    const dialog = await newTrip(page);
    await dialog.getByLabel("Fra-adresse").fill("Oslo S");
    await dialog.getByLabel("Til-adresse").fill("Sandvika");
    await dialog.getByLabel("Bompenger (beregnet)").fill("35");
    await expect(dialog.getByLabel("Bompenger", { exact: true })).toHaveValue("35");
    await expect(dialog.getByText("Bompenger (beregnet)")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("address_not_found shows a message at that address, and km can still be typed and saved (iOS #1614)", async ({ page }) => {
    const { writes, errors } = await openMileage(page, { mileageRoute: { status: 404, body: { error: "address_not_found", field: "to_address" } } });
    const dialog = await newTrip(page);
    await dialog.getByLabel("Fra-adresse").fill("Oslo S");
    await dialog.getByLabel("Til-adresse").fill("Xyzzyveien 999");
    await expect(dialog.getByTestId("mileage.to.error")).toHaveText("Fant ikke til-adressen. Sjekk adressen, eller skriv km selv.");
    await expect(dialog.getByLabel("Til-adresse")).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByTestId("mileage.from.error")).toBeHidden();
    await expect(dialog.getByLabel("Bompenger", { exact: true })).toHaveValue("");
    await dialog.getByLabel("Kilometer").fill("12");
    await expect(dialog.getByTestId("mileage.to.error")).toBeHidden();
    await dialog.getByLabel("Formål").fill("Visning");
    await dialog.getByRole("button", { name: "Lagre tur" }).click();
    await expect.poll(() => rpcBody(writes, "create_mileage_trip")).toBeTruthy();
    expect(rpcBody(writes, "create_mileage_trip")).toMatchObject({ requested_distance_meters: 12000, requested_toll_amount_minor: null });
    expect(errors).toEqual([]);
  });

  test("a failed mileage-route says «Kunne ikke beregne avstand — skriv km selv» (iOS #1614)", async ({ page }) => {
    const { errors } = await openMileage(page, { mileageRoute: { status: 502, body: { error: "upstream_error" } } });
    const dialog = await newTrip(page);
    await dialog.getByLabel("Fra-adresse").fill("Oslo S");
    await dialog.getByLabel("Til-adresse").fill("Sandvika");
    await expect(dialog.getByTestId("mileage.distance.status")).toHaveText("Kunne ikke beregne avstand — skriv km selv");
    await dialog.getByLabel("Kilometer").fill("12");
    await expect(dialog.getByTestId("mileage.distance.status")).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("Rediger kjøretur keeps the stored km and toll with no lookup until the address changes (iOS #1614)", async ({ page }) => {
    const { writes, errors } = await openMileage(page, { mileageRoute: ROUTE_OK });
    await page.locator("li.pt-row").filter({ hasText: "Bomveien 2" }).getByRole("button", { name: "Rediger" }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Rediger kjøretur" }) });
    await expect(dialog.getByLabel("Kilometer")).toHaveValue("20");
    await expect(dialog.getByLabel("Bompenger (beregnet)")).toHaveValue("33,60");
    await page.waitForTimeout(500);
    expect(routeCalls(writes)).toHaveLength(0);
    await dialog.getByLabel("Til-adresse").fill("Sandvika");
    await expect(dialog.getByLabel("Kilometer")).toHaveValue("15,2");
    await expect(dialog.getByLabel("Bompenger (beregnet)")).toHaveValue("33,60");
    expect(routeCalls(writes)).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  // Magnus 2026-11-12: per-trip options at the bottom of «Ny kjøretur», never saved as defaults.
  const ROUTE_BY_TYPE = (body) => ({ body: { distanceMeters: 15234, durationSeconds: 900, resolved: {}, toll_included: !!body?.tolls, toll_amount_minor: body?.vehicle_type === "electric" ? 1300 : 3360, toll_estimated: true } });
  const optionsOf = (dialog) => dialog.getByTestId("mileage.trip.options");

  test("Ny kjøretur ends with the trip options card, prefilled Fossil / AutoPASS / Ta med bompenger even when saved settings differ", async ({ page }) => {
    const { errors } = await openMileage(page, { rpc: { get_mileage_toll_settings: [{ vehicle_type: "electric", uses_autopass: false, include_tolls: false }] } });
    const dialog = await newTrip(page);
    const opts = optionsOf(dialog);
    await expect(opts).toBeVisible();
    await expect(opts).toContainText("Disse valgene fylles inn automatisk for hver kjøretur, men kan endres ved behov.");
    await expect(opts.getByText("Innstillinger for kjørebok", { exact: true })).toBeVisible();
    await expect(opts.getByText("Biltype", { exact: true })).toBeVisible();
    await expect(opts.getByRole("radio", { name: "Fossil" })).toHaveAttribute("aria-checked", "true");
    await expect(opts.getByRole("radio", { name: "Elbil" })).toHaveAttribute("aria-checked", "false");
    await expect(opts.getByRole("switch", { name: "Bruker AutoPASS-brikke" })).toBeChecked();
    await expect(opts.getByRole("switch", { name: "Ta med bompenger" })).toBeChecked();
    expect(await opts.getByRole("radio", { name: "Fossil" }).evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).fontWeight])).toEqual(["rgb(47, 128, 237)", "700"]);
    // The card is the last thing before the error line and buttons.
    expect(await dialog.locator(".pt-modal-card").evaluate((card) => card.querySelector(".pt-trip-options").nextElementSibling?.className)).toContain("pt-form-error");
    await expect(dialog.getByLabel("Bompenger", { exact: true })).toBeVisible();
    await expect(page.locator("select")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("Elbil / AutoPASS re-estimate the toll for this trip only; nothing is saved as default (Magnus 2026-11-12)", async ({ page }) => {
    const { writes, errors } = await openMileage(page, { mileageRoute: ROUTE_BY_TYPE });
    let dialog = await newTrip(page);
    await dialog.getByLabel("Fra-adresse").fill("Oslo S");
    await dialog.getByLabel("Til-adresse").fill("Sandvika");
    await expect(dialog.getByLabel("Bompenger (beregnet)")).toHaveValue("33,60");
    await optionsOf(dialog).getByRole("radio", { name: "Elbil" }).click();
    await expect(dialog.getByLabel("Bompenger (beregnet)")).toHaveValue("13,00");
    expect(routeCalls(writes).at(-1).body).toMatchObject({ tolls: true, vehicle_type: "electric", uses_autopass: true });
    await optionsOf(dialog).getByRole("switch", { name: "Bruker AutoPASS-brikke" }).click();
    await expect.poll(() => routeCalls(writes).at(-1).body.uses_autopass).toBe(false);
    await expect(dialog.getByLabel("Kilometer")).toHaveValue("15,2");
    await dialog.getByLabel("Formål").fill("Visning");
    await dialog.getByRole("button", { name: "Lagre tur" }).click();
    await expect.poll(() => rpcBody(writes, "create_mileage_trip")).toBeTruthy();
    expect(rpcBody(writes, "create_mileage_trip")).toMatchObject({ requested_toll_amount_minor: 1300, requested_toll_estimated: true, requested_vehicle_type: "electric", requested_uses_autopass: false, requested_include_tolls: true });
    expect(writes.some((w) => w.path.endsWith("/rpc/set_mileage_toll_settings"))).toBe(false);
    dialog = await newTrip(page);
    await expect(optionsOf(dialog).getByRole("radio", { name: "Fossil" })).toHaveAttribute("aria-checked", "true");
    await expect(optionsOf(dialog).getByRole("switch", { name: "Bruker AutoPASS-brikke" })).toBeChecked();
    expect(errors).toEqual([]);
  });

  test("a typed toll stays when the options change (Magnus 2026-11-12)", async ({ page }) => {
    const { writes, errors } = await openMileage(page, { mileageRoute: ROUTE_BY_TYPE });
    const dialog = await newTrip(page);
    await dialog.getByLabel("Fra-adresse").fill("Oslo S");
    await dialog.getByLabel("Til-adresse").fill("Sandvika");
    await expect(dialog.getByLabel("Bompenger (beregnet)")).toHaveValue("33,60");
    await dialog.getByLabel("Bompenger (beregnet)").fill("50");
    const calls = routeCalls(writes).length;
    await optionsOf(dialog).getByRole("radio", { name: "Elbil" }).click();
    await page.waitForTimeout(450);
    await expect(dialog.getByLabel("Bompenger", { exact: true })).toHaveValue("50");
    expect(routeCalls(writes)).toHaveLength(calls);
    expect(errors).toEqual([]);
  });

  test("«Ta med bompenger» off hides the toll field and saves no tolls for this trip (Magnus 2026-11-12)", async ({ page }) => {
    const { writes, errors } = await openMileage(page, { mileageRoute: ROUTE_BY_TYPE });
    const dialog = await newTrip(page);
    await optionsOf(dialog).getByRole("switch", { name: "Ta med bompenger" }).click();
    await expect(dialog.getByLabel(/^Bompenger/)).toBeHidden();
    await dialog.getByLabel("Fra-adresse").fill("Oslo S");
    await dialog.getByLabel("Til-adresse").fill("Sandvika");
    await expect(dialog.getByLabel("Kilometer")).toHaveValue("15,2");
    expect(routeCalls(writes).at(-1).body.tolls).toBeUndefined();
    await dialog.getByLabel("Formål").fill("Visning");
    await expect(dialog.getByText(/Beløp: .*\(.*kr\/km\)$/)).toBeVisible();
    await dialog.getByRole("button", { name: "Lagre tur" }).click();
    await expect.poll(() => rpcBody(writes, "create_mileage_trip")).toBeTruthy();
    expect(rpcBody(writes, "create_mileage_trip")).toMatchObject({ requested_toll_amount_minor: null, requested_toll_estimated: null, requested_vehicle_type: "fossil", requested_uses_autopass: true, requested_include_tolls: false });
    expect(writes.some((w) => w.path.endsWith("/rpc/set_mileage_toll_settings"))).toBe(false);
    expect(errors).toEqual([]);
  });

  test("turning «Ta med bompenger» back on asks for the estimate again (Magnus 2026-11-12)", async ({ page }) => {
    const { errors } = await openMileage(page, { mileageRoute: ROUTE_BY_TYPE });
    const dialog = await newTrip(page);
    await dialog.getByLabel("Fra-adresse").fill("Oslo S");
    await dialog.getByLabel("Til-adresse").fill("Sandvika");
    await expect(dialog.getByLabel("Bompenger (beregnet)")).toHaveValue("33,60");
    const include = optionsOf(dialog).getByRole("switch", { name: "Ta med bompenger" });
    await include.click();
    await expect(dialog.getByLabel(/^Bompenger/)).toBeHidden();
    await include.click();
    await expect(dialog.getByLabel("Bompenger (beregnet)")).toHaveValue("33,60");
    expect(errors).toEqual([]);
  });

  test("Rediger kjøretur shows the trip's own stored choices and sends them back with correct_mileage_trip (iOS #1619)", async ({ page }) => {
    const ELECTRIC_ID = "7a000000-0000-4000-8000-000000000003";
    const { writes, errors } = await openMileage(page, {
      mileageRoute: ROUTE_BY_TYPE,
      rpc: { list_mileage_trips: [...tollTrips(), tollTrip(ELECTRIC_ID, { to_place: "Elveien 4", vehicle_type: "electric", uses_autopass: false, include_tolls: true, toll_amount_minor: 1300, toll_estimated: true })] },
    });
    await page.locator("li.pt-row").filter({ hasText: "Elveien 4" }).getByRole("button", { name: "Rediger" }).click();
    let dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Rediger kjøretur" }) });
    let opts = optionsOf(dialog);
    await expect(opts.getByText("Innstillinger for kjørebok", { exact: true })).toBeVisible();
    await expect(opts.getByRole("radio", { name: "Elbil" })).toHaveAttribute("aria-checked", "true");
    await expect(opts.getByRole("switch", { name: "Bruker AutoPASS-brikke" })).not.toBeChecked();
    await expect(opts.getByRole("switch", { name: "Ta med bompenger" })).toBeChecked();
    await expect(dialog.getByLabel("Bompenger (beregnet)")).toHaveValue("13,00");
    await page.waitForTimeout(450);
    expect(routeCalls(writes)).toHaveLength(0);
    await dialog.getByRole("button", { name: "Lagre tur" }).click();
    await expect.poll(() => rpcBody(writes, "correct_mileage_trip")).toBeTruthy();
    expect(rpcBody(writes, "correct_mileage_trip")).toMatchObject({
      requested_trip_id: ELECTRIC_ID, requested_toll_amount_minor: 1300, requested_toll_estimated: true,
      requested_vehicle_type: "electric", requested_uses_autopass: false, requested_include_tolls: true,
    });
    // An older trip with null choices opens as fossil / on / on, and a change re-estimates for that trip.
    await page.goto("/portal/#okonomi/kjorebok");
    await page.locator("li.pt-row").filter({ hasText: "Bomveien 2" }).getByRole("button", { name: "Rediger" }).click();
    dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Rediger kjøretur" }) });
    opts = optionsOf(dialog);
    await expect(opts.getByRole("radio", { name: "Fossil" })).toHaveAttribute("aria-checked", "true");
    await expect(opts.getByRole("switch", { name: "Bruker AutoPASS-brikke" })).toBeChecked();
    await expect(opts.getByRole("switch", { name: "Ta med bompenger" })).toBeChecked();
    await opts.getByRole("radio", { name: "Elbil" }).click();
    await expect(dialog.getByLabel("Bompenger (beregnet)")).toHaveValue("13,00");
    expect(routeCalls(writes).at(-1).body).toMatchObject({ from_address: "Hjemme", to_address: "Bomveien 2", tolls: true, vehicle_type: "electric" });
    await expect(dialog.getByLabel("Kilometer")).toHaveValue("20");
    await dialog.getByRole("button", { name: "Lagre tur" }).click();
    await expect.poll(() => rpcBody(writes, "correct_mileage_trip")?.requested_trip_id).toBe(TOLL_ID);
    expect(rpcBody(writes, "correct_mileage_trip")).toMatchObject({ requested_vehicle_type: "electric", requested_uses_autopass: true, requested_include_tolls: true, requested_toll_amount_minor: 1300 });
    expect(writes.some((w) => w.path.endsWith("/rpc/set_mileage_toll_settings"))).toBe(false);
    expect(errors).toEqual([]);
  });

  test("Rediger with «Ta med bompenger» off sends include_tolls=false and clears the toll (iOS #1619)", async ({ page }) => {
    const { writes } = await openMileage(page);
    await page.locator("li.pt-row").filter({ hasText: "Bomveien 2" }).getByRole("button", { name: "Rediger" }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Rediger kjøretur" }) });
    await optionsOf(dialog).getByRole("switch", { name: "Ta med bompenger" }).click();
    await expect(dialog.getByLabel(/^Bompenger/)).toBeHidden();
    await dialog.getByRole("button", { name: "Lagre tur" }).click();
    await expect.poll(() => rpcBody(writes, "correct_mileage_trip")).toBeTruthy();
    expect(rpcBody(writes, "correct_mileage_trip")).toMatchObject({ requested_include_tolls: false, requested_toll_amount_minor: 0, requested_toll_estimated: false, requested_vehicle_type: "fossil", requested_uses_autopass: true });
  });

  test("Kjørebok never reads or writes the global toll settings (iOS #1619)", async ({ page }) => {
    const requests = [];
    const { errors } = await openMileage(page, { requests });
    await newTrip(page);
    expect(requests.some((r) => r.path.includes("mileage_toll_settings"))).toBe(false);
    expect(errors).toEqual([]);
  });

  // iOS #1600: calendar per room.
  const newEventDialog = async (page) => {
    await page.getByRole("link", { name: "Kalender", exact: true }).click();
    await page.getByRole("button", { name: "+ Ny hendelse" }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Ny hendelse" }) });
    await dialog.getByLabel("Tittel").fill("Felles vask");
    await dialog.getByLabel("Dato").fill("2026-11-20");
    return dialog;
  };
  // iOS #1602: one «Krever svar fra leietaker» card; «Hvem skal svare?» appears when it is on.
  const rrCard = (dialog) => ({
    toggle: dialog.getByRole("switch", { name: /Krever svar fra leietaker/ }),
    who: dialog.getByText("Hvem skal svare?", { exact: true }),
    all: dialog.getByTestId("calendar.form.respondents.all"),
    select: dialog.getByTestId("calendar.form.respondents.select"),
    room: (id) => dialog.getByTestId(`calendar.form.room.${id.toUpperCase()}`),
  });
  const createBody = (writes) => writes.find((w) => w.path.endsWith("/rpc/create_calendar_item_v2"))?.body;
  test("«Krever svar fra leietaker» is one card, on by default with «Alle leietakere» (iOS #1602)", async ({ page }) => {
    const { writes, errors } = await openPortal(page, { handover: readyToEndTables() });
    const dialog = await newEventDialog(page);
    const card = rrCard(dialog);
    await expect(card.toggle).toBeChecked();
    await expect(dialog.getByText("Leietakere må godkjenne eller avslå hendelsen.")).toBeVisible();
    await expect(card.who).toBeVisible();
    await expect(card.all).toBeChecked();
    await expect(card.select).not.toBeChecked();
    await expect(dialog.locator(".pt-rr-option.is-selected")).toHaveText("Alle leietakere");
    await expect(card.room(READY_A)).toBeHidden();
    // The old «Gjelder» picker is gone, and there is no native select.
    await expect(dialog.getByText("Gjelder", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("checkbox", { name: "Alle rom" })).toHaveCount(0);
    await expect(page.locator("select")).toHaveCount(0);
    // Off hides the rest of the card and sends false for the whole home.
    await card.toggle.click();
    await expect(card.toggle).not.toBeChecked();
    await expect(card.who).toBeHidden();
    await expect(card.all).toBeHidden();
    await dialog.getByRole("button", { name: "Legg i kalenderen" }).click();
    await expect.poll(() => createBody(writes)).toBeTruthy();
    const body = createBody(writes);
    expect(body.requested_requires_response).toBe(false);
    expect(body.requested_audience_tenancy_ids).toBeNull();
    expect(body.requested_shared_with_property).toBe(true);
    expect(writes.some((w) => w.path.endsWith("/rpc/create_calendar_item"))).toBe(false);
    expect(writes.some((w) => /calendar_item_audience|calendar_item_room_responses/.test(w.path) && !w.path.includes("/rpc/"))).toBe(false);
    // Maintenance hides the whole card (forced on).
    await page.getByRole("button", { name: "+ Ny hendelse" }).click();
    const again = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Ny hendelse" }) });
    await again.getByText("Merk som vedlikeholdssak").click();
    await expect(rrCard(again).toggle).toBeHidden();
    await expect(again.getByText("Krever svar fra leietaker")).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("on with «Alle leietakere» sends true for the whole home (iOS #1602)", async ({ page }) => {
    const { writes, errors } = await openPortal(page, { handover: readyToEndTables() });
    const dialog = await newEventDialog(page);
    await dialog.getByRole("button", { name: "Legg i kalenderen" }).click();
    await expect.poll(() => createBody(writes)).toBeTruthy();
    expect(createBody(writes).requested_requires_response).toBe(true);
    expect(createBody(writes).requested_audience_tenancy_ids).toBeNull();
    expect(errors).toEqual([]);
  });

  test("«Velg leietakere» lists «Rom N – Navn», needs one room, and sends the chosen tenancies (iOS #1602)", async ({ page }) => {
    const tables = readyToEndTables();
    tables.manual_occupants = [{ id: "a0a0a0a0-0000-4000-8000-0000000000c1", property_id: PROPERTY_ID, tenancy_id: READY_C, display_name: "Per Hansen", phone: null, party_role: "tenant", claimed_user_id: null }];
    const { writes, errors } = await openPortal(page, { handover: tables });
    const dialog = await newEventDialog(page);
    const card = rrCard(dialog);
    await card.select.click();
    await expect(card.select).toBeChecked();
    await expect(dialog.locator(".pt-rr-option.is-selected")).toHaveText("Velg leietakere");
    const rows = dialog.locator(".pt-rr-room");
    await expect(rows).toHaveText(["Rom 1 – Kari Nordmann, Ola Nordmann", "Rom 2", "Rom 3 – Per Hansen"]);
    await expect(dialog.getByText(/@/)).toHaveCount(0);
    await expect(dialog.getByText("12345678901")).toHaveCount(0);
    const save = dialog.getByRole("button", { name: "Legg i kalenderen" });
    await expect(save).toBeDisabled();
    await card.room(READY_C).click();
    await card.room(READY_A).click();
    await expect(save).toBeEnabled();
    await card.room(READY_A).click();
    await card.room(READY_A).click();
    await save.click();
    await expect.poll(() => createBody(writes)).toBeTruthy();
    expect(createBody(writes).requested_audience_tenancy_ids).toEqual([READY_A, READY_C].sort());
    expect(createBody(writes).requested_requires_response).toBe(true);
    expect(errors).toEqual([]);
  });

  test("a server without create_calendar_item_v2 falls back to create_calendar_item (iOS #1600)", async ({ page }) => {
    const { writes, errors } = await openPortal(page, { missingRpc: ["create_calendar_item_v2"] });
    const dialog = await newEventDialog(page);
    await dialog.getByRole("switch", { name: /Krever svar/ }).click();
    await dialog.getByRole("button", { name: "Legg i kalenderen" }).click();
    await expect.poll(() => writes.find((w) => w.path.endsWith("/rpc/create_calendar_item"))).toBeTruthy();
    const old = writes.find((w) => w.path.endsWith("/rpc/create_calendar_item")).body;
    expect(old.requested_requires_response).toBeUndefined();
    expect(old.requested_audience_tenancy_ids).toBeUndefined();
    await expect(page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Ny hendelse" }) })).toHaveCount(0);
    await expect(page.getByText(/PGRST202|schema cache/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("landlord sees «X av Y har godtatt», each room and «Foreslå ny tid» (iOS #1600)", async ({ page }) => {
    const { writes, errors } = await openPortal(page, { handover: roomCalendarTables() });
    await page.goto(`/portal/#kalender/${ROOM_EVENT_ID}`);
    await expect(page.getByText("1 av 3 har godtatt")).toBeVisible();
    const rooms = page.locator(".pt-cal-room");
    await expect(rooms).toHaveCount(3);
    await expect(rooms.nth(0)).toContainText("Rom 1Godtatt");
    await expect(rooms.nth(1)).toContainText("Rom 2Avslått");
    await expect(rooms.nth(1)).toContainText("Passer ikke");
    await expect(rooms.nth(2)).toContainText("Rom 3Ikke svart");
    await expect(page.getByText("Leietaker har avslått")).toHaveCount(0);
    await page.getByRole("button", { name: "Foreslå ny tid" }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Ny tid" }) });
    await dialog.getByLabel("Dato").fill("2026-11-21");
    await dialog.getByLabel("Klokkeslett").fill("12:00");
    await dialog.getByRole("button", { name: "Foreslå ny tid" }).click();
    await expect.poll(() => writes.find((w) => w.path.endsWith("/rpc/propose_calendar_item_new_time_v1"))).toBeTruthy();
    expect(writes.find((w) => w.path.endsWith("/rpc/propose_calendar_item_new_time_v1")).body).toEqual({
      requested_calendar_item_id: ROOM_EVENT_ID, requested_starts_at: "2026-11-21T11:00:00Z", requested_due_at: null,
      requested_ends_at: "2026-11-21T12:30:00Z", requested_all_day: false,
    });
    await expect(page.getByText("Ny tid er sendt til rommene som avslo.")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a failed proposal says «Kunne ikke foreslå ny tid.» (iOS #1600)", async ({ page }) => {
    await openPortal(page, { handover: roomCalendarTables(), fail: ["propose_calendar_item_new_time_v1"] });
    await page.goto(`/portal/#kalender/${ROOM_EVENT_ID}`);
    await page.getByRole("button", { name: "Foreslå ny tid" }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Ny tid" }) });
    await dialog.getByRole("button", { name: "Foreslå ny tid" }).click();
    await expect(dialog.getByText("Kunne ikke foreslå ny tid.")).toBeVisible();
  });

  test("an information event needs no reply, and the edit switch updates it via update_calendar_item_audience (iOS #1600)", async ({ page }) => {
    const { writes, errors } = await openPortal(page, { handover: roomCalendarTables({ requiresResponse: false }) });
    await page.goto(`/portal/#kalender/${ROOM_EVENT_ID}`);
    await expect(page.getByText("Dette er informasjon. Ingen svar trengs.")).toBeVisible();
    await expect(page.getByText("Venter på svar fra leietaker")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Foreslå ny tid" })).toHaveCount(0);
    await page.getByRole("button", { name: "Rediger", exact: true }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Endre hendelse" }) });
    const toggle = dialog.getByRole("switch", { name: /Krever svar fra leietaker/ });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await dialog.getByRole("button", { name: "Lagre endringer" }).click();
    await expect.poll(() => writes.find((w) => w.path.endsWith("/rpc/update_calendar_item_audience"))).toBeTruthy();
    expect(writes.find((w) => w.path.endsWith("/rpc/update_calendar_item_audience")).body).toEqual({
      requested_calendar_item_id: ROOM_EVENT_ID, requested_audience_tenancy_ids: [], requested_requires_response: true,
    });
    expect(writes.find((w) => w.path.endsWith("/rpc/update_calendar_item")).body.requested_title).toBe("Felles vask");
    expect(errors).toEqual([]);
  });

  for (const [name, options] of [["a regular home", {}], ["a bofellesskap with one named room", { handover: readyToEndTables({ count: 1 }) }]]) {
    test(`the card is only the switch for ${name} (iOS #1602)`, async ({ page }) => {
      const { writes } = await openPortal(page, options);
      const dialog = await newEventDialog(page);
      const card = rrCard(dialog);
      await expect(card.toggle).toBeVisible();
      await expect(card.toggle).toBeChecked();
      await expect(card.who).toHaveCount(0);
      await expect(card.select).toHaveCount(0);
      await dialog.getByRole("button", { name: "Legg i kalenderen" }).click();
      await expect.poll(() => createBody(writes)).toBeTruthy();
      expect(createBody(writes).requested_audience_tenancy_ids).toBeNull();
      expect(createBody(writes).requested_requires_response).toBe(true);
    });
  }

  // A saved two-room event in the shared fixture: rows on READY_A and READY_B.
  const savedRoomEvent = ({ requiresResponse = true } = {}) => {
    const shared = readyToEndTables();
    const cal = roomCalendarTables({ requiresResponse });
    const ids = [READY_A, READY_B];
    const rows = cal.rpc.list_calendar_item_responses_v2.slice(0, 2).map((r, i) => ({
      ...r, tenancy_id: ids[i], unit_label: `Rom ${i + 1}`, decision: null, comment: null,
      accepted_count: 0, declined_count: 0, unanswered_count: 2, recipient_count: 2, audience_restricted: true,
    }));
    return { ...shared, property_calendar_items: cal.property_calendar_items, rpc: { ...shared.rpc, ...cal.rpc, list_calendar_item_responses_v2: rows } };
  };
  const openEdit = async (page) => {
    await page.goto(`/portal/#kalender/${ROOM_EVENT_ID}`);
    await page.getByRole("button", { name: "Rediger", exact: true }).click();
    return page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Endre hendelse" }) });
  };
  test("Endre hendelse keeps saved rooms and sends a room change through update_calendar_item_audience (iOS #1602)", async ({ page }) => {
    const { writes, errors } = await openPortal(page, { handover: savedRoomEvent() });
    let dialog = await openEdit(page);
    let card = rrCard(dialog);
    await expect(card.toggle).toBeChecked();
    await expect(card.select).toBeChecked();
    await expect(card.room(READY_A)).toBeChecked();
    await expect(card.room(READY_B)).toBeChecked();
    await expect(card.room(READY_C)).not.toBeChecked();
    // A title change alone keeps the rooms: no audience call.
    await dialog.getByLabel("Tittel").fill("Felles vask og rydding");
    await dialog.getByRole("button", { name: "Lagre endringer" }).click();
    await expect.poll(() => writes.find((w) => w.path.endsWith("/rpc/update_calendar_item"))).toBeTruthy();
    await expect(dialog).toHaveCount(0);
    expect(writes.some((w) => w.path.endsWith("/rpc/update_calendar_item_audience"))).toBe(false);
    dialog = await openEdit(page);
    card = rrCard(dialog);
    // No room selected: «Lagre endringer» is disabled.
    await card.room(READY_A).click();
    await card.room(READY_B).click();
    await expect(dialog.getByRole("button", { name: "Lagre endringer" })).toBeDisabled();
    await card.room(READY_A).click();
    await card.room(READY_B).click();
    await card.room(READY_C).click();
    await dialog.getByRole("button", { name: "Lagre endringer" }).click();
    await expect.poll(() => writes.find((w) => w.path.endsWith("/rpc/update_calendar_item_audience"))).toBeTruthy();
    expect(writes.find((w) => w.path.endsWith("/rpc/update_calendar_item_audience")).body).toEqual({
      requested_calendar_item_id: ROOM_EVENT_ID, requested_audience_tenancy_ids: [READY_A, READY_B, READY_C].sort(), requested_requires_response: true,
    });
    expect(writes.some((w) => /\/rest\/v1\/calendar_item_(audience|room_responses)/.test(w.path))).toBe(false);
    expect(errors).toEqual([]);
  });

  test("a legacy info event for some rooms shows «Gjelder bare» and keeps its rooms when saved off (iOS #1602)", async ({ page }) => {
    const { writes, errors } = await openPortal(page, { handover: savedRoomEvent({ requiresResponse: false }) });
    let dialog = await openEdit(page);
    let card = rrCard(dialog);
    await expect(card.toggle).not.toBeChecked();
    await expect(dialog.getByText("Gjelder bare: Rom 1, Rom 2")).toBeVisible();
    await expect(card.who).toBeHidden();
    await dialog.getByLabel("Tittel").fill("Felles vask og rydding");
    await dialog.getByRole("button", { name: "Lagre endringer" }).click();
    await expect.poll(() => writes.find((w) => w.path.endsWith("/rpc/update_calendar_item"))).toBeTruthy();
    await expect(dialog).toHaveCount(0);
    expect(writes.some((w) => w.path.endsWith("/rpc/update_calendar_item_audience"))).toBe(false);
    // Turning it on preselects «Velg leietakere» with the same rooms.
    dialog = await openEdit(page);
    card = rrCard(dialog);
    await card.toggle.click();
    await expect(dialog.getByText("Gjelder bare: Rom 1, Rom 2")).toBeHidden();
    await expect(card.select).toBeChecked();
    await expect(card.room(READY_A)).toBeChecked();
    await expect(card.room(READY_B)).toBeChecked();
    await dialog.getByRole("button", { name: "Lagre endringer" }).click();
    await expect.poll(() => writes.find((w) => w.path.endsWith("/rpc/update_calendar_item_audience"))).toBeTruthy();
    expect(writes.find((w) => w.path.endsWith("/rpc/update_calendar_item_audience")).body).toEqual({
      requested_calendar_item_id: ROOM_EVENT_ID, requested_audience_tenancy_ids: [READY_A, READY_B].sort(), requested_requires_response: true,
    });
    expect(errors).toEqual([]);
  });

  test("a missing update_calendar_item_audience still saves the edit (iOS #1600 fallback)", async ({ page }) => {
    const { writes, errors } = await openPortal(page, { handover: savedRoomEvent(), missingRpc: ["update_calendar_item_audience"] });
    const dialog = await openEdit(page);
    await rrCard(dialog).all.click();
    await dialog.getByRole("button", { name: "Lagre endringer" }).click();
    await expect.poll(() => writes.find((w) => w.path.endsWith("/rpc/update_calendar_item_audience"))).toBeTruthy();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Hendelsen er oppdatert.")).toBeVisible();
    await expect(page.getByText(/PGRST202|schema cache/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  // iOS #1597: one «Klar til å avslutte» card per ready tenancy.
  const readyCard = (page, id) => page.getByTestId(`tenancy.readyToEnd.${id.toUpperCase()}`);
  test("bofellesskap shows one ready card per room and ends only that tenancy (iOS #1597)", async ({ page }) => {
    const { writes, errors } = await openPortal(page, { handover: readyToEndTables() });
    const a = readyCard(page, READY_A);
    const b = readyCard(page, READY_B);
    await expect(a).toBeVisible();
    await expect(b).toBeVisible();
    await expect(readyCard(page, READY_C)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Klar til å avslutte leieforholdet" })).toHaveCount(2);
    await expect(a.getByTestId(`tenancy.readyToEnd.subject.${READY_A.toUpperCase()}`)).toHaveText("Rom 1 – Kari Nordmann, Ola Nordmann");
    await expect(b.getByTestId(`tenancy.readyToEnd.subject.${READY_B.toUpperCase()}`)).toHaveText("Rom 2");
    await expect(page.getByText("12345678901")).toHaveCount(0);
    await expect(a.getByText("Utflyttingen og depositumsoppgjøret er godkjent av begge parter. Når du avslutter, flyttes dette leieforholdet til Tidligere leieforhold, og rommet blir ledig for en ny leietaker.")).toBeVisible();
    await expect(b.getByText(/depositumsoppgjøret ble hoppet over\. Når du avslutter, flyttes dette leieforholdet .* rommet blir ledig for en ny leietaker\./)).toBeVisible();
    await expect(a.getByRole("button", { name: "Gjør det senere" })).toBeVisible();
    await a.getByRole("button", { name: "Avslutt leieforholdet" }).click();
    const confirm = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Er du sikker?" }) });
    await expect(confirm.getByText("Dette kan ikke angres.")).toBeVisible();
    await confirm.getByRole("button", { name: "Avslutt", exact: true }).click();
    await expect.poll(() => writes.filter((w) => w.path.endsWith("/rpc/complete_move_out")).length).toBe(1);
    expect(writes.filter((w) => w.path.endsWith("/rpc/complete_move_out")).map((w) => w.body)).toEqual([{ p_process_id: READY_PROCESS_A }]);
    expect(errors).toEqual([]);
  });

  test("«Gjør det senere» hides only that card on Oversikt; Om boligen still shows it (iOS #1597)", async ({ page }) => {
    const { errors } = await openPortal(page, { handover: readyToEndTables() });
    await readyCard(page, READY_A).getByRole("button", { name: "Gjør det senere" }).click();
    await expect(readyCard(page, READY_A)).toHaveCount(0);
    await expect(readyCard(page, READY_B)).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), `tenancy.readyToEnd.postponed.${READY_A.toUpperCase()}`)).toBe("true");
    await page.reload();
    await expect(readyCard(page, READY_B)).toBeVisible();
    await expect(readyCard(page, READY_A)).toHaveCount(0);
    await page.getByRole("link", { name: "Om boligen", exact: true }).click();
    await expect(readyCard(page, READY_A)).toBeVisible();
    await expect(readyCard(page, READY_A).getByRole("button", { name: "Gjør det senere" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a regular home shows the name only and the home copy (iOS #1597)", async ({ page }) => {
    const { errors } = await openPortal(page, { handover: readyToEndTables({ housingKind: "standard", count: 1 }) });
    const a = readyCard(page, READY_A);
    await expect(a.getByTestId(`tenancy.readyToEnd.subject.${READY_A.toUpperCase()}`)).toHaveText("Kari Nordmann, Ola Nordmann");
    await expect(a.getByText(/og boligen blir ledig for nye leietakere\./)).toBeVisible();
    expect(errors).toEqual([]);
  });

  // iOS #1611 (DEPOSIT_SETTLEMENT_NAV_AFTER_SEND): a successful send lands on the hub, same tenancy.
  const depositSnap = (status, claims) => ({
    id: "d4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4", status, deposit_amount_minor: 3_000_000, security_type: "deposit",
    claims: claims ? [{ id: "c1c1c1c1-0000-4000-8000-000000000001", description: "Vask", amount_minor: 200_000, position: 0 }] : [],
  });
  for (const [name, status, claims, buttonName, confirm, rpc] of [
    ["approve without claims", "open", false, "Godkjenn og send til leietaker", "Godkjenn", "approve_deposit_full_refund"],
    ["first send of claims", "open", true, "Send krav til leietaker", "Send", "submit_deposit_settlement_claims"],
    ["send again after changed claims", "declined", true, "Send krav til leietaker", "Send", "submit_deposit_settlement_claims"],
  ]) {
    test(`deposit settlement: ${name} returns to «Inn- og utflytting» (iOS #1611)`, async ({ page }) => {
      const tables = handoverTables({ status });
      const { writes, errors } = await openPortal(page, { handover: { ...tables, rpc: { ...(tables.rpc ?? {}), open_deposit_settlement: depositSnap(status, claims) } } });
      await page.goto("/portal/#inn-utflytting/depositum");
      await page.getByRole("button", { name: buttonName }).click();
      await page.getByRole("dialog").getByRole("button", { name: confirm, exact: true }).click();
      await expect.poll(() => writes.some((w) => w.path.endsWith(`/rpc/${rpc}`))).toBe(true);
      await expect(page).toHaveURL(/#inn-utflytting$/);
      for (const tile of ["Innflytting", "Utflytting", "Depositumsoppgjør"]) await expect(page.locator("a.pt-ho-tile").filter({ hasText: tile }).first()).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
  test("a failed deposit send stays on the settlement page (iOS #1611)", async ({ page }) => {
    const tables = handoverTables({ status: "open" });
    await openPortal(page, { handover: { ...tables, rpc: { ...(tables.rpc ?? {}), open_deposit_settlement: depositSnap("open", true) } }, fail: ["submit_deposit_settlement_claims"] });
    await page.goto("/portal/#inn-utflytting/depositum");
    await page.getByRole("button", { name: "Send krav til leietaker" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("button", { name: "Send krav til leietaker" })).toBeVisible();
    await expect(page).toHaveURL(/#inn-utflytting\/depositum$/);
  });

  // iOS #1595: every ready checklist photo in the move-in/move-out collections, landlord and tenant alike.
  const photoSrcs = (strip) => strip.locator("img").evaluateAll((imgs) => imgs.map((i) => i.getAttribute("src")));
  const expected = (...ns) => ns.map((n) => handoverImageBytes(`handover/${n}.jpg`).toString("base64"));
  const expectPhotos = async (strip, ns) => {
    await expect(strip.locator("img")).toHaveCount(ns.length);
    const srcs = await photoSrcs(strip);
    srcs.forEach((src) => expect(src.startsWith("data:")).toBe(true));
    expect(srcs.map((src) => src.split(",")[1])).toEqual(expected(...ns));
  };

  for (const status of ["open", "accepted"]) {
    test(`deposit settlement compares checklist photos from landlord and tenant (${status})`, async ({ page }) => {
      const stats = {};
      const requests = [];
      const { errors } = await openPortal(page, { handover: handoverTables({ status }), stats, requests, delayStorage: 80 });
      await page.goto("/portal/#inn-utflytting/depositum");
      const card = page.locator(".pt-card").filter({ has: page.getByRole("heading", { name: "Innflytting og utflytting" }) });
      await expect(card).toBeVisible();
      await expect(card.getByText("Sjekk vegger – hull og merker")).toBeVisible();
      await expect(card.getByText("Innflytting · Utført").first()).toBeVisible();
      // Baseline on the move-out row, and the move-in point (another key) as its own row.
      await expect(card.getByText("Liten flekk i stua")).toHaveCount(2);
      await expect(card.getByText("Kontroller vegger og gulv for skader")).toBeVisible();
      await expect(card.getByText("Utflytting · Ikke utført")).toBeVisible();
      await expect(card.getByText("Hull etter bilde")).toBeVisible();
      // Tenant photo (older) before landlord photo; pending, deleted, unknown key, bad uuid,
      // other collection and the repeated storage path are left out.
      await expectPhotos(card.getByLabel("Kontroller vegger og gulv for skader, innflytting", { exact: true }), [1, 3]);
      await expectPhotos(card.getByLabel("Sjekk vegger – hull og merker, utflytting", { exact: true }), [4, 5]);
      await expect(card.getByText("Innflytting · 12345")).toBeVisible();
      await expect(card.getByText("Utflytting · 15000")).toBeVisible();
      await expectPhotos(card.getByLabel("Strøm (kWh), innflytting", { exact: true }), [2]);
      await expectPhotos(card.getByLabel("Strøm (kWh), utflytting", { exact: true }), [6]);
      const read = requests.find((r) => r.method === "GET" && r.path.endsWith("/property_images"));
      expect(read.select).toBe("id,collection_id,caption,storage_path,status,created_at");
      const downloads = requests.filter((r) => r.path.includes("/property-images/"));
      expect(new Set(downloads.map((r) => r.path)).size).toBe(downloads.length);
      expect(stats.maxPropertyImages).toBeLessThanOrEqual(3);
      await card.getByRole("button", { name: "Sjekk vegger – hull og merker, utflytting, bilde 2 av 2" }).click();
      const viewer = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Sjekk vegger – hull og merker, utflytting" }) });
      await expect(viewer.getByText("2 av 2")).toBeVisible();
      await expect(viewer.getByRole("button", { name: "Fjern dette bildet" })).toHaveCount(0);
      await viewer.getByRole("button", { name: "Ferdig" }).click();
      expect(errors).toEqual([]);
    });
  }

  test("checklist cards show photos on points and meter rows (iOS #1595)", async ({ page }) => {
    const { errors } = await openPortal(page, { handover: handoverTables() });
    await page.goto("/portal/#inn-utflytting/utflytting");
    const shared = page.locator(".pt-card").filter({ has: page.getByRole("heading", { name: "Nøkler, målere og sjekkpunkter" }) });
    await expectPhotos(shared.getByLabel("Sjekk vegger – hull og merker", { exact: true }), [4, 5]);
    await expectPhotos(shared.getByLabel("Strøm (kWh)", { exact: true }), [2, 6]);
    await expect(page.getByText("Nøkler, målerstander og bilder registreres i appen.")).toHaveCount(0);
    await page.goto("/portal/#inn-utflytting/innflytting");
    const inCard = page.locator(".pt-card").filter({ has: page.getByRole("heading", { name: "Nøkler, målere og sjekkpunkter" }) });
    await expectPhotos(inCard.getByLabel("Kontroller vegger og gulv for skader", { exact: true }), [1, 3]);
    await expectPhotos(inCard.getByLabel("Strøm (kWh)", { exact: true }), [2]);
    expect(errors).toEqual([]);
  });

  test("own home asks whether you use at least half and sends uses_at_least_half (iOS #1591)", async ({ page }) => {
    const { writes, errors } = await openPortal(page, {
      taxFacts: [{ property_id: PROPERTY_ID, home_use: "own_home", rental_duration: "short_term", uses_at_least_half: null }],
    });
    await page.getByRole("link", { name: "Om boligen", exact: true }).click();
    await page.getByRole("button", { name: "Rediger informasjon" }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Rediger informasjon" }) });
    const question = dialog.getByRole("button", { name: /Bruker du minst halvparten av boligen selv\?/ });
    await expect(question).toBeVisible();
    await dialog.getByRole("button", { name: "Lagre endringer" }).click();
    await expect(dialog.getByText("Velg om du bruker minst halvparten av boligen selv.")).toBeVisible();
    expect(writes.find((entry) => entry.method === "PATCH" && entry.path.includes("/properties"))).toBeFalsy();
    await question.click();
    await dialog.getByRole("option", { name: "Ja", exact: true }).click();
    await dialog.getByRole("button", { name: "Lagre endringer" }).click();
    await expect.poll(() => writes.find((entry) => entry.method === "PATCH" && entry.path.includes("/properties"))).toBeTruthy();
    const saved = writes.find((entry) => entry.method === "PATCH" && entry.path.includes("/properties"));
    expect(saved.body.rental_profile.home_use).toBe("own_home");
    expect(saved.body.rental_profile.rental_duration).toBe("short_term");
    expect(saved.body.rental_profile.uses_at_least_half).toBe(true);
    expect(errors).toEqual([]);
  });

  test("the half-use question is hidden for other property types", async ({ page }) => {
    const { writes } = await openPortal(page);
    await page.getByRole("link", { name: "Om boligen", exact: true }).click();
    await page.getByRole("button", { name: "Rediger informasjon" }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Rediger informasjon" }) });
    await expect(dialog.getByText("Bruker du minst halvparten av boligen selv?")).toBeHidden();
    await dialog.getByRole("button", { name: "Lagre endringer" }).click();
    await expect.poll(() => writes.find((entry) => entry.method === "PATCH" && entry.path.includes("/properties"))).toBeTruthy();
    const saved = writes.find((entry) => entry.method === "PATCH" && entry.path.includes("/properties"));
    expect(saved.body.rental_profile.home_use).toBe("other_home");
    expect(saved.body.rental_profile.uses_at_least_half).toBeNull();
  });

  test("a failed handbook read does not offer an empty editor", async ({ page }) => {
    await openPortal(page, { errorOn: ["property_handbook_sections"] });
    await page.getByRole("link", { name: "Boligperm", exact: true }).click();
    await expect(page.getByText("Boligpermen kunne ikke hentes akkurat nå.")).toBeVisible();
    const missing = page.locator(".pt-tile", { hasText: "Kunne ikke hentes" });
    await expect(missing.first()).toBeVisible();
    await expect(missing.getByRole("button", { name: "Rediger" })).toHaveCount(0);
  });

  test("boligperm values can be copied, called and mailed", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await openPortal(page, {
      handover: {
        property_handbook_sections: [
          { property_id: PROPERTY_ID, section_key: "wifi", is_enabled: true, body: "Nettverk: HjemmeNet\nPassord: hemmelig 123" },
          { property_id: PROPERTY_ID, section_key: "emergency", is_enabled: true, body: "Vakt: +47 412 34 567\nE-post: vakt@example.no\nRing +47 900 11 223 ved lekkasje." },
          { property_id: PROPERTY_ID, section_key: "keys_access", is_enabled: true, body: "Portkode: 4321\nAdresse: Testveien 1, 0150 Oslo" },
        ],
        property_handbook_settings: [{ property_id: PROPERTY_ID, metering_point_id: "707057500012345678", meter_number: "AB 12" }],
      },
    });
    await page.getByRole("link", { name: "Boligperm", exact: true }).click();

    const wifi = page.locator(".pt-tile", { hasText: "Wi-Fi" });
    await expect(wifi.getByText("HjemmeNet")).toBeVisible();
    await expect(wifi.getByText("hemmelig 123")).toBeVisible();
    await wifi.getByRole("button", { name: "Kopier Passord" }).click();
    await expect(wifi.getByRole("status").filter({ hasText: "Kopiert" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("hemmelig 123");

    const emergency = page.locator(".pt-tile", { hasText: "Nødinfo" });
    await expect(emergency.getByText("+47 412 34 567")).toBeVisible();
    const call = emergency.getByRole("link", { name: "Ring +47 412 34 567" });
    const sms = emergency.getByRole("link", { name: "Send SMS til +47 412 34 567" });
    await expect(call).toHaveAttribute("href", "tel:+4741234567");
    await expect(sms).toHaveAttribute("href", "sms:+4741234567");
    await expect(emergency.getByRole("link", { name: "vakt@example.no" })).toHaveAttribute("href", "mailto:vakt@example.no");
    await emergency.getByRole("button", { name: "Kopier E-post" }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("vakt@example.no");
    const inlineCall = emergency.getByRole("link", { name: "Ring +47 900 11 223" });
    await expect(inlineCall).toHaveAttribute("href", "tel:+4790011223");
    await expect(emergency.getByRole("link", { name: "Send SMS til +47 900 11 223" })).toHaveAttribute("href", "sms:+4790011223");

    const keys = page.locator(".pt-tile", { hasText: "Nøkler og adgang" });
    await keys.getByRole("button", { name: "Kopier Portkode" }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("4321");
    await expect(keys.getByRole("link", { name: "Ring 4321" })).toHaveCount(0);
    await keys.getByRole("button", { name: "Kopier Adresse" }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("Testveien 1, 0150 Oslo");

    const power = page.locator(".pt-tile", { hasText: "Strøm" });
    await expect(power.getByText("707057500012345678")).toBeVisible();
    await expect(power.getByRole("link", { name: /Ring/ })).toHaveCount(0);
    await power.getByRole("button", { name: "Kopier Målepunkt-ID" }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("707057500012345678");
    await power.getByRole("button", { name: "Kopier Målernummer" }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("AB 12");

    const empty = page.locator(".pt-tile", { hasText: "Stoppekran" });
    await expect(empty.getByText("Ikke fylt ut")).toBeVisible();
    await expect(empty.getByRole("button", { name: /Kopier/ })).toHaveCount(0);
  });

  test("saving a handbook section does not clear link_url", async ({ page }) => {
    const { writes } = await openPortal(page);
    await page.getByRole("link", { name: "Boligperm", exact: true }).click();
    await page.getByRole("button", { name: "Rediger" }).first().click();
    await page.getByLabel("Innhold").fill("Ring vaktmester.");
    await page.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect.poll(() => writes.find((entry) => String(entry.path).includes("property_handbook_sections"))).toBeTruthy();
    const saved = writes.find((entry) => String(entry.path).includes("property_handbook_sections"));
    expect(saved.body).not.toHaveProperty("link_url");
    expect(saved.body.body).toBe("Ring vaktmester.");
  });

  test("a failed membership read says the overview could not be loaded", async ({ page }) => {
    await openPortal(page, { fail: ["property_members"] });
    await expect(page.getByRole("heading", { name: "Vi fikk ikke hentet oversikten" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ny bolig" })).toHaveCount(0);
  });

  test("a failed tenancy read says the overview could not be loaded", async ({ page }) => {
    await openPortal(page, { fail: ["tenancies"] });
    await expect(page.getByRole("heading", { name: "Vi fikk ikke hentet oversikten" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Inviter leietaker" })).toHaveCount(0);
  });

  test("a late chat response does not replace the page you moved to", async ({ page }) => {
    await openPortal(page, {
      delayRpc: {
        provision_my_chat_conversations: 600,
        list_my_chat_conversations_v2: 600,
        list_my_property_chat_conversations_v2: 600,
      },
    });
    await page.getByRole("link", { name: "Meldinger", exact: true }).click();
    await page.getByRole("link", { name: "Oversikt", exact: true }).click();
    await expect(page.locator("[data-page-title]")).toHaveText("Oversikt");
    await page.waitForTimeout(900);
    await expect(page.locator("[data-page-title]")).toHaveText("Oversikt");
    await expect(page.locator(".pt-chat")).toHaveCount(0);
  });

  test("an unknown hash is replaced with oversikt", async ({ page }) => {
    await openPortal(page);
    await page.evaluate(() => { location.hash = "#finnes-ikke"; });
    await expect(page.locator("[data-page-title]")).toHaveText("Oversikt");
    await expect(page).toHaveURL(/#oversikt$/);
  });

  test("the portal stacks into a menu on a phone", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await openPortal(page);
    await portalReady(page);
    await page.screenshot({ path: "/opt/cursor/artifacts/portal-mobile.png" });
    const box = await page.locator(".pt-content").boundingBox();
    expect(box.width).toBeGreaterThan(300);
    const menu = page.getByRole("button", { name: "Meny" });
    await expect(menu).toBeVisible();
    await expect(page.getByRole("link", { name: "Økonomi", exact: true })).toBeHidden();
    await menu.click();
    await expect(page.getByRole("link", { name: "Økonomi", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Økonomi", exact: true }).click();
    await expect(page.locator("[data-page-title]")).toHaveText("Økonomi");
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    for (const [label, title] of PAGES) {
      await menu.click();
      await page.getByRole("link", { name: label, exact: true }).click();
      await expect(page.locator("[data-page-title]")).toHaveText(title);
      await expect(page.getByText("Noe gikk galt")).toHaveCount(0);
      await expect(menu).toHaveAttribute("aria-expanded", "false");
      const overflow = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const clipped = (el) => {
          for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
            const s = getComputedStyle(n).overflowX;
            if (s === "auto" || s === "scroll" || s === "hidden" || s === "clip") return true;
          }
          return false;
        };
        let worst = null;
        for (const el of document.querySelectorAll("body *")) {
          if (clipped(el)) continue;
          const r = el.getBoundingClientRect();
          const over = Math.ceil(r.right) - vw;
          if (over > 1 && (!worst || over > worst.over)) worst = { over, tag: el.tagName, cls: String(el.className).slice(0, 80), text: (el.innerText || "").slice(0, 60) };
        }
        return { scroll: document.documentElement.scrollWidth - vw, worst };
      });
      expect(overflow.scroll, `${title} ${JSON.stringify(overflow.worst)}`).toBeLessThanOrEqual(1);
    }
  });

  test("public pages fit a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const paths = ["/", "/personvern", "/vilkar/", "/vilkar", "/support/", "/slett-konto/", "/logg-inn/", "/landing-full.html", "/forhandsvisning", "/sporsmal-svar/", "/om-oss/", "/nope-not-a-page"];
    for (const path of paths) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
  });

  test("clicking the bell icon opens the panel and moves focus inside", async ({ page }) => {
    await openPortal(page);
    await page.getByRole("button", { name: "Varsler" }).click();
    const dialog = page.getByRole("dialog", { name: "Varsler" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Ingen varsler ennå")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[role=dialog]") != null)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Varsler" })).toHaveAttribute("aria-expanded", "false");
  });

  test("a failed save does not reveal the database message", async ({ page }) => {
    await openPortal(page, { errorOn: ["create_financial_transaction"] });
    await page.getByRole("link", { name: "Økonomi", exact: true }).click();
    await page.getByRole("button", { name: "Ny inntekt" }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Ny inntekt" }) });
    const category = dialog.getByRole("button", { name: /Kategori/ });
    await expect(category).toHaveAttribute("aria-controls", /pt-choice-/);
    await category.click();
    await dialog.getByRole("option", { name: "Annen inntekt", exact: true }).click();
    await dialog.getByLabel("Beløp").fill("1500");
    await dialog.getByLabel("Hva gjelder inntekten?").fill("Annet");
    await dialog.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(dialog.getByText("Det gikk ikke. Prøv igjen om litt.")).toBeVisible();
    await expect(dialog.getByText(/property_handbook_sections_pkey/)).toHaveCount(0);
  });

  test("a new all-day event is stored as midnight in Norway", async ({ page }) => {
    const { writes, errors } = await openPortal(page);
    await page.getByRole("link", { name: "Kalender", exact: true }).click();
    await page.getByRole("button", { name: "+ Ny hendelse" }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Ny hendelse" }) });
    await dialog.getByLabel("Tittel").fill("Visning");
    await dialog.getByLabel("Dato").fill("2026-11-15");
    await dialog.getByRole("button", { name: /Hele dagen/ }).click();
    await dialog.getByRole("option", { name: "Ja", exact: true }).click();
    await dialog.getByRole("button", { name: "Legg i kalenderen" }).click();
    await expect.poll(() => writes.find((entry) => entry.path.includes("create_calendar_item"))).toBeTruthy();
    const saved = writes.find((entry) => entry.path.includes("create_calendar_item"));
    expect(saved.body.requested_starts_at).toBe("2026-11-14T23:00:00Z");
    expect(saved.body.requested_all_day).toBe(true);
    expect(errors).toEqual([]);
  });

  test("a signed contract reads its change list once", async ({ page }) => {
    const requests = [];
    await openPortal(page, { requests, signedAgreement: true });
    await page.getByRole("link", { name: "Leiekontrakt", exact: true }).click();
    await expect(page.getByRole("button", { name: "Foreslå endringer" })).toBeVisible();
    await expect(page.getByText("Endring av kontrakten")).toBeVisible();
    const calls = requests.filter((entry) => entry.path.includes("list_rental_agreement_changes"));
    expect(calls).toHaveLength(1);
  });

  test("chat avatar lookups are reused for the session", async ({ page }) => {
    const requests = [];
    await openPortal(page, { requests, omitAvatars: true });
    const openChat = async () => {
      await page.getByRole("link", { name: "Meldinger", exact: true }).click();
      await expect(page.getByLabel("Melding")).toBeVisible();
    };
    await openChat();
    await page.getByRole("link", { name: "Oversikt", exact: true }).click();
    await expect(page.locator("[data-page-title]")).toHaveText("Oversikt");
    await openChat();
    const lookups = requests.filter((entry) => entry.path.includes("list_chat_counterpart_avatars"));
    const files = requests.filter((entry) => entry.path.includes("profile-avatars"));
    expect(lookups).toHaveLength(2);
    expect(files).toHaveLength(1);
  });

  test("gallery images download at most four at a time", async ({ page }) => {
    const requests = [];
    const stats = { inflight: 0, maxPropertyImages: 0 };
    await openPortal(page, { requests, stats, gallery: true, delayStorage: 200 });
    await page.getByRole("link", { name: "Boligbilder", exact: true }).click();
    await expect(page.getByText("6 av 12 bilder")).toBeVisible();
    await expect.poll(() => requests.filter((entry) => entry.path.includes("/property-images/")).length).toBe(6);
    expect(stats.maxPropertyImages).toBeLessThanOrEqual(4);
    expect(stats.maxPropertyImages).toBeGreaterThan(1);
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
