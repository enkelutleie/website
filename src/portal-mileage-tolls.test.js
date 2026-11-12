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
test("årsoppgave: Kilometerfradrag, Bompenger only with an amount, Sum fradrag; null tolls are 0", () => {
  const trip = (id, amount, toll) => ({ id, trip_date: "2026-03-01", from_place: "A", to_place: "B", purpose: "Visning", distance_meters: 20000, amount_minor: amount, toll_amount_minor: toll, voided_at: null });
  const base = { year: 2026, transactions: [], links: [], documents: [], items: [], elections: {}, categoryTitle: () => "", landlordName: "Kari", propertyTitle: "Testveien 1", tenantNames: [], generatedAt: new Date("2026-11-11T12:00:00Z") };
  const sums = (trips) => reportBlocks(buildReport({ ...base, trips })).find((b) => String(b.title).includes("Kjørebok"));
  const withToll = sums([trip("t1", 7000, 3360), trip("t2", 7000, null)]);
  assert.deepEqual(withToll.sum[0], "Sum kjøring");
  assert.deepEqual(withToll.extraSums.map((s) => s[0]), ["Kilometerfradrag", "Bompenger", "Sum fradrag"]);
  const values = Object.fromEntries(withToll.extraSums);
  assert.equal(values.Kilometerfradrag, "140 kr");
  assert.equal(values.Bompenger, "33,60 kr");
  assert.equal(values["Sum fradrag"], "173,60 kr");
  assert.deepEqual(sums([trip("t3", 7000, undefined)]).extraSums.map((s) => s[0]), ["Kilometerfradrag", "Sum fradrag"]);
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
