// Bompenger i Kjørebok (iOS #1613, MILEAGE_TOLLS_ANDROID_PARITY). Pure helpers; no own tariff
// calculation: an estimate only ever comes from the server (mileage-route v10 with tolls: true).

export const TOLL_TEXT = {
  settings: "Bompenger",
  settingsTitle: "Innstillinger for kjørebok",
  sectionTitle: "Kjøreturinnstillinger",
  settingsSubtitle: "Endringer her vil gjelde for neste registrerte kjøretur. Tidligere turer påvirkes ikke, men kan redigeres manuelt.",
  vehicleType: "Biltype",
  fossil: "Fossil",
  electric: "Elbil",
  autopass: "Bruker AutoPASS-brikke",
  include: "Ta med bompenger",
  title: "Bompenger",
  estimated: "Bompenger (beregnet)",
  kilometerDeduction: "Kilometerfradrag",
  total: "Sum fradrag",
  settingsError: "Kunne ikke oppdatere bompengeinnstillingene. Prøv igjen.",
  invalid: "Bompenger må være mellom 0 og 10 000 kr.",
  info: "Bompengene er et estimat og kan avvike litt fra AutoPASS-fakturaen, og bompenger som er med i kjøreboken, skal ikke føres under Utgifter i tillegg.",
};

export const TOLL_MAX_MINOR = 1_000_000;
// Per landlord; fossil, AutoPASS and «Ta med bompenger» on by default.
export const DEFAULT_TOLL_SETTINGS = Object.freeze({ vehicleType: "fossil", usesAutopass: true, includeTolls: true });

// get_/set_mileage_toll_settings return a list; a missing row or odd values fall back to defaults.
export const tollSettingsFrom = (data) => {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return { ...DEFAULT_TOLL_SETTINGS };
  return {
    vehicleType: row.vehicle_type === "electric" ? "electric" : "fossil",
    usesAutopass: row.uses_autopass !== false,
    includeTolls: row.include_tolls !== false,
  };
};
export const tollSettingsParams = (s) => ({
  requested_vehicle_type: s.vehicleType === "electric" ? "electric" : "fossil",
  requested_uses_autopass: s.usesAutopass !== false,
  requested_include_tolls: s.includeTolls !== false,
});

// «33,60» → 3360. Blank is null (no tolls); anything else must be 0–10 000 kr with at most two decimals.
export const tollInputMinor = (text) => {
  const clean = String(text ?? "").replace(/[\s\u00a0]|kr/gi, "").replace(",", ".");
  if (!clean) return { minor: null, valid: true };
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return { minor: null, valid: false };
  const minor = Math.round(Number(clean) * 100);
  return minor >= 0 && minor <= TOLL_MAX_MINOR ? { minor, valid: true } : { minor: null, valid: false };
};

// The trip's own toll, null for older rows without the fields.
export const tripTollMinor = (trip) => {
  const v = trip?.toll_amount_minor;
  return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
};
// amount_minor is km × sats only; the deduction adds the tolls (the expense already holds both).
export const tripTotalMinor = (trip) => Number(trip?.amount_minor ?? 0) + (tripTollMinor(trip) ?? 0);
export const tollBreakdown = (trips) => {
  const kilometerMinor = (trips ?? []).reduce((a, t) => a + Number(t.amount_minor ?? 0), 0);
  const tollMinor = (trips ?? []).reduce((a, t) => a + (tripTollMinor(t) ?? 0), 0);
  return { kilometerMinor, tollMinor, totalMinor: kilometerMinor + tollMinor };
};

// The field shows when tolls are included, or the trip already has a stored amount.
export const showsTollField = (settings, trip) => settings.includeTolls || tripTollMinor(trip) != null;
export const tollLabel = (estimated) => (estimated ? TOLL_TEXT.estimated : TOLL_TEXT.title);

// MileageComposerView: create sends null when empty or tolls are off; correct sends 0 + false to clear
// (null would mean «keep the original»). A hand-typed amount is never «beregnet».
export const tollParams = ({ settings, input, estimated, correcting }) => {
  const amount = settings.includeTolls ? tollInputMinor(input).minor : null;
  if (correcting) return { requested_toll_amount_minor: amount ?? 0, requested_toll_estimated: amount == null ? false : !!estimated };
  return { requested_toll_amount_minor: amount, requested_toll_estimated: amount == null ? null : !!estimated };
};
