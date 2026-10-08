import { IdentityInputError, verifyPeppol, verifyVies } from "./identity.mjs";
import { createSupabaseRequirements, sanitizeRequirementProfile, verifyAgainstPublished } from "./requirements.mjs";
import { createSupabaseMetrics, validateMetricEvent, METRICS_SCHEMA } from "./metrics.mjs";

const API_VERSION = "v1";

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

async function readSmallJson(request, maxBytes = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw Object.assign(new Error(`La requête dépasse ${Math.round(maxBytes / 1024)} Ko.`), { statusCode: 413, code: "BODY_TOO_LARGE" });
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw Object.assign(new Error(`La requête dépasse ${Math.round(maxBytes / 1024)} Ko.`), { statusCode: 413, code: "BODY_TOO_LARGE" });
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

// Routes publiques du registre d'exigences et de la mesure consentie (0.23.0).
// Parité exacte avec le serveur Node : mêmes listes blanches, mêmes verdicts,
// mêmes formes de réponse. Le Worker reste sans stockage : les secrets
// SETTLEMESH_SUPABASE_* sont requis, toute indisponibilité reste 503 explicite,
// jamais maquillée en succès ni en absence.

const supabaseEnv = (env) => ({
  projectRef: env?.SETTLEMESH_SUPABASE_PROJECT_REF,
  serviceKey: env?.SETTLEMESH_SUPABASE_SERVICE_KEY
});

const storeUnavailable = (requestId, code, message) => json(503, {
  schema: "settlemesh-api-error", requestId, error: { code, message }
});

const routeError = (requestId, error, fallbackCode, fallbackMessage) => json(error?.statusCode || error?.status || 400, {
  schema: "settlemesh-api-error", requestId,
  error: { code: error?.code || fallbackCode, message: error?.message || fallbackMessage }
});

export async function requirementsSearchRoute(url, env, { requestId = crypto.randomUUID(), fetchImpl = globalThis.fetch } = {}) {
  const { projectRef, serviceKey } = supabaseEnv(env);
  if (!projectRef || !serviceKey) {
    return storeUnavailable(requestId, "REQUIREMENTS_UNAVAILABLE", "Le registre d'exigences n'est pas configuré sur cette instance (secrets SETTLEMESH_SUPABASE_* du Worker requis).");
  }
  const store = createSupabaseRequirements({ projectRef, serviceKey, fetchImpl });
  const query = url.searchParams.get("q") || "";
  try {
    const results = await store.search(query);
    return json(200, { schema: "settlemesh-requirements", apiVersion: API_VERSION, requestId, query, count: results.length, results, stored: false });
  } catch (error) {
    if (error?.code === "REQUIREMENTS_UNAVAILABLE") return storeUnavailable(requestId, error.code, "Le registre d'exigences est momentanément indisponible. Réessayez.");
    return routeError(requestId, error, "INVALID_REQUIREMENTS_QUERY", "Requête de recherche illisible.");
  }
}

export async function requirementsVerifyRoute(request, env, { requestId = crypto.randomUUID(), fetchImpl = globalThis.fetch } = {}) {
  if (request.method !== "POST") return json(405, { schema: "settlemesh-api-error", requestId, error: { code: "METHOD_NOT_ALLOWED", message: "Utilisez POST pour vérifier un CheckLink." } });
  if (!String(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return json(415, { schema: "settlemesh-api-error", requestId, error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Utilisez Content-Type: application/json." } });
  }
  const { projectRef, serviceKey } = supabaseEnv(env);
  if (!projectRef || !serviceKey) {
    return storeUnavailable(requestId, "REQUIREMENTS_UNAVAILABLE", "Le registre d'exigences n'est pas configuré sur cette instance (secrets SETTLEMESH_SUPABASE_* du Worker requis).");
  }
  const store = createSupabaseRequirements({ projectRef, serviceKey, fetchImpl });
  try {
    const payload = await readSmallJson(request, 32 * 1024);
    const clean = sanitizeRequirementProfile(payload?.profile || payload);
    const row = await store.findByIdentifier({ vatId: clean.vatId, peppolId: clean.peppolId, companyName: clean.companyName || clean.legalName });
    const verdict = verifyAgainstPublished(clean, row);
    return json(200, {
      schema: "settlemesh-requirements-verify", apiVersion: API_VERSION, requestId, stored: false,
      verdict: verdict.verdict, reason: verdict.reason, ...(verdict.mismatches ? { mismatches: verdict.mismatches } : {})
    });
  } catch (error) {
    if (error?.code === "REQUIREMENTS_UNAVAILABLE") return storeUnavailable(requestId, error.code, "Le registre d'exigences est momentanément indisponible. Réessayez.");
    return routeError(requestId, error, "INVALID_REQUIREMENTS_PAYLOAD", "Profil du CheckLink illisible.");
  }
}

export async function metricsEventRoute(request, env, { requestId = crypto.randomUUID(), fetchImpl = globalThis.fetch } = {}) {
  if (request.method !== "POST") return json(405, { schema: "settlemesh-api-error", requestId, error: { code: "METHOD_NOT_ALLOWED", message: "Utilisez POST pour signaler un événement de mesure." } });
  if (!String(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return json(415, { schema: "settlemesh-api-error", requestId, error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Utilisez Content-Type: application/json." } });
  }
  const { projectRef, serviceKey } = supabaseEnv(env);
  if (!projectRef || !serviceKey) {
    return storeUnavailable(requestId, "METRICS_UNAVAILABLE", "La mesure consentie n'est pas configurée sur cette instance (secrets SETTLEMESH_SUPABASE_* du Worker requis).");
  }
  const store = createSupabaseMetrics({ projectRef, serviceKey, fetchImpl });
  try {
    const payload = await readSmallJson(request, MAX_BODY_BYTES);
    const event = validateMetricEvent(payload);
    await store.insert(event);
    return json(202, { schema: METRICS_SCHEMA, apiVersion: API_VERSION, requestId, accepted: true, event });
  } catch (error) {
    if (error?.code === "METRICS_UNAVAILABLE") return storeUnavailable(requestId, error.code, "La mesure consentie est momentanément indisponible. Réessayez.");
    return routeError(requestId, error, "INVALID_METRICS_PAYLOAD", "Événement de mesure illisible.");
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
    if (url.pathname === "/api/v1/requirements" && request.method === "GET") {
      const client = request.headers.get("cf-connecting-ip") || "unknown";
      if (!consumeRate(`${client}:requirements-search`, 30, 60_000)) {
        return json(429, { schema: "settlemesh-api-error", error: { code: "RATE_LIMITED", message: "Trop de recherches d'exigences. Réessayez dans une minute." } });
      }
      return requirementsSearchRoute(url, env);
    }
    if (url.pathname === "/api/v1/requirements/verify" && request.method === "POST") {
      const client = request.headers.get("cf-connecting-ip") || "unknown";
      if (!consumeRate(`${client}:requirements-verify`, 20, 60_000)) {
        return json(429, { schema: "settlemesh-api-error", error: { code: "RATE_LIMITED", message: "Trop de vérifications. Réessayez dans une minute." } });
      }
      return requirementsVerifyRoute(request, env);
    }
    if (url.pathname === "/api/v1/metrics/events" && request.method === "POST") {
      const client = request.headers.get("cf-connecting-ip") || "unknown";
      if (!consumeRate(`${client}:metrics-events`, 30, 60_000)) {
        return json(429, { schema: "settlemesh-api-error", error: { code: "RATE_LIMITED", message: "Trop d'événements de mesure. Réessayez dans une minute." } });
      }
      return metricsEventRoute(request, env);
    }
    if (url.pathname === "/api/v1/requirements" && request.method !== "GET") {
      return json(405, { schema: "settlemesh-api-error", error: { code: "METHOD_NOT_ALLOWED", message: "Le Worker publié n'expose que la lecture publique ; les mutations authentifiées (publication, gestion) restent sur le serveur." } });
    }
    return serveAsset(request, env);
  }
};
