import { expect, test } from "@playwright/test";
import { installSupabase } from "./supabase-mock.js";
import { INSPECTION_COLUMNS } from "../src/portal-actions.js";

// Request counts against the mock, in one signed-in session. The first Oversikt
// includes the shell. Later pages are the extra reads for opening that page.
// Nothing is forwarded to Production.

const keyOf = (req) => {
  const path = req.path.replace(/^\/rest\/v1\//, "").replace(/^\/storage\/v1\/object\//, "storage/");
  return `${req.method} ${decodeURIComponent(path)}`;
};

const tally = (rows) => {
  const counts = {};
  for (const row of rows) counts[keyOf(row)] = (counts[keyOf(row)] ?? 0) + 1;
  return counts;
};

const count = (rows, key) => rows.filter((row) => keyOf(row) === key).length;

async function settle(page, title) {
  await expect(page.locator("[data-page-title]")).toHaveText(title);
  await expect(page.locator("[data-portal]")).toHaveAttribute("aria-busy", "false");
  await page.waitForTimeout(400);
}

test("portal pages reuse the session and realtime bursts reload once", async ({ page }) => {
  const requests = [];
  await page.addInitScript(() => sessionStorage.setItem("pt-measure", "1"));
  await installSupabase(page, { requests, gallery: true });

  const take = async (fn) => {
    const before = requests.length;
    await fn();
    return requests.slice(before);
  };

  const oversikt = await take(async () => {
    await page.goto("/portal/#oversikt");
    await settle(page, "Oversikt");
  });
  const bolig = await take(async () => {
    await page.getByRole("link", { name: "Om boligen", exact: true }).click();
    await settle(page, "Om boligen");
  });
  const kontrakt = await take(async () => {
    await page.getByRole("link", { name: "Leiekontrakt", exact: true }).click();
    await settle(page, "Leiekontrakt");
  });
  const meldinger = await take(async () => {
    await page.getByRole("link", { name: "Meldinger", exact: true }).click();
    await settle(page, "Meldinger");
  });
  const kalender = await take(async () => {
    await page.getByRole("link", { name: "Kalender", exact: true }).click();
    await settle(page, "Kalender");
  });
  const okonomi = await take(async () => {
    await page.getByRole("link", { name: "Økonomi", exact: true }).click();
    await settle(page, "Økonomi");
  });
  const varsler = await take(async () => {
    await page.getByRole("button", { name: /Varsler/ }).click();
    await settle(page, "Økonomi");
  });
  const again = await take(async () => {
    await page.getByRole("link", { name: "Oversikt", exact: true }).click();
    await settle(page, "Oversikt");
    await page.getByRole("link", { name: "Om boligen", exact: true }).click();
    await settle(page, "Om boligen");
    await page.getByRole("link", { name: "Meldinger", exact: true }).click();
    await settle(page, "Meldinger");
  });

  const bellBurst = await take(async () => {
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) window.__ptMeasure.pokeBell();
    });
    await page.waitForTimeout(1400);
  });
  await page.getByRole("link", { name: "Meldinger", exact: true }).click();
  await settle(page, "Meldinger");
  const chatBurst = await take(async () => {
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) window.__ptMeasure.pokeChat();
    });
    await page.waitForTimeout(1400);
  });

  await page.goto("/portal/#kalender");
  await settle(page, "Kalender");
  const detail = await take(async () => {
    await page.getByRole("link", { name: /Visning/ }).click();
    await settle(page, "Kalender");
  });

  const handover = await take(async () => {
    await page.goto("/portal/#inn-utflytting");
    await settle(page, "Inn- og utflytting");
  });
  const inspectionSelect = handover.find((row) => keyOf(row) === "GET inspections")?.select;

  console.log(`LOAD_COUNTS ${JSON.stringify({
    Oversikt: { total: oversikt.length, counts: tally(oversikt) },
    Bolig: { total: bolig.length, counts: tally(bolig) },
    Kontrakt: { total: kontrakt.length, counts: tally(kontrakt) },
    Meldinger: { total: meldinger.length, counts: tally(meldinger) },
    Kalender: { total: kalender.length, counts: tally(kalender) },
    Okonomi: { total: okonomi.length, counts: tally(okonomi) },
    Varsler: { total: varsler.length, counts: tally(varsler) },
    again: { total: again.length, counts: tally(again) },
    bellBurst: tally(bellBurst),
    chatBurst: tally(chatBurst),
    inspectionSelect,
  })}`);

  expect(count(oversikt, "POST rpc/get_property_home_guide_completed")).toBe(1);
  expect(count(again, "POST rpc/get_property_home_guide_completed")).toBe(0);
  expect(count(again, "GET image_collections")).toBe(0);
  expect(count(again, "GET property_images")).toBe(0);
  expect(count(again, "GET storage/property-images/gallery/0.jpg")).toBe(0);
  expect(count(again, "POST rpc/provision_my_chat_conversations")).toBe(0);
  expect(count(again, "POST rpc/list_calendar_item_responses")).toBe(0);
  expect(count(kalender, "POST rpc/list_calendar_items_for_property")).toBe(0);
  expect(count(bellBurst, "POST rpc/list_my_notifications")).toBe(1);
  expect(count(chatBurst, "POST rpc/list_chat_messages_before")).toBe(1);
  expect(count(chatBurst, "POST rpc/list_chat_peer_read_cursors")).toBe(1);
  expect(inspectionSelect).toBe(INSPECTION_COLUMNS.replaceAll(" ", ""));
  expect(oversikt).toHaveLength(17);
  expect(bolig).toHaveLength(5);
  expect(kontrakt).toHaveLength(1);
  expect(meldinger).toHaveLength(7);
  expect(kalender).toHaveLength(0);
  expect(okonomi).toHaveLength(1);
  expect(varsler).toHaveLength(1);
  // Oversikt and Bolig again add nothing. Meldinger again keeps the live inbox reads only.
  expect(again).toHaveLength(4);
  expect(count(detail, "POST rpc/list_calendar_items_for_property")).toBe(0);
  expect(count(detail, "GET property_calendar_items")).toBe(1);
});

test("a fixed-term contract shorter than a year is rejected in Norwegian", async ({ page }) => {
  const writes = [];
  await installSupabase(page, { writes });
  await page.goto("/portal/#leiekontrakt");
  await expect(page.locator("[data-page-title]")).toHaveText("Leiekontrakt");
  await page.getByRole("button", { name: "Opprett leiekontrakt" }).click();
  await page.getByRole("button", { name: "Avtaletype: Løpende" }).click();
  await page.getByRole("option", { name: "Fast periode" }).click();
  await page.locator("input[name=start]").fill("2026-01-15");
  await page.locator("input[name=end]").fill("2026-06-01");
  await page.getByRole("button", { name: "Lagre utkast" }).click();
  await expect(page.getByRole("alert")).toHaveText("En tidsbestemt leieavtale må vare i minst 1 år.");
  expect(writes.some((entry) => String(entry.path).includes("create_rental_agreement_draft"))).toBe(false);
  await page.locator("input[name=end]").fill("2027-01-15");
  await page.getByRole("button", { name: "Lagre utkast" }).click();
  await expect(page.getByRole("heading", { name: "Ny leiekontrakt" })).toHaveCount(0);
  expect(writes.some((entry) => String(entry.path).includes("create_rental_agreement_draft"))).toBe(true);
});
