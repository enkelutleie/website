import { extractFinnCode, finnImageDataUrl, finnImportMessage, mapFinnListing } from "./finn-import.js";

const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

const fileFor = (image, index) => {
  const type = image.mediaType?.startsWith("image/") ? image.mediaType : "image/jpeg";
  const ext = { "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[type] ?? "jpg";
  return new File([image.bytes], `finn-${index + 1}.${ext}`, { type });
};

// The «Hent fra FINN» block above the fields in Ny bolig. fetchListing(code)
// returns { data } or { error } (Norwegian message). Nothing is saved here.
export function createFinnImport({ fetchListing }) {
  let bound = null;
  let files = [];
  let loading = false;
  let locked = false;

  const section = h("section", "pt-finn");
  section.append(h("h3", "pt-sheet-title", "Hent fra FINN"));
  section.append(h("p", "pt-field-help", "Lim inn FINN-koden eller hele lenken fra finn.no. Du kan se over og endre opplysningene før boligen lagres."));

  const row = h("div", "pt-finn-row");
  const field = h("label", "pt-field");
  field.append(h("span", "pt-field-label", "FINN-kode eller lenke"));
  const input = h("input", "pt-input");
  input.type = "text";
  input.maxLength = 2048;
  input.placeholder = "391234567 eller finn.no/…";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocapitalize", "off");
  input.dataset.ptSkipFocus = "";
  field.append(input);
  const button = h("button", "pt-btn pt-btn-secondary", "Hent annonse");
  button.type = "button";
  row.append(field, button);
  section.append(row);

  const loadingNote = h("p", "pt-finn-status", "Henter annonse …");
  loadingNote.setAttribute("role", "status");
  loadingNote.hidden = true;
  const error = h("p", "pt-form-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const status = h("p", "pt-finn-status is-ok");
  status.setAttribute("role", "status");
  status.hidden = true;
  const notes = h("ul", "pt-finn-notes");
  notes.hidden = true;
  const photos = h("ul", "pt-finn-photos");
  photos.hidden = true;
  const include = h("label", "pt-finn-include");
  const includeInput = h("input", "pt-check");
  includeInput.type = "checkbox";
  includeInput.checked = true;
  const includeText = h("span", null, "Ta med bildene når boligen opprettes");
  include.append(includeInput, includeText);
  include.hidden = true;
  section.append(loadingNote, error, status, notes, photos, include);

  const paint = () => {
    const off = loading || locked;
    input.disabled = off;
    button.disabled = off;
    includeInput.disabled = off;
    button.textContent = loading ? "Henter …" : "Hent annonse";
    section.setAttribute("aria-busy", loading ? "true" : "false");
    loadingNote.hidden = !loading;
    // Block «Opprett bolig» while the listing is in flight, so a save cannot
    // race ahead of the prefilled fields. Only undo a lock this block applied.
    const submit = section.closest("form")?.querySelector("button[type=submit]");
    if (!submit) return;
    if (loading) {
      submit.disabled = true;
      submit.dataset.finnLock = "1";
    } else if (submit.dataset.finnLock === "1" && !locked) {
      submit.disabled = false;
      delete submit.dataset.finnLock;
    }
  };

  const showError = (text) => {
    error.textContent = text;
    error.hidden = false;
    input.setAttribute("aria-invalid", "true");
    status.hidden = true;
  };

  const clearError = () => {
    error.textContent = "";
    error.hidden = true;
    input.removeAttribute("aria-invalid");
  };

  const fill = (name, value) => {
    const el = bound?.[name];
    if (!el) return;
    el.value = value ?? "";
  };

  const apply = (mapped) => {
    fill("address", mapped.fields.address);
    fill("unit", mapped.fields.unit);
    fill("postal", mapped.fields.postal);
    fill("city", mapped.fields.city);
    fill("finn", mapped.fields.finn);

    notes.replaceChildren();
    if (mapped.title) notes.append(h("li", null, `Annonsetittel: ${mapped.title}`));
    for (const [label, value] of mapped.notes) notes.append(h("li", null, `${label}: ${value}`));
    notes.hidden = notes.childElementCount === 0;

    photos.replaceChildren();
    files = [];
    mapped.images.forEach((image) => {
      let src = "";
      try { src = finnImageDataUrl(image); } catch { src = ""; }
      if (!src) return;
      files.push(fileFor(image, files.length));
      const li = h("li");
      const img = h("img");
      img.className = "pt-finn-thumb";
      img.alt = `Bilde ${files.length} fra FINN-annonsen`;
      img.src = src;
      li.append(img);
      photos.append(li);
    });
    photos.hidden = files.length === 0;
    include.hidden = files.length === 0;
    includeInput.checked = files.length > 0;
    includeText.textContent = files.length === 1
      ? "Ta med bildet når boligen opprettes"
      : "Ta med bildene når boligen opprettes";

    status.textContent = mapped.fields.address
      ? "Annonsen er hentet. Se over feltene før du lagrer."
      : "Annonsen er hentet, men uten gateadresse. Fyll inn adressen selv.";
    status.hidden = false;
    clearError();
    bound?.address?.focus();
  };

  const run = async () => {
    if (loading || locked) return;
    const code = extractFinnCode(input.value);
    if (!code) {
      showError(finnImportMessage("invalid_code"));
      return;
    }
    clearError();
    status.hidden = true;
    loading = true;
    paint();
    let result;
    try {
      result = await fetchListing(code);
    } catch {
      result = { error: finnImportMessage("network") };
    }
    loading = false;
    if (!section.isConnected) return;
    paint();
    if (!result || result.error || !result.data) {
      showError(result?.error || finnImportMessage("unknown"));
      return;
    }
    apply(mapFinnListing(result.data, code));
  };

  button.addEventListener("click", () => { run(); });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    run();
  });

  return {
    section,
    bind(inputs) { bound = inputs; },
    setLocked(on) { locked = !!on; if (section.isConnected) paint(); },
    files() { return include.hidden || !includeInput.checked ? [] : files.slice(); },
  };
}
