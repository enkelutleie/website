// Which screens a signed-in user may open before Premium is active.
//
// Adjust this function when the product rule changes. It does not copy the
// database trigger on `properties`. That trigger decides whether the insert
// is stored, and the rule can change without a matching portal release.
//
// Boliger stays open: the list, the empty state, and «Ny bolig». Oversikt
// stays open only while there is no bolig, because that page is then the
// same empty state. Every other screen shows the paywall when opened.

export function portalFeatureAllowed(feature, { premium = false, propertyCount = 0 } = {}) {
  if (premium) return true;
  if (feature === "boliger") return true;
  if (feature === "oversikt" && propertyCount === 0) return true;
  return false;
}

// `properties` insert errors that mean "show the paywall". The message is the
// whole token. SQLSTATE P0001 is shared with the four-bolig cap, so the code
// alone is not enough. Add a token here when the final list arrives.
// `consumer_property_cap` is the cap, not this paywall.
const PROPERTY_PREMIUM_ERRORS = ["premium_required"];

export function propertyInsertPremiumRejection(error) {
  if (!error || typeof error !== "object") return false;
  const blob = [error.message, error.details, error.hint].filter((part) => part != null).join(" ");
  return PROPERTY_PREMIUM_ERRORS.some((token) => new RegExp(`\\b${token}\\b`).test(blob));
}
