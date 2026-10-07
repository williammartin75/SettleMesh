import { IdentityInputError, verifyPeppol, verifyVies } from "./identity.mjs";

const MAX_BODY_BYTES = 4 * 1024;
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

const rateState = new Map();

function consumeRate(key, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  if (rateState.size > 10_000) {
    for (const [entryKey, entry] of rateState) if (entry.resetAt <= now) rateState.delete(entryKey);
  }
  const current = rateState.get(key);
  if (!current || current.resetAt <= now) {
    rateState.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

async function readSmallJson(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw Object.assign(new Error("La requête dépasse 4 Ko."), { statusCode: 413, code: "BODY_TOO_LARGE" });
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw Object.assign(new Error("La requête dépasse 4 Ko."), { statusCode: 413, code: "BODY_TOO_LARGE" });
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error("Le corps doit être un objet JSON valide."), { statusCode: 400, code: "INVALID_JSON" }); }
}

async function identityRoute(request, source) {
  const requestId = crypto.randomUUID();
  if (request.method !== "POST") return json(405, { schema: "settlemesh-api-error", requestId, error: { code: "METHOD_NOT_ALLOWED", message: "Utilisez POST." } });
  if (!String(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return json(415, { schema: "settlemesh-api-error", requestId, error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Utilisez Content-Type: application/json." } });
  }
  try {
    const payload = await readSmallJson(request);
    const result = source === "vies" ? await verifyVies(payload) : await verifyPeppol(payload?.participantId);
    return json(200, { ...result, requestId });
  } catch (error) {
    const status = error instanceof IdentityInputError ? 400 : (error.statusCode || 500);
    return json(status, {
      schema: "settlemesh-api-error",
      requestId,
      error: { code: error.code || "IDENTITY_CHECK_FAILED", message: status >= 500 ? "La vérification a échoué." : error.message }
    });
  }
}

async function serveAsset(request, env) {
  if (!env?.ASSETS?.fetch) return new Response("Site assets unavailable", { status: 503, headers: SECURITY_HEADERS });
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/v1/identity/vies" || url.pathname === "/api/v1/identity/peppol") {
      const client = request.headers.get("cf-connecting-ip") || "unknown";
      if (!consumeRate(`${client}:${url.pathname}`)) {
        return json(429, { schema: "settlemesh-api-error", error: { code: "RATE_LIMITED", message: "Trop de vérifications. Réessayez dans une minute." } });
      }
      if (url.pathname.endsWith("/peppol") && !consumeRate("peppol-directory:global", 2, 1_000)) {
        return json(429, { schema: "settlemesh-api-error", error: { code: "UPSTREAM_RATE_LIMITED", message: "Peppol Directory autorise deux recherches par seconde. Réessayez dans un instant." } });
      }
      return identityRoute(request, url.pathname.endsWith("/vies") ? "vies" : "peppol");
    }
    return serveAsset(request, env);
  }
};
