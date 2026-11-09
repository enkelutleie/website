// Finn.no import for the landlord portal. Mirrors the deployed `finn-listing`
// edge function (same code rules as FinnListingHTMLParser in the iOS app).
// Pure data: no DOM, no Supabase client, no writes.

export const FINN_CODE_PATTERN = /^[0-9]{5,12}$/;
const MAX_IMAGE_BYTES = 1_572_864;

const NATIONAL_ID = /^\d{11}$/;

export function isStoredFinnCode(raw) {
  return FINN_CODE_PATTERN.test(String(raw ?? "").replace(/\D/g, ""));
}

// A bare code (digits, spaces or dashes) or a finn.no URL (?finnkode= or a
// numeric path segment). Anything else is rejected before the network call.
export function extractFinnCode(raw) {
  const text = String(raw ?? "").trim().replace(/[),.;]+$/, "");
  if (!text) return null;

  const compact = text.replace(/[\s-]/g, "");
  if (!/[a-z]/i.test(text) && !text.includes(".") && FINN_CODE_PATTERN.test(compact)) return compact;

  const url = findFinnUrl(text);
  if (!url || !isFinnHost(url.hostname)) return null;

  for (const [key, value] of url.searchParams) {
    if (key.toLowerCase() === "finnkode" && FINN_CODE_PATTERN.test(value)) return value;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i].replace(/\.(html?|php)$/i, "");
    if (FINN_CODE_PATTERN.test(segment)) return segment;
  }
  return null;
}

function findFinnUrl(text) {
  const match = text.match(/https?:\/\/[^\s]+|(?:www\.)?finn\.no\/[^\s]+/i);
  if (!match) return null;
  const candidate = match[0].replace(/[),.;]+$/, "");
  try {
    return new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
  } catch {
    return null;
  }
}

function isFinnHost(hostname) {
  const host = String(hostname ?? "").toLowerCase().replace(/\.$/, "");
  return host === "finn.no" || host.endsWith(".finn.no");
}

export function finnImportMessage(kind) {
  switch (kind) {
    case "invalid_code":
      return "Skriv inn en gyldig FINN-kode (5–12 siffer) eller en finn.no-lenke.";
    case "not_found":
      return "Fant ikke annonsen. Sjekk koden og prøv igjen.";
    case "missing_address":
      return "Annonsen mangler adresse. Fyll inn opplysningene selv.";
    case "unauthorized":
      return "Du er ikke logget inn. Logg inn på nytt og prøv igjen.";
    case "network":
      return "Kunne ikke hente annonsen. Sjekk nettverket og prøv igjen.";
    default:
      return "Kunne ikke hente annonsen. Prøv igjen om litt.";
  }
}

export function classifyFinnFailure({ code, status, name, message } = {}) {
  const kind = String(code ?? "").toLowerCase();
  if (["invalid_code", "not_found", "missing_address", "unauthorized", "network"].includes(kind)) return kind;
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 400) return "invalid_code";
  if (status === 422) return "missing_address";
  if (status === 502 || status === 504 || status === 0 || name === "FunctionsFetchError") return "network";
  if (/failed to fetch|networkerror|timeout|abort|load failed/i.test(String(message ?? ""))) return "network";
  return "unknown";
}

const clamp = (value, max) => [...String(value ?? "")].slice(0, max).join("");

function publicText(value, max) {
  const text = clamp(String(value ?? "").trim(), max);
  if (!text || NATIONAL_ID.test(text.replace(/\s/g, ""))) return "";
  return text;
}

function pick(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

// Fields the Ny bolig form can store, plus display-only notes (title, rent, …).
// National identity numbers are never copied into fields or notes.
export function mapFinnListing(payload, code) {
  const source = payload && typeof payload === "object" ? payload : {};
  const address = publicText(pick(source, ["address_line1", "address", "street_address", "streetAddress", "street"]), 160);
  const unit = publicText(pick(source, ["unit_identifier", "unit", "unitIdentifier", "apartment"]), 30);
  const postal = pick(source, ["postal_code", "postalCode", "postcode", "zip"]).replace(/\D/g, "").slice(0, 4);
  const city = publicText(pick(source, ["city", "postal_name", "postalName", "poststed"]), 100);
  const title = publicText(pick(source, ["title", "heading", "name"]), 200);
  const notes = [];
  const rent = publicText(pick(source, ["rent", "monthly_rent", "monthlyRent", "price", "rent_amount"]), 40);
  const deposit = publicText(pick(source, ["deposit", "deposit_amount", "depositAmount"]), 40);
  const area = publicText(pick(source, ["area", "size", "sqm", "area_sqm", "usable_area", "bra", "prom"]), 40);
  const rooms = publicText(pick(source, ["rooms", "room_count", "roomCount", "bedrooms"]), 20);
  if (rent) notes.push(["Husleie", rent]);
  if (deposit) notes.push(["Depositum", deposit]);
  if (area) notes.push(["Areal", area]);
  if (rooms) notes.push(["Rom", rooms]);
  return {
    fields: { address, unit, postal, city, finn: FINN_CODE_PATTERN.test(code) ? code : "" },
    title,
    notes,
    images: listingImages(source),
  };
}

function listingImages(source) {
  const raw = source.images_base64 ?? source.imagesBase64 ?? source.images;
  if (!Array.isArray(raw)) return [];
  const images = [];
  for (const item of raw) {
    if (images.length >= 6) break;
    const encoded = typeof item === "string" ? item : item?.base64 ?? item?.data ?? item?.content;
    const bytes = decodeBase64(encoded);
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) continue;
    const mediaType = sniffImage(bytes);
    if (!mediaType) continue;
    images.push({ bytes, mediaType });
  }
  return images;
}

export function decodeBase64(value) {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/^data:[^,]*,/, "").replace(/\s/g, "");
  if (!clean || clean.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  try {
    const binary = atob(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function sniffImage(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

export function finnImageDataUrl(image) {
  const type = image?.mediaType?.startsWith("image/") ? image.mediaType : "image/jpeg";
  const bytes = image?.bytes ?? new Uint8Array();
  let binary = "";
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return `data:${type};base64,${btoa(binary)}`;
}
