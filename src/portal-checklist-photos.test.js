import assert from "node:assert/strict";
import { test } from "node:test";
import {
  comparisonMeters, comparisonRows, groupChecklistPhotos, meterCaption, parseChecklistCaption, parseMeterCaption, rowKey, uniqueUrls,
} from "./portal-checklist-photos.js";

const KEY = "property.detail.handover.moveOut.item.walls";
const UUID = "0b0b0b0b-0b0b-40b0-80b0-0b0b0b0b0b0b";
const img = (id, caption, extra = {}) => ({
  id, collection_id: "out", caption, storage_path: `p/${id}.jpg`, status: "ready", created_at: `2026-01-0${id}T00:00:00Z`, ...extra,
});

test("parses both checklist caption formats like iOS", () => {
  assert.deepEqual(parseChecklistCaption(`eu-checklist:in:${KEY}`), { moveIn: true, key: KEY });
  assert.deepEqual(parseChecklistCaption(`eu-checklist:out:${KEY}`), { moveIn: false, key: KEY });
  assert.deepEqual(parseChecklistCaption(`eu-checklist-photo:out:${UUID}:${KEY}`), { moveIn: false, key: KEY });
  assert.deepEqual(parseChecklistCaption(`eu-checklist-photo:in:${UUID}:Egen: tittel`), { moveIn: true, key: "Egen: tittel" });
  assert.equal(parseChecklistCaption(`eu-checklist-photo:out:not-a-uuid:${KEY}`), null);
  assert.equal(parseChecklistCaption(`eu-checklist-photo:mid:${UUID}:${KEY}`), null);
  assert.equal(parseChecklistCaption(`eu-checklist-photo:out:${UUID}`), null);
  assert.equal(parseChecklistCaption(`eu-checklist:mid:${KEY}`), null);
  assert.equal(parseChecklistCaption("Stue"), null);
  assert.equal(parseChecklistCaption(null), null);
});

test("meter captions match InspectionPhotoRecovery", () => {
  assert.equal(meterCaption("electricity", true), "Strøm (kWh) – Sjekkliste for innflytting");
  assert.equal(meterCaption("water", false), "Vann (m³) – Sjekkliste for utflytting");
  assert.deepEqual(parseMeterCaption("Fjernvarme (MWh) – Sjekkliste for utflytting"), { moveIn: false, kind: "heating" });
  assert.equal(parseMeterCaption("Strøm (kWh)"), null);
});

test("groups every ready photo, any uploader, oldest first, no duplicates", () => {
  const rows = [
    img(3, `eu-checklist:out:${KEY}`, { uploaded_by: "landlord" }),
    img(1, `eu-checklist-photo:out:${UUID}:${KEY}`, { uploaded_by: "tenant" }),
    img(2, `eu-checklist:in:${KEY}`, { collection_id: "in", uploaded_by: "tenant" }),
    img(4, `eu-checklist:out:${KEY}`, { storage_path: "p/3.jpg" }),
    img(5, `eu-checklist:out:${KEY}`, { status: "pending" }),
    img(6, `eu-checklist:out:${KEY}`, { status: "deleting" }),
    img(7, `eu-checklist:out:${KEY}`, { status: "deleted" }),
    img(8, "eu-checklist:out:unknown.key"),
    img(9, `eu-checklist:out:${KEY}`, { collection_id: "gallery" }),
    img(1, `eu-checklist:out:${KEY}`, { id: "x", storage_path: " " }),
    img(5, "Strøm (kWh) – Sjekkliste for utflytting", { id: "m2" }),
    img(4, "Strøm (kWh) – Sjekkliste for innflytting", { id: "m1", collection_id: "in" }),
  ];
  const { checklist, meters } = groupChecklistPhotos(rows, ["in", "out"], [KEY]);
  assert.deepEqual(checklist.get(KEY).out.map((i) => i.id), [1, 3]);
  assert.deepEqual(checklist.get(KEY).in.map((i) => i.id), [2]);
  assert.equal(checklist.has("unknown.key"), false);
  assert.deepEqual(meters.get("electricity").in.map((i) => i.id), ["m1"]);
  assert.deepEqual(meters.get("electricity").out.map((i) => i.id), ["m2"]);
});

test("same created_at sorts by id; no collections gives nothing", () => {
  const rows = [img(1, `eu-checklist:out:${KEY}`, { id: "b" }), img(1, `eu-checklist:out:${KEY}`, { id: "a", storage_path: "p/a.jpg" })];
  assert.deepEqual(groupChecklistPhotos(rows, ["out"], [KEY]).checklist.get(KEY).out.map((i) => i.id), ["a", "b"]);
  assert.equal(groupChecklistPhotos(rows, [], [KEY]).checklist.size, 0);
});

test("uniqueUrls drops failed downloads and identical JPEGs", () => {
  assert.deepEqual(uniqueUrls(["data:a", null, "data:b", "data:a"]), ["data:a", "data:b"]);
});

test("rowKey is titleKey, else custom title", () => {
  assert.equal(rowKey({ k: KEY, t: "Egen" }), KEY);
  assert.equal(rowKey({ t: "Egen" }), "Egen");
  assert.equal(rowKey({}), "");
});

test("comparison rows follow DepositHandoverComparison", () => {
  const moveIn = {
    in: [
      { k: KEY, d: true, c: "Flekk" },
      { k: "property.detail.handover.moveIn.item.floor", d: true },
      { k: "property.detail.handover.moveIn.item.keys", d: true },
      { k: "property.detail.handover.moveIn.item.meters", c: "Avlest" },
      { k: "property.detail.handover.moveIn.item.unanswered" },
    ],
  };
  const moveOut = {
    out: [
      { k: KEY, d: false, c: " Hull ", bd: false, bc: "Grunnlinje" },
      { t: "Egen", d: true },
      { t: "Slettet", x: "2026-01-01T00:00:00Z" },
    ],
  };
  const rows = comparisonRows(moveIn, moveOut);
  assert.deepEqual(rows.map((r) => r.key), [KEY, "Egen", "property.detail.handover.moveIn.item.floor"]);
  assert.deepEqual(rows[0], { key: KEY, row: moveOut.out[0], inDone: false, inNote: "Grunnlinje", outDone: false, outNote: "Hull" });
  assert.equal(rows[1].inDone, null);
  assert.deepEqual([rows[2].inDone, rows[2].outDone], [true, null]);
  // Without a baseline the move-in answer is used.
  const plain = comparisonRows(moveIn, { out: [{ k: KEY, d: true }] });
  assert.deepEqual([plain[0].inDone, plain[0].inNote], [true, "Flekk"]);
});

test("comparison meters come from the shared notes", () => {
  const m = comparisonMeters({ meters: [{ kind: "water", in: "3" }] }, { meters: [{ kind: "electricity", in: "1", out: "2" }, { kind: "heating", na: true }, { kind: "gas", in: "9" }] });
  assert.deepEqual(m, [{ kind: "electricity", in: "1", out: "2" }, { kind: "water", in: "3", out: "" }]);
});
