import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  HANDOVER_REALTIME_DEBOUNCE_MS,
  adoptLoadedHandoverNote,
  checklistAnswerSignature,
  combineHandoverChange,
  createHandoverCoalescer,
  handoverRealtimeScope,
  handoverSameContent,
  handoverSocketEvent,
  isInspectionItemConflict,
  mergeChecklistItems,
  mergeHandoverNote,
  resetHandoverSyncState,
  sameChecklistPoint,
  setHandoverWorkingNote,
  withChecklistPointDone,
  writeMergedInspectionItem,
} from "./portal-handover-sync.js";

const WALLS = "property.detail.handover.moveIn.item.walls";
const FLOOR = "property.detail.handover.moveIn.item.floor";
const OUT = "property.detail.handover.moveOut.item.walls";

const note = (data, visible = "") => {
  const marker = `[[eu-handover:${JSON.stringify(data)}]]`;
  return visible ? `${visible}\n${marker}` : marker;
};
const body = (value) => JSON.parse(value.slice(value.indexOf("{"), value.lastIndexOf("}") + 1));

test("checklist points match on titleKey, otherwise the trimmed custom title", () => {
  assert.equal(sameChecklistPoint({ k: WALLS }, { k: WALLS, d: true }), true);
  assert.equal(sameChecklistPoint({ k: WALLS }, { k: FLOOR }), false);
  assert.equal(sameChecklistPoint({ k: WALLS }, { t: "Vegg" }), false);
  assert.equal(sameChecklistPoint({ t: " Egen flekk " }, { t: "Egen flekk" }), true);
  assert.equal(sameChecklistPoint({ t: "  " }, { t: "  " }), false);
});

test("an untouched point takes the server check, note and photo flag", () => {
  const base = [{ k: WALLS, d: false }, { k: FLOOR, d: false }];
  const remote = [{ k: WALLS, d: true, c: "Riper i parkett", p: true }, { k: FLOOR, d: false }];
  const merged = mergeChecklistItems(base, remote, base);
  assert.deepEqual(merged[0], remote[0]);
  assert.equal(checklistAnswerSignature(merged[0]).includes("Riper i parkett"), true);
});

test("two tenants keep both checks, including a point only the server has", () => {
  const base = [{ k: WALLS, d: false }, { k: FLOOR, d: false }];
  const server = [{ k: WALLS, d: true, c: "Fra A" }, { k: FLOOR, d: false }, { t: "Egen flekk", d: true }];
  const local = [{ k: WALLS, d: false }, { k: FLOOR, d: true, c: "Fra B" }];
  const merged = mergeChecklistItems(local, server, base);
  assert.equal(merged.find((row) => row.k === WALLS).d, true);
  assert.equal(merged.find((row) => row.k === WALLS).c, "Fra A");
  assert.equal(merged.find((row) => row.k === FLOOR).d, true);
  assert.equal(merged.find((row) => row.k === FLOOR).c, "Fra B");
  assert.equal(merged.find((row) => row.t === "Egen flekk").d, true);
});

test("a point both edited keeps the local item, and a point only here is kept", () => {
  const base = [{ k: WALLS, d: false }];
  const server = [{ k: WALLS, d: true, c: "Deres" }];
  const local = [{ k: WALLS, d: true, c: "Min" }, { t: "Kun her", d: true }];
  const merged = mergeChecklistItems(local, server, base);
  assert.deepEqual(merged[0], local[0]);
  assert.equal(merged[1].t, "Kun her");
});

test("an unchanged point the server removed is dropped", () => {
  const base = [{ k: WALLS, d: false }, { k: FLOOR, d: true }];
  const merged = mergeChecklistItems(base, [{ k: WALLS, d: false }], base);
  assert.deepEqual(merged.map((row) => row.k), [WALLS]);
});

test("move-out merges the same way, and meters merge per kind", () => {
  const baseline = note({
    in: [{ k: WALLS, d: false }],
    out: [{ k: OUT, d: false }],
    keys: [{ kind: "frontDoor", issued: 2 }],
    meters: [{ kind: "electricity", in: "" }, { kind: "water", in: "" }],
  });
  const remote = note({
    in: [{ k: WALLS, d: true }],
    out: [{ k: OUT, d: true, c: "Hull" }],
    keys: [{ kind: "frontDoor", issued: 4 }],
    meters: [{ kind: "electricity", in: "12345" }, { kind: "water", in: "" }],
  });
  const water = note({
    in: [{ k: WALLS, d: false }],
    out: [{ k: OUT, d: false }],
    keys: [{ kind: "frontDoor", issued: 2 }],
    meters: [{ kind: "electricity", in: "" }, { kind: "water", in: "678" }],
  });
  const merged = mergeHandoverNote(water, remote, baseline);
  const data = body(merged.note);
  assert.equal(data.in[0].d, true);
  assert.equal(data.out[0].c, "Hull");
  assert.equal(data.meters.find((meter) => meter.kind === "electricity").in, "12345");
  assert.equal(data.meters.find((meter) => meter.kind === "water").in, "678");
  assert.equal(data.keys[0].issued, 4);
  assert.equal(merged.dirty, true);
  const ownOut = note({
    in: [{ k: WALLS, d: false }],
    out: [{ k: OUT, d: true, c: "Min" }],
    keys: [{ kind: "frontDoor", issued: 2 }],
    meters: [{ kind: "electricity", in: "" }, { kind: "water", in: "" }],
  });
  const kept = body(mergeHandoverNote(ownOut, remote, baseline).note);
  assert.equal(kept.out[0].c, "Min");
  assert.equal(kept.in[0].d, true);
});

test("untouched keys take the server section, edited keys stay whole", () => {
  const baseline = note({ keys: [{ kind: "frontDoor", issued: 1 }], meters: [] });
  const remote = note({ keys: [{ kind: "frontDoor", issued: 3 }, { kind: "mailbox", issued: 1 }], meters: [] });
  const edited = note({ keys: [{ kind: "frontDoor", issued: 9 }], meters: [] });
  assert.equal(body(mergeHandoverNote(baseline, remote, baseline).note).keys[1].kind, "mailbox");
  assert.deepEqual(body(mergeHandoverNote(edited, remote, baseline).note).keys, [{ kind: "frontDoor", issued: 9 }]);
});

test("a clean refresh takes the server note and a dirty one keeps the local check", () => {
  resetHandoverSyncState();
  const itemId = "item-1";
  const baseline = note({ in: [{ k: WALLS, d: false }, { k: FLOOR, d: false }] });
  const first = adoptLoadedHandoverNote(itemId, baseline);
  assert.equal(first.dirty, false);
  const remote = note({ in: [{ k: WALLS, d: true }, { k: FLOOR, d: false }] });
  setHandoverWorkingNote(itemId, withChecklistPointDone(baseline, "in", { k: FLOOR }, true));
  const merged = adoptLoadedHandoverNote(itemId, remote);
  const data = body(merged.note);
  assert.equal(merged.dirty, true);
  assert.equal(data.in.find((row) => row.k === WALLS).d, true);
  assert.equal(data.in.find((row) => row.k === FLOOR).d, true);
  const clean = adoptLoadedHandoverNote("item-2", remote);
  assert.equal(clean.dirty, false);
  assert.equal(handoverSameContent(clean.note, remote), true);
});

test("the save reads, merges, and on PT409 reads and merges again", async () => {
  resetHandoverSyncState();
  const item = { id: "item-1", updated_at: "t0", condition: "ok" };
  const baseline = note({
    in: [{ k: WALLS, d: false }, { k: FLOOR, d: false }],
    meters: [{ kind: "electricity", in: "" }, { kind: "water", in: "" }],
  });
  adoptLoadedHandoverNote(item.id, baseline);
  const local = withChecklistPointDone(baseline, "in", { k: FLOOR }, true);
  let server = {
    id: item.id,
    condition: "ok",
    updated_at: "t1",
    note: note({
      in: [{ k: WALLS, d: true }, { k: FLOOR, d: false }],
      meters: [{ kind: "electricity", in: "12345" }, { kind: "water", in: "" }],
    }),
  };
  const reads = [];
  const writes = [];
  const io = {
    read: async () => {
      reads.push(server.updated_at);
      return { data: { ...server } };
    },
    write: async (fresh, condition, written) => {
      writes.push({ expected: fresh.updated_at, condition, note: written });
      if (writes.length === 1) {
        server = {
          ...server,
          updated_at: "t2",
          note: note({
            in: [{ k: WALLS, d: true, c: "Samtidig" }, { k: FLOOR, d: false }],
            meters: [{ kind: "electricity", in: "12345" }, { kind: "water", in: "9" }],
          }),
        };
        return { error: { code: "PT409", message: "inspection_item_version_conflict" } };
      }
      return { data: { ...fresh, condition, note: written, updated_at: "t3" } };
    },
  };
  const res = await writeMergedInspectionItem(item, "ok", local, io);
  assert.equal(reads.length, 2);
  assert.equal(writes[0].expected, "t1");
  assert.equal(writes[1].expected, "t2");
  const stored = body(writes[1].note);
  assert.equal(stored.in.find((row) => row.k === WALLS).d, true);
  assert.equal(stored.in.find((row) => row.k === WALLS).c, "Samtidig");
  assert.equal(stored.in.find((row) => row.k === FLOOR).d, true);
  assert.equal(stored.meters.find((meter) => meter.kind === "electricity").in, "12345");
  assert.equal(stored.meters.find((meter) => meter.kind === "water").in, "9");
  assert.equal(stored.in.find((row) => row.k === FLOOR).d, true);
  assert.equal(res.data.updated_at, "t3");
  assert.equal(isInspectionItemConflict({ error: { code: "PT409", message: "inspection_item_version_conflict" } }), true);
});

test("a check made while the save is in flight is merged, and the stale follow-up does not drop the server point", async () => {
  resetHandoverSyncState();
  const item = { id: "item-1", updated_at: "t0", condition: "ok" };
  const baseline = note({ in: [{ k: WALLS, d: false }, { k: FLOOR, d: false }] });
  adoptLoadedHandoverNote(item.id, baseline);
  const local = withChecklistPointDone(baseline, "in", { k: WALLS }, true);
  const revision = setHandoverWorkingNote(item.id, local);
  let server = {
    id: item.id,
    condition: "ok",
    updated_at: "t1",
    note: note({ in: [{ k: WALLS, d: false }, { k: FLOOR, d: false }, { t: "Egen flekk", d: true }] }),
  };
  const writes = [];
  const io = {
    read: async () => {
      if (writes.length === 0) setHandoverWorkingNote(item.id, withChecklistPointDone(local, "in", { k: FLOOR }, true));
      return { data: { ...server, note: server.note } };
    },
    write: async (fresh, condition, written) => {
      writes.push(written);
      server = { ...server, note: written, updated_at: "t2", condition };
      return { data: { ...fresh, condition, note: written, updated_at: "t2" } };
    },
  };
  const saved = await writeMergedInspectionItem(item, "ok", local, io, revision);
  const stored = body(writes.at(-1));
  assert.equal(stored.in.find((row) => row.k === WALLS).d, true);
  assert.equal(stored.in.find((row) => row.k === FLOOR).d, true);
  assert.equal(stored.in.find((row) => row.t === "Egen flekk").d, true);
  assert.equal(saved.data.note.includes("Egen flekk"), true);
  const stale = withChecklistPointDone(local, "in", { k: FLOOR }, true);
  const again = await writeMergedInspectionItem(item, "ok", stale, io, revision);
  assert.equal(writes.length, 1);
  assert.equal(body(again.data.note).in.some((row) => row.t === "Egen flekk"), true);
});

test("a plain room note is not written again over a PT409", async () => {
  resetHandoverSyncState();
  let writes = 0;
  const res = await writeMergedInspectionItem({ id: "room" }, "note", "Ny merknad", {
    read: async () => ({ data: { id: "room", condition: "ok", note: "Gammel", updated_at: "t1" } }),
    write: async () => {
      writes += 1;
      return { error: { code: "PT409", message: "inspection_item_version_conflict" } };
    },
  });
  assert.equal(writes, 1);
  assert.equal(res.error.code, "PT409");
});

test("realtime follows only open protocols, in lowercase", () => {
  const draft = { id: "AAAA-BBBB", status: "draft", image_collection_id: "CCCC-DDDD" };
  const scope = handoverRealtimeScope([draft, { id: "EEEE", status: "finalized", image_collection_id: "FFFF" }]);
  assert.deepEqual(scope.inspectionIDs, ["aaaa-bbbb"]);
  assert.equal(scope.itemFilter, "inspection_id=in.(aaaa-bbbb)");
  assert.equal(scope.inspectionFilter, "id=in.(aaaa-bbbb)");
  assert.equal(scope.imageFilter, "collection_id=in.(cccc-dddd)");
  assert.equal(handoverRealtimeScope([{ id: "x", status: "finalized" }]).isEmpty, true);
});

test("a burst becomes one protocol reload, and a reconnect reloads", async () => {
  assert.equal(HANDOVER_REALTIME_DEBOUNCE_MS, 350);
  assert.equal(combineHandoverChange(null, "photos"), "photos");
  assert.equal(combineHandoverChange("photos", "protocol"), "protocol");
  assert.equal(combineHandoverChange("protocol", "photos"), "protocol");
  assert.equal(combineHandoverChange("resync", "photos"), "resync");
  const pending = new Map();
  let next = 1;
  const coalescer = createHandoverCoalescer({
    delay: 350,
    setTimer: (fn) => { const id = next++; pending.set(id, fn); return id; },
    clearTimer: (id) => pending.delete(id),
  });
  const applied = [];
  const run = async (kind) => { applied.push(kind); };
  coalescer.submit("photos", run);
  coalescer.submit("protocol", run);
  coalescer.submit("photos", run);
  assert.equal(pending.size, 1);
  await [...pending.values()][0]();
  assert.deepEqual(applied, ["protocol"]);
  const first = handoverSocketEvent({ hadConnection: false, attempt: 0 }, "SUBSCRIBED");
  assert.equal(first.resync, false);
  const again = handoverSocketEvent(first, "SUBSCRIBED");
  assert.equal(again.resync, true);
  const dropped = handoverSocketEvent(again, "CLOSED");
  assert.equal(dropped.retry, true);
  assert.equal(handoverSocketEvent(dropped, "SUBSCRIBED").resync, true);
});

test("the portal CSP allows the Supabase realtime websocket", () => {
  const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
  const csp = /Content-Security-Policy: (.+)/.exec(headers)[1];
  assert.match(csp, /connect-src [^;]*https:\/\/jfrorhixjsuomwtjwqla\.supabase\.co/);
  assert.match(csp, /connect-src [^;]*wss:\/\/jfrorhixjsuomwtjwqla\.supabase\.co/);
});
