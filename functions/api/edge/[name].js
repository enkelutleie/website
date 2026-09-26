// Same-origin door to Production edge functions. The browser cannot call them
// directly because those responses omit Access-Control-Allow-Origin. This
// forwards only the caller's own token. It never adds a service key.

const ALLOWED = new Set([
  "document-lifecycle",
  "privacy-export-delivery",
  "contract-pdf",
  "send-tenancy-invitation",
]);

const SUPABASE_URL = "https://jfrorhixjsuomwtjwqla.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_26XRJpYFKZBVlotEX-qiMQ_FBGuZCnB";
const MAX_BODY = 1_500_000;

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

export async function onRequestPost({ request, params }) {
  const name = params.name;
  if (!ALLOWED.has(name)) return json({ outcome: "not_found" }, 404);

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length > 8000) {
    return json({ outcome: "not_authenticated" }, 401);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY) return json({ outcome: "invalid_request" }, 413);

  const upstream = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      apikey: PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    body,
  });

  const bytes = await upstream.arrayBuffer();
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json; charset=utf-8");
  const disposition = upstream.headers.get("Content-Disposition");
  if (disposition) headers.set("Content-Disposition", disposition);
  return new Response(bytes, { status: upstream.status, headers });
}
