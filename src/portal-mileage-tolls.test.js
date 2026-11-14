import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TOLL_SETTINGS, showsTollField, tollBreakdown, tollInputMinor, tollLabel, tollParams,
  tollSettingsFrom, TOLL_TEXT, NEW_TRIP_TOLL_OPTIONS, tripTollOptionsFrom, tripTollPrefParams, tripTollMinor, tripTotalMinor,
} from "./portal-mileage-tolls.js";

test("settings: defaults fossil, AutoPASS and include tolls; RPC row is mapped", () => {
  assert.deepEqual(DEFAULT_TOLL_SETTINGS, { vehicleType: "fossil", usesAutopass: true, includeTolls: true });
  assert.deepEqual(tollSettingsFrom([]), DEFAULT_TOLL_SETTINGS);
  assert.deepEqual(tollSettingsFrom(null), DEFAULT_TOLL_SETTINGS);
  assert.deepEqual(tollSettingsFrom([{ vehicle_type: "electric", uses_autopass: false, include_tolls: false }]), { vehicleType: "electric", usesAutopass: false, includeTolls: false });
  assert.deepEqual(tollSettingsFrom({ vehicle_type: "diesel" }), DEFAULT_TOLL_SETTINGS);
  assert.deepEqual(NEW_TRIP_TOLL_OPTIONS, { vehicleType: "fossil", usesAutopass: true, includeTolls: true });
});

test("toll input: kr text to øre, 0–10 000 kr", () => {
  assert.deepEqual(tollInputMinor(""), { minor: null, valid: true });
  assert.deepEqual(tollInputMinor("33,60"), { minor: 3360, valid: true });
  assert.deepEqual(tollInputMinor("0"), { minor: 0, valid: true });
  assert.deepEqual(tollInputMinor("10 000"), { minor: 1_000_000, valid: true });
  assert.equal(tollInputMinor("10000,01").valid, false);
  assert.equal(tollInputMinor("-5").valid, false);
  assert.equal(tollInputMinor("abc").valid, false);
});

test("older trips without toll fields: no toll, deduction is the km amount", () => {
  assert.equal(tripTollMinor({ amount_minor: 7000 }), null);
  assert.equal(tripTollMinor({ amount_minor: 7000, toll_amount_minor: null }), null);
  assert.equal(tripTotalMinor({ amount_minor: 7000 }), 7000);
  assert.equal(tripTotalMinor({ amount_minor: 7000, toll_amount_minor: 3360 }), 10360);
  assert.deepEqual(tollBreakdown([{ amount_minor: 7000, toll_amount_minor: 3360 }, { amount_minor: 3500 }]), { kilometerMinor: 10500, tollMinor: 3360, totalMinor: 13860 });
});

test("field, label and RPC params follow MileageComposerView", () => {
  const on = DEFAULT_TOLL_SETTINGS;
  const off = { ...on, includeTolls: false };
  assert.equal(showsTollField(on, null), true);
  assert.equal(showsTollField(off, null), false);
  assert.equal(showsTollField(off, { toll_amount_minor: 0 }), true);
  assert.equal(tollLabel(true), "Bompenger (beregnet)");
  assert.equal(tollLabel(false), "Bompenger");
  assert.deepEqual(tollParams({ settings: on, input: "", estimated: false }), { requested_toll_amount_minor: null, requested_toll_estimated: null });
  assert.deepEqual(tollParams({ settings: on, input: "33,60", estimated: false }), { requested_toll_amount_minor: 3360, requested_toll_estimated: false });
  assert.deepEqual(tollParams({ settings: off, input: "33,60", estimated: false }), { requested_toll_amount_minor: null, requested_toll_estimated: null });
  assert.deepEqual(tollParams({ settings: on, input: "", estimated: true, correcting: true }), { requested_toll_amount_minor: 0, requested_toll_estimated: false });
  assert.deepEqual(tollParams({ settings: on, input: "33,60", estimated: true, correcting: true }), { requested_toll_amount_minor: 3360, requested_toll_estimated: true });
  assert.equal(TOLL_TEXT.info, "Bompengene er et estimat og kan avvike litt fra AutoPASS-fakturaen, og bompenger som er med i kjøreboken, skal ikke føres under Utgifter i tillegg.");
});

import { buildReport, reportBlocks } from "./portal-annual.js";
test("årsoppgave kjørebok: four lines, official 3,50 kr/km, tolls even at 0,00", () => {
  const trip = (id, meters, amount, toll) => ({ id, trip_date: "2026-03-01", from_place: "A", to_place: "B", purpose: "Visning", distance_meters: meters, amount_minor: amount, toll_amount_minor: toll, voided_at: null });
  const base = { year: 2026, transactions: [], links: [], documents: [], items: [], elections: {}, categoryTitle: (t) => t.category, landlordName: "Kari", propertyTitle: "Testveien 1", tenantNames: [], generatedAt: new Date("2026-11-11T12:00:00Z") };
  const block = (trips, year = 2026) => reportBlocks(buildReport({ ...base, year, trips })).find((b) => String(b.title).includes("Kjørebok"));
  const nbsp = "\u00a0";
  // 38 900 m × 3,50 kr/km = 136,15 kr, even when the stored trip amount disagrees.
  const one = block([trip("t1", 38900, 1, 13040)]);
  assert.equal(one.sum[0], "Totalt kjørt");
  assert.equal(one.sum[1], "38,9 km");
  assert.deepEqual(one.extraSums.map((s) => s[0]), ["Kilometerfradrag", "Bompenger", "Samlet beregnet fradrag"]);
  assert.equal(one.extraSums[0][1], `136,15${nbsp}kr`);
  assert.equal(one.extraSums[1][1], `130,40${nbsp}kr`);
  assert.equal(one.extraSums[2][1], `266,55${nbsp}kr`);
  const zeroToll = block([trip("t2", 20000, 99999, 0), trip("t3", 20000, 99999, null)]);
  assert.equal(zeroToll.extraSums[1][1], `0,00${nbsp}kr`);
  assert.equal(zeroToll.extraSums[0][1], `140,00${nbsp}kr`);
  // A year outside the catalogue keeps the stored trip amount.
  const fallback = block([trip("t4", 20000, 1234, 0)], 2022);
  assert.equal(fallback.extraSums[0][1], `12,34${nbsp}kr`);
  const report = buildReport({
    ...base,
    transactions: [{ id: "i", transaction_type: "income", category: "rent", amount_minor: 100, transaction_date: "2026-01-02", description: "Husleie" }],
    trips: [],
  });
  assert.equal(typeof report.incomes[0].category, "string");
  assert.equal(report.incomes[0].category, "rent");
});

test("per-trip choices (iOS #1619): stored values, null falls back to fossil/on/on, all three sent", () => {
  assert.deepEqual(tripTollOptionsFrom(null), { vehicleType: "fossil", usesAutopass: true, includeTolls: true });
  assert.deepEqual(tripTollOptionsFrom({ vehicle_type: null, uses_autopass: null, include_tolls: null }), { vehicleType: "fossil", usesAutopass: true, includeTolls: true });
  assert.deepEqual(tripTollOptionsFrom({ vehicle_type: "electric", uses_autopass: false, include_tolls: false }), { vehicleType: "electric", usesAutopass: false, includeTolls: false });
  assert.deepEqual(tripTollOptionsFrom({ vehicle_type: "diesel" }).vehicleType, "fossil");
  assert.deepEqual(tripTollPrefParams({ vehicleType: "electric", usesAutopass: false, includeTolls: false }), {
    requested_vehicle_type: "electric", requested_uses_autopass: false, requested_include_tolls: false,
  });
  assert.deepEqual(tripTollPrefParams(NEW_TRIP_TOLL_OPTIONS), { requested_vehicle_type: "fossil", requested_uses_autopass: true, requested_include_tolls: true });
  assert.equal(TOLL_TEXT.tripOptionsTitle, "Innstillinger for kjørebok");
});
