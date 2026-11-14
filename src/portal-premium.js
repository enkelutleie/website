// Full-screen Premium wall for the landlord portal (iOS LandlordPremiumWall).
//
// A landlord without Premium and with zero homes (owner or co_landlord) uses
// the portal and can register the first home. As soon as they manage one
// home, the wall covers the whole portal. The property list must have
// answered before either is shown; until then the caller shows a spinner.
// Tenants are not in this count and never see the wall.
//
// The insert itself is decided by the triggers on `properties`
// (20261114200000_property_creation_first_free): the first home is stored
// without Premium, the next raises premium_required, and the fifth raises
// consumer_property_cap. Both are SQLSTATE P0001. Complimentary access
// counts as Premium.

export const PREMIUM_WALL_TITLE = "Premium for utleier";
export const PREMIUM_WALL_BODY = "Første bolig kan registreres gratis. Utleier trenger Premium for å bruke appen og for flere boliger. Leietaker er gratis. Premium dekker inntil 4 boliger.";
export const PROPERTY_CAP_TEXT = "Premium dekker inntil fire boliger. Arkiver en bolig under «Rediger informasjon» for å legge til en ny.";

// "hidden" shows the portal. "loading" is the spinner. "wall" covers everything.
export function landlordPremiumWall({
  premium = false,
  premiumLoading = false,
  propertyCount = 0,
  propertiesResolved = false,
  forceWall = false,
} = {}) {
  if (premium) return "hidden";
  if (forceWall || propertyCount >= 1) return premiumLoading ? "loading" : "wall";
  return propertiesResolved ? "hidden" : "loading";
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
