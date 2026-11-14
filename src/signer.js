import {
  FINAL_ERRORS, addressLine, base64ToBytes, callSigning, errorText,
  roleLabel, signatureBody, tokenFromPath,
} from "./signer-api.js";

const root = document.querySelector("[data-signer]");
const token = tokenFromPath(location.pathname);
let landlordName = "";

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const button = (label, cls = "btn") => {
  const b = el("button", cls, label);
  b.type = "button";
  return b;
};
const card = (...children) => {
  const section = el("section", "signer-card");
  section.append(...children.filter(Boolean));
  return section;
};
const show = (...cards) => {
  root.replaceChildren(...cards);
  root.querySelector("h1, h2")?.focus?.({ preventScroll: true });
  window.scrollTo({ top: 0 });
};
const message = (text, tone = "error") => {
  const p = el("p", `signer-message is-${tone}`, text);
  p.setAttribute("role", tone === "error" ? "alert" : "status");
  return p;
};
const heading = (text, level = "h1") => {
  const h = el(level, null, text);
  h.tabIndex = -1;
  return h;
};
const busy = (b, on, label) => {
  b.disabled = on;
  if (label) b.textContent = label;
  b.setAttribute("aria-busy", on ? "true" : "false");
};

function finalError(code) {
  const title = code === "already_signed" ? "Allerede signert" : code === "token_expired" ? "Lenken har utløpt" : "Lenken kan ikke brukes";
  show(card(heading(title), el("p", "signer-lead", errorText(code)),
    el("p", "signer-muted", "Har du spørsmål? Ta kontakt med utleier, eller skriv til support@enkelutleie.com.")));
}

function handleError(res) {
  if (FINAL_ERRORS.has(res.error)) { finalError(res.error); return true; }
  return false;
}

const retryButton = (fn) => {
  const b = button("Prøv igjen");
  b.addEventListener("click", () => fn());
  return b;
};

/* ---------- 1. Kontrakten (åpnes direkte fra lenken) ---------- */
async function view() {
  if (!token) { finalError("token_invalid"); return; }
  show(card(el("p", "signer-muted", "Henter leiekontrakten …")));
  const res = await callSigning({ action: "view", token });
  if (!res.ok) {
    if (handleError(res)) return;
    show(card(heading("Noe gikk galt"), message(errorText(res.error)), retryButton(view)));
    return;
  }
  const data = res.data;
  landlordName = data.landlord_name || "";
  const bytes = base64ToBytes(data.pdf?.base64 ?? "");
  const blobURL = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const address = addressLine(data.property);

  const parties = el("ul", "signer-parties");
  for (const party of data.parties ?? []) {
    const li = el("li");
    li.append(el("span", "signer-role", roleLabel(party.role)), el("span", null, party.name || "–"));
    parties.append(li);
  }
  const download = el("a", "btn btn-secondary", "Last ned PDF");
  download.href = blobURL;
  download.download = "Leiekontrakt.pdf";

  const pages = el("div", "signer-pages");
  pages.append(el("p", "signer-muted", "Viser kontrakten …"));

  const summary = card(
    heading("Les leiekontrakten"),
    el("p", "signer-lead", address ? `Leiekontrakt for ${address}` : "Leiekontrakt"),
    landlordName ? el("p", null, `${landlordName} har sendt deg denne leiekontrakten til signering.`) : null,
    parties,
    el("p", "signer-muted", "Les hele kontrakten før du signerer. Du kan også laste den ned."),
    download,
  );
  const docSection = el("section", "signer-document");
  docSection.setAttribute("aria-label", "Leiekontrakten");
  docSection.append(pages);
  show(summary, docSection, signCard(data));
  renderPDF(bytes, pages, blobURL);
}

async function renderPDF(bytes, container, blobURL) {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true }).promise;
    container.replaceChildren();
    const width = Math.min(container.clientWidth || 600, 900);
    const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      const canvas = el("canvas", "signer-page-canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Side ${n} av ${pdf.numPages}`);
      container.append(canvas);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    }
    container.append(el("p", "signer-muted signer-end", `Slutt på kontrakten (${pdf.numPages} sider).`));
  } catch {
    const open = el("a", "btn", "Åpne kontrakten (PDF)");
    open.href = blobURL;
    open.target = "_blank";
    open.rel = "noopener";
    container.replaceChildren(el("p", null, "Vi klarte ikke å vise kontrakten her. Åpne PDF-en og les den før du signerer."), open);
  }
}

/* ---------- 2. Signatur ---------- */
function signaturePad() {
  const wrap = el("div", "signer-pad");
  const canvas = el("canvas", "signer-pad-canvas");
  canvas.width = 900;
  canvas.height = 300;
  canvas.setAttribute("aria-label", "Tegn signaturen din her med fingeren eller musen");
  const ctx = canvas.getContext("2d");
  let strokes = 0;
  const blank = () => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#1b3a6b";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokes = 0;
  };
  blank();
  let drawing = false;
  let last = null;
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (wrap.classList.contains("is-locked")) return;
    e.preventDefault();
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    last = at(e);
    ctx.beginPath();
    ctx.arc(last[0], last[1], 1.5, 0, Math.PI * 2);
    ctx.fillStyle = "#1b3a6b";
    ctx.fill();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    e.preventDefault();
    const point = at(e);
    ctx.beginPath();
    ctx.moveTo(...last);
    ctx.lineTo(...point);
    ctx.stroke();
    last = point;
    strokes += 1;
    wrap.dispatchEvent(new Event("change"));
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  const clear = button("Tøm", "btn-link");
  clear.addEventListener("click", () => { if (!wrap.classList.contains("is-locked")) { blank(); wrap.dispatchEvent(new Event("change")); } });
  const hint = el("p", "signer-muted signer-pad-hint", "Tegn signaturen med fingeren eller musen.");
  wrap.append(canvas, el("div", "signer-pad-actions"));
  wrap.lastChild.append(hint, clear);
  return {
    node: wrap,
    drawn: () => strokes >= 8,
    lock: (on) => wrap.classList.toggle("is-locked", on),
    jpeg: () => canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "",
    width: canvas.width,
    height: canvas.height,
  };
}

function signCard(data) {
  const name = data.party?.name || "Leietaker";
  const pad = signaturePad();
  const placeLabel = el("label", null, "Sted (valgfritt)");
  placeLabel.htmlFor = "signer-place";
  const place = el("input");
  Object.assign(place, { id: "signer-place", name: "place", maxLength: 80, autocomplete: "address-level2", placeholder: "For eksempel Oslo" });
  const check = el("label", "signer-check");
  const box = el("input");
  box.type = "checkbox";
  box.id = "signer-approve";
  check.append(box, el("span", null, "Jeg har lest leiekontrakten og godkjenner den."));
  const submit = button("Signer og send inn");
  submit.disabled = true;
  const status = el("div");
  const refresh = () => { submit.disabled = !(box.checked && pad.drawn()); };
  box.addEventListener("change", refresh);
  pad.node.addEventListener("change", refresh);

  submit.addEventListener("click", async () => {
    if (!box.checked) { status.replaceChildren(message("Kryss av for at du har lest og godkjenner kontrakten.")); return; }
    if (!pad.drawn()) { status.replaceChildren(message("Tegn signaturen din før du sender inn.")); return; }
    const jpeg = pad.jpeg();
    if (jpeg.length < 200 || jpeg.length > 466_000) { status.replaceChildren(message(errorText("invalid_signature"))); return; }
    busy(submit, true, "Signerer …");
    pad.lock(true);
    box.disabled = true;
    place.disabled = true;
    status.replaceChildren(message("Signerer og lager den ferdige kontrakten. Dette kan ta noen sekunder …", "info"));
    const res = await callSigning(signatureBody({ token, jpegBase64: jpeg, width: pad.width, height: pad.height, signerName: name, place: place.value }));
    if (res.ok) { done(); return; }
    pad.lock(false);
    box.disabled = false;
    place.disabled = false;
    busy(submit, false, "Signer og send inn");
    if (handleError(res)) return;
    status.replaceChildren(message(errorText(res.error)));
  });

  const signer = el("p", "signer-signer");
  signer.append(el("span", "signer-role", "Signeres av"), el("strong", null, name));
  return card(
    heading("Signer leiekontrakten", "h2"),
    signer,
    el("p", "signer-label", "Signatur"),
    pad.node,
    placeLabel, place,
    check,
    submit, status,
    el("p", "signer-muted", "Når du signerer, lagres signaturen, tidspunktet og hvilken versjon av kontrakten du signerte. Du og utleier får den ferdige PDF-en på e-post."),
  );
}

function done() {
  const ok = el("div", "signer-done-mark", "✓");
  ok.setAttribute("aria-hidden", "true");
  show(card(ok, heading("Leiekontrakten er signert"),
    el("p", "signer-lead", `Takk! ${landlordName ? `${landlordName} og du` : "Du og utleier"} får den ferdige, signerte leiekontrakten som PDF på e-post.`),
    el("p", "signer-muted", "Du kan lukke denne siden. Lenken kan ikke brukes igjen.")));
}

view();
