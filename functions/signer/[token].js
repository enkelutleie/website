// enkelutleie.com/signer/<token>: serve the static signing page without changing
// the URL (a _redirects rewrite to an .html file turns into a 308 and drops the token).
// _headers do not apply to Function responses, so the page headers are set here.
// The token is never logged or sent anywhere by this function; the page reads it from location.

const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self' https://jfrorhixjsuomwtjwqla.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

export const SIGNER_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": CSP,
};

export async function onRequestGet({ request, env }) {
  const page = await env.ASSETS.fetch(new URL("/signer/", request.url));
  if (!page.ok) return new Response("Siden er midlertidig utilgjengelig.", { status: 503, headers: { ...SIGNER_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(page.body, { status: 200, headers: SIGNER_HEADERS });
}

export const onRequestHead = async (context) => {
  const response = await onRequestGet(context);
  return new Response(null, { status: response.status, headers: response.headers });
};
