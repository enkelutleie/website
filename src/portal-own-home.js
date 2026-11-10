// «Del av egen bolig» (iOS #1591, OWN_HOME_TAX_FREE_ANDROID_PARITY): the form asks
// «Bruker du minst halvparten av boligen selv?» and sends uses_at_least_half in rental_profile.
// The server keeps home_use, rental_duration and uses_at_least_half in private tax facts and masks
// them on properties.rental_profile, so the form reads them from list_managed_property_rental_tax_facts.

export const HALF_USE_QUESTION = "Bruker du minst halvparten av boligen selv?";
export const HALF_USE_HELP = "Utleie av del av egen bolig er skattefri når du selv bruker minst halvparten, målt etter utleieverdi. Leier du ut mer enn halvparten, er hele leieinntekten skattepliktig. Er årets leieinntekt 20 000 kr eller mindre, er den likevel skattefri.";
export const HALF_USE_REQUIRED = "Velg om du bruker minst halvparten av boligen selv.";

// Choice value for the custom ja/nei control: "" until answered.
export const halfUseChoiceValue = (answer) => (answer === true ? "yes" : answer === false ? "no" : "");
export const halfUseOptions = (answer) => {
  const yesNo = [["yes", "Ja"], ["no", "Nei"]];
  return answer === true || answer === false ? yesNo : [["", "Velg ja eller nei"], ...yesNo];
};

// Only own_home carries an answer; any other use clears it (as PropertyRentalProfileChoice).
export const usesAtLeastHalfFor = (use, choice) =>
  use === "own_home" ? (choice === "yes" ? true : choice === "no" ? false : null) : null;

// The rental_profile the app sends. facts: the row from list_managed_property_rental_tax_facts
// (the stored rental_profile has home_use/rental_duration masked to «unknown»).
export const rentalProfileOf = (use, existing, facts, choice) => {
  const duration = [facts?.rental_duration, existing?.rental_duration].find((d) => d && d !== "unknown");
  return {
    landlord_kind: existing?.landlord_kind ?? "individual",
    legal_form: existing?.legal_form ?? null,
    business_name: existing?.business_name ?? "",
    organization_number: existing?.organization_number ?? "",
    home_use: use,
    rental_duration: duration ?? "long_term",
    uses_at_least_half: usesAtLeastHalfFor(use, choice),
  };
};

// Use shown in the form: the stored fact, else a known value on the profile, else other_home.
export const formHomeUse = (facts, existing, known) =>
  [facts?.home_use, existing?.home_use].find((u) => known.includes(u)) ?? "other_home";
