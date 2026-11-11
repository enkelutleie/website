// Ny/Rediger kjøretur: distance and toll estimate from Edge mileage-route v11 address mode
// (iOS #1614). Mirrors MileageComposerController: the lookup fires 280 ms after the last
// address edit once both addresses have 3+ characters; kilometers fill unless typed by hand;
// «Bompenger (beregnet)» fills unless the toll was typed by hand; a changed address clears
// the route's toll and automatic km; stale answers are ignored. No DOM here.
import { TOLL_MAX_MINOR } from "./portal-mileage-tolls.js";

export const ROUTE_TEXT = {
  loading: "Beregner avstand…",
  unavailable: "Kunne ikke beregne avstand — skriv km selv",
  kmHint: "Fylles automatisk eller manuelt.",
  // address_not_found (field from mileage-route). iOS geocodes with MapKit and has no such text.
  notFound: {
    from_address: "Fant ikke fra-adressen. Sjekk adressen, eller skriv km selv.",
    to_address: "Fant ikke til-adressen. Sjekk adressen, eller skriv km selv.",
    any: "Fant ikke adressene. Sjekk adressene, eller skriv km selv.",
  },
};

export const ROUTE_DELAY_MS = 280;
export const ADDRESS_MIN = 3;
export const ADDRESS_MAX = 200;
// MileageLedger.minimumMeters / maximumMeters (0,1–2000 km).
const MIN_METERS = 100;
const MAX_METERS = 2_000_000;

const norm = (v) => String(v ?? "").trim();

// The Edge body: free-text endpoints, plus tolls and the landlord's settings when tolls are wanted.
export const routeRequestBody = ({ from, to, tolls, settings }) => ({
  from_address: norm(from),
  to_address: norm(to),
  ...(tolls ? { tolls: true, vehicle_type: settings?.vehicleType === "electric" ? "electric" : "fossil", uses_autopass: settings?.usesAutopass !== false } : {}),
});

// Edge answer → { meters, toll: { minor, estimated } | null }. Toll null when not included or out of range.
export const routeResult = (data) => {
  const meters = Number(data?.distanceMeters);
  const raw = data?.toll_included === true ? data?.toll_amount_minor : null;
  const minor = raw == null || !Number.isInteger(Number(raw)) ? null : Number(raw);
  const valid = minor != null && minor >= 0 && minor <= TOLL_MAX_MINOR ? minor : null;
  return {
    meters: Number.isFinite(meters) ? Math.round(meters) : null,
    toll: valid == null ? null : { minor: valid, estimated: data?.toll_estimated === true },
  };
};

export const routeErrorText = (failure) => {
  if (failure?.code !== "address_not_found") return { field: null, text: ROUTE_TEXT.unavailable };
  if (failure.field === "from_address" || failure.field === "to_address") return { field: failure.field, text: ROUTE_TEXT.notFound[failure.field] };
  return { field: null, text: ROUTE_TEXT.notFound.any };
};

/**
 * state: { km, toll, tollEstimated, loading, error: { field, text } | null }
 * estimate(body) -> Promise<{ data } | { failure: { code, field } }>
 * kmText(meters) -> "12,3"; tollText(minor) -> "33,60"; onUpdate(state) after every async change.
 */
export function routeComposer({ trip = null, settings, estimate, kmText, tollText, onUpdate = () => {}, delay = ROUTE_DELAY_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const state = {
    from: trip?.from_place ?? "",
    to: trip?.to_place ?? "",
    km: trip ? kmText(trip.distance_meters) : "",
    toll: trip?.toll_amount_minor != null ? tollText(trip.toll_amount_minor) : "",
    tollEstimated: trip?.toll_estimated === true && trip?.toll_amount_minor != null,
    loading: false,
    error: null,
  };
  // An existing trip keeps its stored km and toll; nothing is looked up until the route changes.
  let kmManual = !!trip;
  let kmAutomatic = false;
  let tollManual = false;
  let generation = 0;
  let timer = null;

  const invalidate = () => {
    generation += 1;
    if (timer != null) clearTimer(timer);
    timer = null;
    state.loading = false;
    tollManual = false;
    state.toll = "";
    state.tollEstimated = false;
    if (kmAutomatic) { state.km = ""; kmAutomatic = false; }
    kmManual = false;
    state.error = null;
  };

  const run = async () => {
    timer = null;
    const from = norm(state.from);
    const to = norm(state.to);
    if (from.length < ADDRESS_MIN || to.length < ADDRESS_MIN || from.length > ADDRESS_MAX || to.length > ADDRESS_MAX) return;
    const mine = ++generation;
    const wantsToll = settings.includeTolls && !tollManual;
    state.loading = true;
    if (!kmManual) state.error = null;
    onUpdate(state);
    let res;
    try {
      res = await estimate(routeRequestBody({ from, to, tolls: wantsToll, settings }));
    } catch {
      res = { failure: { code: null } };
    }
    if (mine !== generation) return;
    state.loading = false;
    const out = res?.data ? routeResult(res.data) : null;
    if (!out || out.meters == null) {
      if (!kmManual) {
        if (kmAutomatic) { state.km = ""; kmAutomatic = false; }
        if (!norm(state.km)) state.error = routeErrorText(res?.failure);
      }
      onUpdate(state);
      return;
    }
    // The toll fills only while still not typed by hand (a late answer never overwrites it).
    if (wantsToll && !tollManual) {
      state.toll = out.toll ? tollText(out.toll.minor) : "";
      state.tollEstimated = !!out.toll?.estimated;
    }
    if (!kmManual) {
      if (out.meters >= MIN_METERS && out.meters <= MAX_METERS) {
        state.km = kmText(out.meters);
        kmAutomatic = true;
        state.error = null;
      } else {
        state.error = { field: null, text: ROUTE_TEXT.unavailable };
      }
    }
    onUpdate(state);
  };

  const schedule = () => {
    if (timer != null) clearTimer(timer);
    timer = setTimer(run, delay);
  };

  return {
    state,
    editFrom(value) { invalidate(); state.from = value; schedule(); },
    editTo(value) { invalidate(); state.to = value; schedule(); },
    editKm(value) { state.km = value; kmManual = true; kmAutomatic = false; state.error = null; },
    editToll(value) { tollManual = true; state.toll = value; state.tollEstimated = false; },
    cancel() { generation += 1; if (timer != null) clearTimer(timer); timer = null; state.loading = false; },
    get kmAutomatic() { return kmAutomatic; },
    get tollManual() { return tollManual; },
  };
}
