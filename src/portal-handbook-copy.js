// Boligperm values: copy the text as shown, and build tel/sms/mailto targets
// from it. The visible string stays as stored. Only the href is normalised.

export const COPY_TEXT = "Kopier";
export const COPIED_TEXT = "Kopiert";
export const COPY_FAILED_TEXT = "Kunne ikke kopiere";
export const CALL_TEXT = "Ring";
export const SMS_TEXT = "Send SMS";

const PHONE_CHARS = /^[+()\d][\d\s\u00a0\u2007\u202f().+\-]*$/;
const SEPARATORS = /[\s\u00a0\u2007\u202f().\-]/g;
// A candidate is 8–15 digits, with an optional leading +. Lookarounds stop it
// from eating a longer code such as an 18-digit målepunkt-ID.
const PHONE_RE = /(?<![\d+])\+?(?:[\s\u00a0\u2007\u202f().\-]*\d){8,15}(?!\d)/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LABEL_RE = /^([\p{L}][\p{L}\p{N} .'/&()+\-]{0,39}):\s*(\S[\s\S]*)$/u;

// Strip spaces (and dialling punctuation). Keep a leading +47. A 0047 prefix
// becomes +47 so the country code is still there. A national number stays 8 digits.
export function phoneDial(raw) {
  const text = String(raw ?? "").trim();
  if (!text || !PHONE_CHARS.test(text)) return null;
  const compact = text.replace(SEPARATORS, "");
  if (!/^\+?\d+$/.test(compact)) return null;
  let body = compact;
  let plus = body.startsWith("+");
  if (plus) body = body.slice(1);
  else if (body.startsWith("00")) {
    plus = true;
    body = body.slice(2);
  }
  if (!/^\d+$/.test(body)) return null;
  if (plus) {
    if (body.length < 8 || body.length > 15) return null;
    return `+${body}`;
  }
  if (body.length !== 8) return null;
  return body;
}

export function emailAddress(raw) {
  const text = String(raw ?? "").trim();
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(text)) return null;
  return text;
}

function splitLabel(line) {
  const match = LABEL_RE.exec(line.trim());
  if (!match) return null;
  const label = match[1].trim();
  // "kl. 23:00" is a time, not a labelled field.
  if (!label || /\d$/.test(label)) return null;
  return { label, value: match[2].trim() };
}

function trimPhoneMatch(source, index, raw) {
  let start = index;
  let text = raw;
  const lead = /^[\s\u00a0\u2007\u202f]+/.exec(text);
  if (lead) {
    start += lead[0].length;
    text = text.slice(lead[0].length);
  }
  text = text.replace(/[\s\u00a0\u2007\u202f().\-]+$/u, "");
  return { start, end: start + text.length, text: source.slice(start, start + text.length) };
}

// Plain text with phone numbers and e-mail addresses picked out in order.
// Null when the string has neither, so a normal line stays one copy target.
export function textParts(value) {
  const text = String(value ?? "");
  const marks = [];
  for (const match of text.matchAll(EMAIL_RE)) {
    const email = emailAddress(match[0]);
    if (!email) continue;
    marks.push({ start: match.index, end: match.index + match[0].length, type: "email", text: match[0], email });
  }
  for (const match of text.matchAll(PHONE_RE)) {
    const span = trimPhoneMatch(text, match.index, match[0]);
    const dial = phoneDial(span.text);
    if (!dial) continue;
    if (marks.some((mark) => span.start < mark.end && span.end > mark.start)) continue;
    marks.push({ start: span.start, end: span.end, type: "phone", text: span.text, dial });
  }
  marks.sort((a, b) => a.start - b.start || a.end - b.end);
  if (!marks.length) return null;
  const parts = [];
  let at = 0;
  for (const mark of marks) {
    if (mark.start < at) continue;
    if (mark.start > at) parts.push({ type: "text", text: text.slice(at, mark.start) });
    const part = { type: mark.type, text: mark.text };
    if (mark.type === "phone") part.dial = mark.dial;
    else part.email = mark.email;
    parts.push(part);
    at = mark.end;
  }
  if (at < text.length) parts.push({ type: "text", text: text.slice(at) });
  return parts;
}

function entryFrom(label, value) {
  const text = value.trim();
  const dial = phoneDial(text);
  if (dial) return { label, kind: "phone", text, dial, parts: null };
  const email = emailAddress(text);
  if (email) return { label, kind: "email", text, email, parts: null };
  return { label, kind: "text", text, parts: textParts(text) };
}

// One entry per labelled line (wifi name, password, code, address, phone, e-mail).
// Neighbouring unlabelled lines stay one free-text value.
export function handbookEntries(body) {
  const lines = String(body ?? "").replace(/\r\n?/g, "\n").split("\n");
  const entries = [];
  let prose = [];
  const flush = () => {
    const text = prose.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    prose = [];
    if (text) entries.push(entryFrom(null, text));
  };
  for (const line of lines) {
    if (!line.trim()) {
      if (prose.length) prose.push("");
      continue;
    }
    const labeled = splitLabel(line);
    if (!labeled) {
      prose.push(line.trim());
      continue;
    }
    flush();
    entries.push(entryFrom(labeled.label, labeled.value));
  }
  flush();
  return entries;
}

// navigator.clipboard.writeText when it exists. Otherwise a hidden textarea
// and execCommand, for browsers without the async clipboard.
export async function copyText(text, env = globalThis) {
  const value = String(text ?? "");
  const write = env.navigator?.clipboard?.writeText;
  if (typeof write === "function") {
    try {
      await write.call(env.navigator.clipboard, value);
      return true;
    } catch { /* try the fallback */ }
  }
  const doc = env.document;
  if (!doc?.body || typeof doc.execCommand !== "function" || typeof doc.createElement !== "function") return false;
  const area = doc.createElement("textarea");
  area.value = value;
  if (typeof area.setAttribute === "function") area.setAttribute("readonly", "");
  area.className = "pt-clipboard-fallback";
  if (typeof area.setAttribute === "function") area.setAttribute("aria-hidden", "true");
  const active = doc.activeElement;
  if (typeof doc.body.append === "function") doc.body.append(area);
  else doc.body.appendChild(area);
  if (typeof area.select === "function") area.select();
  let ok = false;
  try { ok = Boolean(doc.execCommand("copy")); } catch { ok = false; }
  if (typeof area.remove === "function") area.remove();
  else area.parentNode?.removeChild(area);
  try {
    if (active && active !== area && typeof active.focus === "function") active.focus();
  } catch { /* the button can live without focus restored */ }
  return ok;
}
