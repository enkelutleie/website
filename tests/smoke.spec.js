import { expect, test } from "@playwright/test";
import { installSupabase } from "./supabase-mock.js";

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

  test("a failed handbook read does not offer an empty editor", async ({ page }) => {
    await openPortal(page, { errorOn: ["property_handbook_sections"] });
    await page.getByRole("link", { name: "Boligperm", exact: true }).click();
    await expect(page.getByText("Boligpermen kunne ikke hentes akkurat nå.")).toBeVisible();
    const missing = page.locator(".pt-tile", { hasText: "Kunne ikke hentes" });
    await expect(missing.first()).toBeVisible();
    await expect(missing.getByRole("button", { name: "Rediger" })).toHaveCount(0);
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
    const paths = ["/", "/personvern", "/support/", "/slett-konto/", "/logg-inn/", "/landing-full.html", "/forhandsvisning", "/sporsmal-svar/", "/om-oss/", "/nope-not-a-page"];
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
