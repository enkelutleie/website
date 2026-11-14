// Several tenants fill the same move-in / move-out protocol. The shared note on the
// "other" inspection item (marker [[eu-handover:{...}]]) is one row, but checks and
// meter readings merge per point against the note this browser last loaded or saved.
// A save must not replace that list with the local copy. iOS PropertyHandoverSharedNote
// .mergingChecklistAnswers / meterMatchesBaseline (PR #1678).

const PREFIX = "[[eu-handover:";
const SUFFIX = "]]";

export const HANDOVER_REALTIME_DEBOUNCE_MS = 350;

const baselines = new Map();
const working = new Map();
// Bumps on every local edit and whenever a save merges a newer edit into the working note.
const revisions = new Map();

export function resetHandoverSyncState() {
  baselines.clear();
  working.clear();
  revisions.clear();
}

export function rememberHandoverBaseline(itemId, note) {
  if (!itemId || baselines.has(itemId)) return;
  baselines.set(itemId, note ?? null);
}

function bumpRevision(itemId) {
  const revision = (revisions.get(itemId) ?? 0) + 1;
  revisions.set(itemId, revision);
  return revision;
}

export function setHandoverWorkingNote(itemId, note) {
  if (!itemId) return 0;
  working.set(itemId, note ?? null);
  return bumpRevision(itemId);
}

export function handoverWorkingRevision(itemId) {
  return revisions.get(itemId) ?? 0;
}

export function handoverWorkingNote(itemId) {
  return working.has(itemId) ? working.get(itemId) : null;
}

export function clearHandoverWorkingNote(itemId) {
  working.delete(itemId);
}

export function splitHandoverNote(note) {
  const text = note ?? "";
  const at = text.indexOf(PREFIX);
  if (at < 0) return { visible: text.trim(), json: null, rest: "" };
  const end = text.indexOf(SUFFIX, at + PREFIX.length);
  if (end < 0) return { visible: text.trim(), json: null, rest: "" };
  let json = null;
  try {
    const parsed = JSON.parse(text.slice(at + PREFIX.length, end));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed;
  } catch {
    json = null;
  }
  return { visible: text.slice(0, at).trim(), json, rest: text.slice(end + SUFFIX.length) };
}

export function joinHandoverNote(visible, json, rest = "") {
  if (!json) return visible ? visible : null;
  const marker = `${PREFIX}${JSON.stringify(json)}${SUFFIX}${rest || ""}`;
  return visible ? `${visible}\n${marker}` : marker;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

// Door text is legacy and ignored when deciding whether the note changed (iOS hasSameContent).
export function handoverSameContent(a, b) {
  const canon = (note) => {
    const parts = splitHandoverNote(note);
    if (!parts.json) return (note ?? "").trim();
    const obj = structuredClone(parts.json);
    delete obj.door;
    delete obj.doorRemoved;
    return `${parts.visible}\n${stableStringify(obj)}\n${parts.rest}`;
  };
  return canon(a) === canon(b);
}

const titleKey = (row) => (typeof row?.k === "string" ? row.k : null);
const customTitle = (row) => (typeof row?.t === "string" ? row.t.trim() : "");

// Preset points match on titleKey when either side has one. Otherwise the trimmed custom title.
export function sameChecklistPoint(a, b) {
  const ak = titleKey(a);
  const bk = titleKey(b);
  if (ak != null || bk != null) return ak != null && bk != null && ak === bk;
  const at = customTitle(a);
  const bt = customTitle(b);
  return at !== "" && at === bt;
}

const trim = (value) => (typeof value === "string" ? value.trim() : "");

// Answer text, check and photo flag. A point this device has not changed shares this
// signature with the baseline (iOS checklistSignature).
export function checklistAnswerSignature(row) {
  return [
    titleKey(row) ?? "",
    typeof row?.t === "string" ? row.t : "",
    row?.d === true ? "1" : "0",
    trim(row?.c),
    row?.p === true ? "1" : "0",
    typeof row?.bd === "boolean" ? (row.bd ? "1" : "0") : "",
    typeof row?.bc === "string" ? row.bc : "",
    typeof row?.bp === "boolean" ? (row.bp ? "1" : "0") : "",
    trim(row?.x) ? "x" : "",
  ].join("\u001f");
}

const pointChanged = (local, base) => checklistAnswerSignature(local) !== checklistAnswerSignature(base);

/**
 * Three-way merge of one checklist (move-in `in` or move-out `out`).
 * Unchanged since baseline → the server point (done, note, photo flag).
 * Changed here → the whole local point. Only on the server → added. Only here → kept.
 */
export function mergeChecklistItems(local, remote, baseline) {
  const localRows = Array.isArray(local) ? local : [];
  const remoteRows = Array.isArray(remote) ? remote : [];
  const baseRows = Array.isArray(baseline) ? baseline : [];
  const find = (rows, item) => rows.find((row) => sameChecklistPoint(row, item));
  const used = new Set();
  const merged = [];
  for (const remoteItem of remoteRows) {
    const localIndex = localRows.findIndex((row) => sameChecklistPoint(row, remoteItem));
    if (localIndex >= 0) {
      used.add(localIndex);
      const localItem = localRows[localIndex];
      const base = find(baseRows, remoteItem);
      merged.push(structuredClone(base && !pointChanged(localItem, base) ? remoteItem : localItem));
    } else if (!find(baseRows, remoteItem)) {
      merged.push(structuredClone(remoteItem));
    }
  }
  localRows.forEach((localItem, index) => {
    if (used.has(index)) return;
    const base = find(baseRows, localItem);
    if (base && !pointChanged(localItem, base)) return;
    merged.push(structuredClone(localItem));
  });
  return merged;
}

const reading = (value) => (value == null ? "" : String(value).trim());
const naList = (json) => (Array.isArray(json?.na) ? json.na : []);
const meterRows = (json) => (Array.isArray(json?.meters) ? json.meters : []);

function meterView(json, kind) {
  const row = meterRows(json).find((meter) => meter?.kind === kind);
  return {
    row,
    in: reading(row?.in),
    out: reading(row?.out),
    na: row?.na === true || naList(json).includes(kind),
  };
}

function sameMeter(a, b) {
  return a.in === b.in && a.out === b.out && a.na === b.na;
}

function meterKinds(...jsons) {
  const kinds = [];
  const push = (kind) => {
    if (kind && !kinds.includes(kind)) kinds.push(kind);
  };
  for (const json of jsons) {
    for (const meter of meterRows(json)) push(meter?.kind);
    for (const kind of naList(json)) push(kind);
  }
  return kinds;
}

function metersUntouched(local, baseline) {
  return meterKinds(local, baseline).every((kind) => sameMeter(meterView(local, kind), meterView(baseline, kind)));
}

// Per kind: a meter this device has not changed takes the stored reading. A meter
// changed here keeps this device's value. Kinds only on the server are added when
// this device has not edited that kind. Keys are not merged here.
function mergeMeters(local, remote, baseline) {
  if (metersUntouched(local, baseline)) return { meters: meterRows(remote), na: naList(remote), untouched: true };
  const kinds = meterKinds(local, remote, baseline);
  const meters = [];
  const na = new Set(naList(remote));
  for (const kind of kinds) {
    const localView = meterView(local, kind);
    const remoteView = meterView(remote, kind);
    const baseView = meterView(baseline, kind);
    const unchanged = sameMeter(localView, baseView);
    const chosen = unchanged ? remoteView : localView;
    if (chosen.row) meters.push(structuredClone(chosen.row));
    else if (chosen.in || chosen.out || chosen.na) {
      const row = { kind, in: chosen.in, out: chosen.out };
      if (chosen.na) row.na = true;
      meters.push(row);
    }
    if (chosen.na) na.add(kind);
    else na.delete(kind);
  }
  return { meters, na: [...na].sort(), untouched: false };
}

function mergeList(local, remote, baseline, key) {
  const localHas = Array.isArray(local?.[key]);
  const remoteHas = Array.isArray(remote?.[key]);
  const baseHas = Array.isArray(baseline?.[key]);
  if (!localHas && !remoteHas) return undefined;
  if (!localHas && remoteHas) return structuredClone(remote[key]);
  if (localHas && !remoteHas && !baseHas) return structuredClone(local[key]);
  return mergeChecklistItems(local?.[key], remoteHas ? remote[key] : [], baseHas ? baseline[key] : []);
}

const sameKeys = (a, b) => stableStringify(Array.isArray(a?.keys) ? a.keys : null) === stableStringify(Array.isArray(b?.keys) ? b.keys : null);

/**
 * Merge the note this device wants to store into the note just read, against the
 * last loaded or saved note. Keys stay one section: untouched keys take the server
 * section, edited keys keep the local section. Returns the note to write and
 * whether local answers still differ from the server (the draft stays dirty).
 */
export function mergeHandoverNote(localNote, remoteNote, baselineNote) {
  const local = splitHandoverNote(localNote);
  const remote = splitHandoverNote(remoteNote);
  const baseline = splitHandoverNote(baselineNote);
  if (!local.json && !remote.json) {
    return { note: localNote ?? null, dirty: (localNote ?? null) !== (remoteNote ?? null) };
  }
  if (!remote.json) return { note: localNote ?? null, dirty: !handoverSameContent(localNote, remoteNote) };
  if (!local.json) {
    const visible = local.visible !== baseline.visible ? local.visible : remote.visible;
    const note = joinHandoverNote(visible, remote.json, remote.rest);
    return { note, dirty: !handoverSameContent(note, remoteNote) };
  }
  const obj = structuredClone(remote.json);
  for (const key of ["in", "out"]) {
    const merged = mergeList(local.json, remote.json, baseline.json, key);
    if (merged !== undefined) obj[key] = merged;
  }
  const meters = mergeMeters(local.json, remote.json, baseline.json);
  if (!meters.untouched) {
    if (meters.meters.length) obj.meters = meters.meters;
    else delete obj.meters;
    const previous = Array.isArray(obj.na) ? [...obj.na].sort() : [];
    if (stableStringify(meters.na) !== stableStringify(previous)) {
      if (meters.na.length) obj.na = meters.na;
      else delete obj.na;
    }
  }
  if (!sameKeys(local.json, baseline.json)) {
    if (Array.isArray(local.json.keys)) obj.keys = structuredClone(local.json.keys);
    else delete obj.keys;
  }
  const visible = local.visible !== baseline.visible ? local.visible : remote.visible;
  const rest = local.rest !== baseline.rest ? local.rest : remote.rest;
  const note = joinHandoverNote(visible, obj, rest);
  return { note, dirty: !handoverSameContent(note, remoteNote) };
}

// A refresh adopts the server note when this device has nothing unsaved. A dirty
// working note is merged and left dirty so the next save still sends it.
export function adoptLoadedHandoverNote(itemId, serverNote) {
  if (!itemId) return { note: serverNote ?? null, dirty: false };
  if (!baselines.has(itemId)) {
    baselines.set(itemId, serverNote ?? null);
    return { note: serverNote ?? null, dirty: false };
  }
  if (!working.has(itemId)) {
    baselines.set(itemId, serverNote ?? null);
    return { note: serverNote ?? null, dirty: false };
  }
  const merged = mergeHandoverNote(working.get(itemId), serverNote, baselines.get(itemId));
  if (!merged.dirty) {
    baselines.set(itemId, serverNote ?? null);
    working.delete(itemId);
    return { note: serverNote ?? null, dirty: false };
  }
  working.set(itemId, merged.note);
  bumpRevision(itemId);
  return merged;
}

// After a stored write: the saved note is the new baseline. A newer local edit
// that landed during the write stays dirty.
export function commitHandoverSave(itemId, savedNote, sentNote) {
  const previous = baselines.has(itemId) ? baselines.get(itemId) : sentNote;
  baselines.set(itemId, savedNote ?? null);
  const current = working.has(itemId) ? working.get(itemId) : sentNote;
  if (current == null || current === sentNote) {
    working.delete(itemId);
    return { note: savedNote ?? null, dirty: false };
  }
  const merged = mergeHandoverNote(current, savedNote, previous);
  if (!merged.dirty) {
    working.delete(itemId);
    return { note: savedNote ?? null, dirty: false };
  }
  working.set(itemId, merged.note);
  bumpRevision(itemId);
  return merged;
}

export function withChecklistPointDone(note, list, point, done) {
  const parts = splitHandoverNote(note);
  if (!parts.json || !Array.isArray(parts.json[list])) return null;
  const index = parts.json[list].findIndex((row) => sameChecklistPoint(row, point));
  if (index < 0) return null;
  const json = structuredClone(parts.json);
  json[list][index] = { ...json[list][index], d: done === true };
  return joinHandoverNote(parts.visible, json, parts.rest);
}

const sharedNote = (note) => String(note ?? "").includes(PREFIX);

export function isInspectionItemConflict(res) {
  const code = String(res?.error?.code ?? "");
  const message = String(res?.error?.message ?? "");
  return code === "PT409" || code === "40001" || /inspection_item_version_conflict/.test(message);
}

/**
 * Read the row, merge, then update_inspection_item with that row's updated_at.
 * PT409 means someone stored the row between the read and the write: read again
 * and merge again. A plain room note (no shared marker) is not retried over the
 * other writer's text. io.read → { data } | { error }, io.write(fresh, condition, note).
 */
function storedResult(item, condition, note) {
  return {
    data: {
      id: item.id,
      condition: item.condition ?? condition ?? null,
      note: baselines.has(item.id) ? baselines.get(item.id) : note ?? null,
      updated_at: item.updated_at,
    },
  };
}

export async function writeMergedInspectionItem(item, condition, note, io, seenRevision = null) {
  // A follow-up save queued before this merge finished carries the old snapshot.
  // The newer edit was already merged and stored, so writing that snapshot again
  // would drop points only the server had.
  const superseded = () => seenRevision != null
    && (revisions.get(item.id) ?? 0) > seenRevision
    && !working.has(item.id);
  if (superseded()) return storedResult(item, condition, note);
  let sent = working.has(item.id) ? working.get(item.id) : note;
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fresh = await io.read(item.id);
    if (fresh?.error) return fresh;
    if (!fresh?.data) return { error: { message: "inspection_item_not_found" } };
    if (superseded()) return storedResult(item, condition, note);
    if (working.has(item.id)) sent = working.get(item.id);
    const baseline = baselines.has(item.id) ? baselines.get(item.id) : null;
    const merged = mergeHandoverNote(sent, fresh.data.note, baseline);
    const noteToWrite = merged.note;
    const sameNote = handoverSameContent(noteToWrite, fresh.data.note);
    const sameCondition = (fresh.data.condition ?? null) === (condition ?? null);
    if (sameNote && sameCondition) {
      const commit = commitHandoverSave(item.id, fresh.data.note ?? null, sent);
      if (commit.dirty && attempt < 2) {
        sent = commit.note;
        continue;
      }
      return { data: { ...fresh.data, note: commit.note } };
    }
    last = await io.write(fresh.data, condition, noteToWrite);
    if (isInspectionItemConflict(last)) {
      if (!(sharedNote(sent) || sharedNote(fresh.data.note))) return last;
      continue;
    }
    if (last?.error || !last?.data) return last;
    const savedNote = last.data.note ?? noteToWrite;
    const commit = commitHandoverSave(item.id, savedNote, sent);
    if (commit.dirty && attempt < 2) {
      sent = commit.note;
      continue;
    }
    return { data: { ...last.data, note: commit.note } };
  }
  return last ?? { error: { code: "PT409", message: "inspection_item_version_conflict" } };
}

// Draft protocols only. Realtime compares uuid text in lowercase.
export function handoverRealtimeScope(inspections) {
  const open = (Array.isArray(inspections) ? inspections : []).filter((row) => row && row.status === "draft" && row.id);
  const inspectionIDs = [...new Set(open.map((row) => String(row.id).toLowerCase()))].sort();
  const collectionIDs = [...new Set(open.map((row) => row.image_collection_id).filter(Boolean).map((id) => String(id).toLowerCase()))].sort();
  const list = (ids) => ids.join(",");
  return {
    inspectionIDs,
    collectionIDs,
    isEmpty: inspectionIDs.length === 0,
    itemFilter: inspectionIDs.length ? `inspection_id=in.(${list(inspectionIDs)})` : null,
    inspectionFilter: inspectionIDs.length ? `id=in.(${list(inspectionIDs)})` : null,
    imageFilter: collectionIDs.length ? `collection_id=in.(${list(collectionIDs)})` : null,
  };
}

// A protocol reload already includes photos, so it wins over a photo event in the same burst.
// A resync (reconnect) is a full reload and also wins over photos.
export function combineHandoverChange(current, next) {
  if (!current || current === "photos") return next;
  return current;
}

export function createHandoverCoalescer({
  delay = HANDOVER_REALTIME_DEBOUNCE_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let pending = null;
  let timer = null;
  let running = false;
  let apply = null;
  const schedule = () => {
    clearTimer(timer);
    timer = setTimer(flush, delay);
  };
  async function flush() {
    timer = null;
    if (running) return;
    const next = pending;
    const run = apply;
    pending = null;
    if (!next || !run) return;
    running = true;
    try {
      await run(next);
    } finally {
      running = false;
      if (pending) schedule();
    }
  }
  return {
    submit(change, run) {
      pending = combineHandoverChange(pending, change);
      apply = run;
      if (running) return;
      schedule();
    },
    cancel() {
      clearTimer(timer);
      timer = null;
      pending = null;
      apply = null;
    },
  };
}

// First SUBSCRIBED is the open. The next one is a reconnect and must reload.
export function handoverSocketEvent(state, status) {
  const next = { hadConnection: state.hadConnection, attempt: state.attempt, resync: false, retry: false };
  if (status === "SUBSCRIBED") {
    next.resync = Boolean(state.hadConnection || state.attempt > 0);
    next.hadConnection = true;
    next.attempt = 0;
    return next;
  }
  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
    next.attempt = state.attempt + 1;
    next.retry = true;
  }
  return next;
}
