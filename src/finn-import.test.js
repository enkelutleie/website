import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyFinnFailure,
  extractFinnCode,
  finnImportMessage,
  mapFinnListing,
  sniffImage,
} from "./finn-import.js";

const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
]).toString("base64");

describe("extractFinnCode", () => {
  it("accepts a bare numeric code, including spaces and dashes", () => {
    assert.equal(extractFinnCode("391234567"), "391234567");
    assert.equal(extractFinnCode("  39123  "), "39123");
    assert.equal(extractFinnCode("391234567."), "391234567");
    assert.equal(extractFinnCode("3912-34567"), "391234567");
  });

  it("rejects codes outside 5–12 digits and non-codes", () => {
    assert.equal(extractFinnCode(""), null);
    assert.equal(extractFinnCode("1234"), null);
    assert.equal(extractFinnCode("1234567890123"), null);
    assert.equal(extractFinnCode("kode 391234567"), null);
    assert.equal(extractFinnCode("https://example.com/391234567"), null);
    assert.equal(extractFinnCode("https://www.finn.no.evil.com/391234567"), null);
    assert.equal(extractFinnCode("https://notfinn.no/391234567"), null);
  });

  it("reads finnkode from a finn.no URL, or the numeric path", () => {
    assert.equal(
      extractFinnCode("https://www.finn.no/realestate/homes/ad.html?finnkode=391234567&utm=copy"),
      "391234567",
    );
    assert.equal(
      extractFinnCode("https://www.finn.no/realestate/lettings/ad.html?FINNKODE=12345678"),
      "12345678",
    );
    assert.equal(extractFinnCode("https://finn.no/391234567/"), "391234567");
    assert.equal(extractFinnCode("www.finn.no/391234567"), "391234567");
    assert.equal(
      extractFinnCode("Se https://www.finn.no/99999999?finnkode=12345678."),
      "12345678",
    );
    assert.equal(extractFinnCode("https://www.finn.no/realestate/homes/ad.html"), null);
  });
});

describe("finnImportMessage", () => {
  it("has clear Norwegian copy for the four failure modes", () => {
    assert.match(finnImportMessage("invalid_code"), /FINN-kode/);
    assert.match(finnImportMessage("not_found"), /Fant ikke annonsen/);
    assert.match(finnImportMessage("unauthorized"), /ikke logget inn/);
    assert.match(finnImportMessage("network"), /nettverket/);
    assert.match(finnImportMessage("missing_address"), /mangler adresse/);
  });
});

describe("classifyFinnFailure", () => {
  it("maps function error codes and HTTP status", () => {
    assert.equal(classifyFinnFailure({ code: "not_found", status: 404 }), "not_found");
    assert.equal(classifyFinnFailure({ status: 401 }), "unauthorized");
    assert.equal(classifyFinnFailure({ status: 400 }), "invalid_code");
    assert.equal(classifyFinnFailure({ code: "missing_address", status: 422 }), "missing_address");
    assert.equal(classifyFinnFailure({ code: "network", status: 502 }), "network");
    assert.equal(classifyFinnFailure({ name: "FunctionsFetchError", message: "Failed to fetch" }), "network");
    assert.equal(classifyFinnFailure({ status: 500, message: "boom" }), "unknown");
  });
});

describe("mapFinnListing", () => {
  it("prefills the property fields and keeps extra facts as notes", () => {
    const mapped = mapFinnListing({
      title: "Leilighet i Storgata",
      address_line1: "Storgata 1",
      unit_identifier: "H0101",
      postal_code: "NO-0155",
      city: "Oslo",
      rent: "15 000",
      deposit: "45 000",
      area: "62 m²",
      rooms: "3",
      images_base64: [jpeg],
      personnummer: "01010112345",
      national_id: "01010112345",
    }, "391234567");

    assert.deepEqual(mapped.fields, {
      address: "Storgata 1",
      unit: "H0101",
      postal: "0155",
      city: "Oslo",
      finn: "391234567",
    });
    assert.equal(mapped.title, "Leilighet i Storgata");
    assert.deepEqual(mapped.notes.map(([label]) => label), ["Husleie", "Depositum", "Areal", "Rom"]);
    assert.equal(mapped.images.length, 1);
    assert.equal(mapped.images[0].mediaType, "image/jpeg");
    assert.equal(JSON.stringify({ ...mapped, images: mapped.images.length }).includes("01010112345"), false);
  });

  it("drops an 11-digit national id even if it arrives in a text field", () => {
    const mapped = mapFinnListing({
      address_line1: "01010112345",
      title: "010101 12345",
      rent: "01010112345",
    }, "391234567");
    assert.equal(mapped.fields.address, "");
    assert.equal(mapped.title, "");
    assert.equal(mapped.notes.length, 0);
  });

  it("ignores non-images and unknown payloads", () => {
    assert.equal(mapFinnListing(null, "391234567").fields.finn, "391234567");
    const text = Buffer.from("this is not an image!!").toString("base64");
    assert.equal(mapFinnListing({ images_base64: [text, "@@@"] }, "391234567").images.length, 0);
    assert.equal(sniffImage(new Uint8Array([0, 1, 2])), null);
  });
});
