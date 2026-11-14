// Premium for the landlord portal.
//
// The portal stays open. A closable dialog is the only paywall, and it opens
// when a landlord without Premium tries one of the gated actions (new income
// or expense, new mileage trip, new furniture, tenant invite, new contract)
// or when creating a home is rejected with premium_required. The first home
// is still free; the trigger on `properties` is the authority for home number
// two (premium_required) and home number five (consumer_property_cap).
// Tenants never see the dialog.
//
// Premium is an active subscription OR a row in private.complimentary_access.
// Clients cannot read that table. public.get_my_complimentary_access() is
// security definer and answers the caller's own status. No schema change.

export const PREMIUM_TITLE = "Premium for utleier";
export const PREMIUM_BODY = "Få full kontroll på utleien – alt samlet på ett sted. Spar tid, hold oversikten og administrer boligene dine enkelt og effektivt.";
export const PREMIUM_FREE_LINE = "Opprett bolig gratis, og oppgrader når du er klar for mer!";
export const PREMIUM_APP_NOTE = "Premium kjøpes i Enkel Utleie-appen.";
export const PROPERTY_CAP_TEXT = "Premium dekker inntil fire boliger. Arkiver en bolig under «Rediger informasjon» for å legge til en ny.";

export const PREMIUM_PLAN_MONTHLY = "Premium månedlig";
export const PREMIUM_PLAN_YEARLY = "Premium årlig";
export const PREMIUM_MONTHLY_MINOR = 4900;
export const PREMIUM_YEARLY_MINOR = 44900;
export const PREMIUM_MONTHLY_PERIOD = "per måned";
export const PREMIUM_YEARLY_PERIOD = "per år";

// Returned from a form submit so the sheet stays open and nothing is saved.
export const PREMIUM_BLOCKED = Symbol("premium_blocked");

const ACTIVE_STATUS = new Set(["active", "grace", "canceled"]);

// Whole kroner only. 12 × 49 kr − 449 kr = 139 kr. Anything else is not a simple pill.
export function premiumYearlySavingsMinor(monthlyMinor = PREMIUM_MONTHLY_MINOR, yearlyMinor = PREMIUM_YEARLY_MINOR) {
  const saved = monthlyMinor * 12 - yearlyMinor;
  if (saved <= 0 || saved % 100 !== 0) return null;
  return saved;
}

export function premiumSavingsLabel(minor = premiumYearlySavingsMinor()) {
  if (minor == null) return null;
  return `Spar ${minor / 100} kr per år`;
}

export function premiumPriceText(minor) {
  if (minor == null || minor % 100 !== 0) return null;
  return `${minor / 100} kr`;
}

// A tenant is never gated. Everyone else in the landlord portal is.
export function premiumGateApplies({ premium = false, role } = {}) {
  if (role === "tenant") return false;
  return premium !== true;
}

// subscription_entitlements (production, unexpired) or complimentary access.
// Same status predicate as private.property_creation_has_premium.
export function premiumFromReads({
  complimentary = false,
  entitlements = null,
  entitlementsError = false,
  complimentaryError = false,
  now = Date.now(),
} = {}) {
  if (complimentary === true) return { ok: true };
  if (entitlementsError && complimentaryError) return { ok: false, unknown: true };
  const active = (Array.isArray(entitlements) ? entitlements : []).some((row) =>
    ACTIVE_STATUS.has(row?.status) && row?.expires_at && new Date(row.expires_at).getTime() > now);
  return { ok: active };
}

const errorBlob = (error) => [error?.message, error?.details, error?.hint].filter((part) => part != null).join(" ");

export function propertyInsertPremiumRejection(error) {
  if (!error || typeof error !== "object") return false;
  return /\bpremium_required\b/.test(errorBlob(error));
}

export function propertyInsertCap(error) {
  if (!error || typeof error !== "object") return false;
  return /\bconsumer_property_cap\b/.test(errorBlob(error));
}
