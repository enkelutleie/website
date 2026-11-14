import assert from "node:assert/strict";
import test from "node:test";
import { copyText, emailAddress, handbookEntries, phoneDial, textParts } from "./portal-handbook-copy.js";

test("phone href strips spaces and keeps +47; the display is untouched", () => {
  assert.equal(phoneDial("+47 412 34 567"), "+4741234567");
  assert.equal(phoneDial("+47\u00a0412 34 567"), "+4741234567");
  assert.equal(phoneDial("(+47) 412 34 567"), "+4741234567");
  assert.equal(phoneDial("412 34 567"), "41234567");
  assert.equal(phoneDial("0047 412 34 567"), "+4741234567");
  assert.equal(phoneDial("90011223"), "90011223");
});

test("short codes and meter ids are not phone numbers", () => {
  assert.equal(phoneDial("4321"), null);
  assert.equal(phoneDial("123456789"), null);
  assert.equal(phoneDial("707057500012345678"), null);
  assert.equal(phoneDial("hemmelig 123"), null);
  assert.equal(phoneDial(""), null);
});

test("an e-mail is the whole value, not a sentence", () => {
  assert.equal(emailAddress(" vakt@example.no "), "vakt@example.no");
  assert.equal(emailAddress("skriv til vakt@example.no"), null);
  assert.equal(emailAddress("ikke-en-epost"), null);
});

test("labelled lines are separate values; prose stays one block", () => {
  const entries = handbookEntries([
    "Nettverk: HjemmeNet",
    "Passord: hemmelig 123",
    "Adresse: Testveien 1, 0150 Oslo",
    "Portkode: 4321",
    "",
    "Stille etter kl. 23:00.",
    "Pant settes i boden.",
  ].join("\n"));
  assert.deepEqual(entries.map((entry) => [entry.label, entry.kind, entry.text]), [
    ["Nettverk", "text", "HjemmeNet"],
    ["Passord", "text", "hemmelig 123"],
    ["Adresse", "text", "Testveien 1, 0150 Oslo"],
    ["Portkode", "text", "4321"],
    [null, "text", "Stille etter kl. 23:00.\nPant settes i boden."],
  ]);
  assert.equal(entries[4].parts, null);
});

test("a phone value keeps the stored spelling and a dial target", () => {
  const [entry] = handbookEntries("Vakt: +47 412 34 567");
  assert.equal(entry.label, "Vakt");
  assert.equal(entry.kind, "phone");
  assert.equal(entry.text, "+47 412 34 567");
  assert.equal(entry.dial, "+4741234567");
});

test("an e-mail value is a mailto target", () => {
  const [entry] = handbookEntries("E-post: vakt@example.no");
  assert.deepEqual(entry, { label: "E-post", kind: "email", text: "vakt@example.no", email: "vakt@example.no", parts: null });
});

test("a sentence keeps phones and e-mails inline and leaves the rest as text", () => {
  const parts = textParts("Ring +47 412 34 567 eller skriv til vakt@example.no i dag.");
  assert.deepEqual(parts, [
    { type: "text", text: "Ring " },
    { type: "phone", text: "+47 412 34 567", dial: "+4741234567" },
    { type: "text", text: " eller skriv til " },
    { type: "email", text: "vakt@example.no", email: "vakt@example.no" },
    { type: "text", text: " i dag." },
  ]);
  assert.equal(textParts("Måler 707057500012345678"), null);
});

test("copyText writes through the clipboard API", async () => {
  let written = null;
  const ok = await copyText("hemmelig 123", {
    navigator: { clipboard: { writeText: async (value) => { written = value; } } },
  });
  assert.equal(ok, true);
  assert.equal(written, "hemmelig 123");
});

test("copyText falls back when the clipboard API is missing or rejects", async () => {
  const calls = [];
  const area = {
    value: "",
    className: "",
    setAttribute() {},
    select() { calls.push(["select", this.value]); },
    remove() { calls.push("remove"); },
  };
  const doc = {
    activeElement: { focus() { calls.push("focus"); } },
    createElement() { return area; },
    body: { append() { calls.push("append"); } },
    execCommand(command) {
      calls.push(command);
      return command === "copy";
    },
  };
  const missing = await copyText("kode", { navigator: {}, document: doc });
  assert.equal(missing, true);
  assert.equal(area.value, "kode");
  assert.equal(area.className, "pt-clipboard-fallback");
  assert.deepEqual(calls, ["append", ["select", "kode"], "copy", "remove", "focus"]);

  const rejected = await copyText("+47 412 34 567", {
    navigator: { clipboard: { writeText: async () => { throw new Error("denied"); } } },
    document: doc,
  });
  assert.equal(rejected, true);
  assert.equal(area.value, "+47 412 34 567");
});

test("copyText reports failure when nothing can write", async () => {
  assert.equal(await copyText("x", { navigator: {} }), false);
  assert.equal(await copyText("x", {
    navigator: {},
    document: {
      activeElement: null,
      createElement: () => ({ setAttribute() {}, select() {}, remove() {} }),
      body: { append() {} },
      execCommand: () => false,
    },
  }), false);
});
