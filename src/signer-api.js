// Public signing page (enkelutleie.com/signer/<token>). Pure helpers, no DOM, so they are testable in node.
export const SIGNING_ENDPOINT = "https://jfrorhixjsuomwtjwqla.supabase.co/functions/v1/contract-public-signing";

export function tokenFromPath(pathname) {
  const match = /^\/signer\/([A-Za-z0-9_-]{43})\/?$/u.exec(String(pathname ?? ""));
  return match ? match[1] : null;
}


export const ERROR_TEXT = {
  token_invalid: "Lenken er ugyldig. Sjekk at du har åpnet hele lenken fra e-posten, eller be utleier sende en ny.",
  token_expired: "Lenken har utløpt. Be utleier sende en ny signeringslenke fra appen.",
  already_signed: "Leiekontrakten er allerede signert. Du får den ferdige PDF-en på e-post.",
  cancelled: "Signeringen er avbrutt av utleier. Ta kontakt med utleier hvis du mener dette er feil.",
  superseded: "Denne lenken gjelder ikke lenger. Utleier har sendt en nyere lenke eller endret kontrakten. Bruk den nyeste e-posten.",
  agreement_changed: "Kontrakten er endret etter at lenken ble sendt. Be utleier sende en ny signeringslenke.",
  rate_limited: "For mange forsøk. Vent litt og prøv igjen.",
  invalid_signature: "Signaturen kunne ikke brukes. Tøm feltet og tegn den på nytt.",
  invalid_request: "Noe gikk galt. Last siden på nytt og prøv igjen.",
  forbidden_origin: "Siden må åpnes på enkelutleie.com.",
  server_error: "Vi har tekniske problemer akkurat nå. Prøv igjen om litt.",
  network: "Fikk ikke kontakt med Enkel Utleie. Sjekk nettforbindelsen og prøv igjen.",
};

export const errorText = (code) => ERROR_TEXT[code] ?? ERROR_TEXT.server_error;

// Errors that end the flow: no button can fix them on this page.
export const FINAL_ERRORS = new Set(["token_invalid", "token_expired", "already_signed", "cancelled", "superseded", "agreement_changed", "forbidden_origin"]);

export async function callSigning(body, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(SIGNING_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch {
    return { ok: false, error: "network" };
  }
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok || !data || data.error) {
    return { ok: false, error: typeof data?.error === "string" ? data.error : (response.status >= 500 ? "server_error" : "invalid_request"), data, status: response.status };
  }
  return { ok: true, data };
}

export function osloDateISO(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addressLine(property) {
  if (!property) return "";
  const street = [property.address, property.unit].filter(Boolean).join(", ");
  const city = [property.postal_code, property.city].filter(Boolean).join(" ");
  return [street, city].filter(Boolean).join(", ");
}

export const roleLabel = (role) => (role === "landlord" ? "Utleier" : role === "tenant" ? "Leietaker" : "Part");

export function base64ToBytes(value) {
  const binary = atob(String(value ?? ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function signatureBody({ token, jpegBase64, width, height, signerName, place, now = new Date() }) {
  return {
    action: "sign",
    token,
    approved: true,
    signature: {
      jpeg_base64: jpegBase64,
      width,
      height,
      signer_name: String(signerName ?? "").trim().slice(0, 120) || "Leietaker",
      place: String(place ?? "").trim().slice(0, 80),
      date: osloDateISO(now),
    },
  };
}

