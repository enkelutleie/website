// Checklist and meter photos for the handover pages and the deposit settlement (iOS #1595,
// DEPOSIT_CHECKLIST_PHOTOS_ANDROID_PARITY). Every `ready` row in the tenancy's move-in and
// move-out image collections counts, whoever uploaded it: no uploaded_by or role filter.
// Checks, notes and meter readings come from the shared checklist note, never from images.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PropertyHandoverLifecycle.checklistPhoto(from:): «eu-checklist:in|out:<key>» or
// «eu-checklist-photo:in|out:<uuid>:<key>» → { moveIn, key } | null.
export const parseChecklistCaption = (caption) => {
  const text = String(caption ?? "");
  if (text.startsWith("eu-checklist-photo:")) {
    const body = text.slice("eu-checklist-photo:".length);
    const a = body.indexOf(":");
    const b = a < 0 ? -1 : body.indexOf(":", a + 1);
    if (b < 0) return null;
    const phase = body.slice(0, a);
    const id = body.slice(a + 1, b);
    if (!["in", "out"].includes(phase) || !UUID.test(id)) return null;
    return { moveIn: phase === "in", key: body.slice(b + 1) };
  }
  if (!text.startsWith("eu-checklist:")) return null;
  const body = text.slice("eu-checklist:".length);
  if (body.startsWith("in:")) return { moveIn: true, key: body.slice(3) };
  if (body.startsWith("out:")) return { moveIn: false, key: body.slice(4) };
  return null;
};

// InspectionPhotoRecovery.meterCaption: «Strøm (kWh) – Sjekkliste for innflytting».
export const METER_TITLES = { electricity: "Strøm (kWh)", water: "Vann (m³)", heating: "Fjernvarme (MWh)" };
const PHASE_TITLE = { in: "Sjekkliste for innflytting", out: "Sjekkliste for utflytting" };
export const meterCaption = (kind, moveIn) => `${METER_TITLES[kind]} – ${PHASE_TITLE[moveIn ? "in" : "out"]}`;
export const parseMeterCaption = (caption) => {
  for (const kind of Object.keys(METER_TITLES)) {
    if (caption === meterCaption(kind, true)) return { moveIn: true, kind };
    if (caption === meterCaption(kind, false)) return { moveIn: false, kind };
  }
  return null;
};

// The settlement row id: titleKey, else the custom title.
export const rowKey = (row) => (typeof row?.k === "string" && row.k) || (typeof row?.t === "string" && row.t) || "";
const isDeleted = (row) => typeof row?.x === "string" && row.x.trim() !== "";

const byAge = (a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || String(a.id).localeCompare(String(b.id));

/**
 * images: property_images rows ({ id, collection_id, caption, storage_path, status, created_at }).
 * collectionIds: the move-in/move-out inspections' image_collection_id.
 * keys: known checklist keys; photos for other keys are dropped.
 * → { checklist: Map<key, { in: [image], out: [image] }>, meters: Map<kind, { in, out }> }
 */
export const groupChecklistPhotos = (images, collectionIds, keys) => {
  const collections = new Set([...(collectionIds ?? [])].filter(Boolean));
  const known = new Set(keys ?? []);
  const checklist = new Map();
  const meters = new Map();
  const seen = new Set();
  const ready = (images ?? [])
    .filter((i) => i && i.status === "ready" && collections.has(i.collection_id) && String(i.storage_path ?? "").trim())
    .sort(byAge);
  for (const image of ready) {
    if (seen.has(image.storage_path)) continue;
    const photo = parseChecklistCaption(image.caption);
    if (photo) {
      if (!known.has(photo.key)) continue;
      seen.add(image.storage_path);
      const side = checklist.get(photo.key) ?? { in: [], out: [] };
      side[photo.moveIn ? "in" : "out"].push(image);
      checklist.set(photo.key, side);
      continue;
    }
    const meter = parseMeterCaption(image.caption);
    if (!meter) continue;
    seen.add(image.storage_path);
    const side = meters.get(meter.kind) ?? { in: [], out: [] };
    side[meter.moveIn ? "in" : "out"].push(image);
    meters.set(meter.kind, side);
  }
  return { checklist, meters };
};

// Same JPEG bytes are shown once: data URLs in order, failed downloads (null) left out.
export const uniqueUrls = (urls) => {
  const out = [];
  for (const u of urls ?? []) if (u && !out.includes(u)) out.push(u);
  return out;
};

const SEPARATE = /item\.(keys|meters)$/;
const answered = (row) => row?.d === true || (typeof row?.c === "string" && row.c.trim() !== "") || row?.p === true;
const text = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * DepositHandoverComparison rows from the shared notes: the move-out list (with its baseline
 * bd/bc), then answered move-in points that are not on it. Key and meter points are left out
 * (they have their own rows).
 * → [{ key, row, inDone, inNote, outDone, outNote }]
 */
export const comparisonRows = (moveInData, moveOutData) => {
  const inRows = (Array.isArray(moveInData?.in) ? moveInData.in : [])
    .concat(Array.isArray(moveOutData?.in) ? moveOutData.in : []);
  const moveInByKey = new Map();
  for (const r of inRows) {
    const key = rowKey(r);
    if (key && answered(r) && !isDeleted(r) && !moveInByKey.has(key)) moveInByKey.set(key, r);
  }
  const rows = [];
  const listed = new Set();
  for (const r of Array.isArray(moveOutData?.out) ? moveOutData.out : []) {
    const key = rowKey(r);
    if (!key || isDeleted(r) || listed.has(key)) continue;
    listed.add(key);
    const base = moveInByKey.get(key);
    rows.push({
      key, row: r,
      inDone: typeof r.bd === "boolean" ? r.bd : base ? base.d === true : null,
      inNote: text(r.bc) || text(base?.c),
      outDone: r.d === true,
      outNote: text(r.c),
    });
  }
  for (const [key, r] of moveInByKey) {
    if (listed.has(key) || SEPARATE.test(String(r.k ?? ""))) continue;
    listed.add(key);
    rows.push({ key, row: r, inDone: r.d === true, inNote: text(r.c), outDone: null, outNote: "" });
  }
  return rows;
};

// Meter readings from the shared notes (move-out note first, it carries both sides).
export const comparisonMeters = (moveInData, moveOutData) => {
  const result = new Map();
  for (const data of [moveOutData, moveInData]) {
    for (const m of Array.isArray(data?.meters) ? data.meters : []) {
      if (!METER_TITLES[m?.kind] || m.na) continue;
      const cur = result.get(m.kind) ?? { kind: m.kind, in: "", out: "" };
      if (!cur.in && m.in) cur.in = String(m.in);
      if (!cur.out && m.out) cur.out = String(m.out);
      result.set(m.kind, cur);
    }
  }
  return [...result.values()];
};
