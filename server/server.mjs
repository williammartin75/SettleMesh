import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticateApiKey, parseApiKeyConfiguration } from "./auth.mjs";
import { createFileRegistry, writeRegistryFile } from "./registry.mjs";
import { createSupabaseRegistry } from "./registry-supabase.mjs";
import { createSupabaseMembers, verifyPassword } from "./members.mjs";
import { handleAdminRequest } from "./admin.mjs";
import { validateApiInvoice } from "./validation.mjs";
import { IdentityInputError, verifyPeppol, verifyVies } from "../worker/identity.mjs";

export const API_VERSION = "v1";
export const MAX_API_BODY_BYTES = 2 * 1024 * 1024;

const defaultRoot = fileURLToPath(new URL("../web/", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".pdf": "application/pdf"
};

const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

const jsonResponse = (response, status, body, extraHeaders = {}) => {
  response.writeHead(status, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders });
  response.end(JSON.stringify(body));
};

const apiError = (requestId, code, message, status = 400) => ({
  status,
  body: { schema: "settlemesh-api-error", apiVersion: API_VERSION, requestId, error: { code, message } }
});

async function readJson(request) {
  const declared = Number(request.headers["content-length"] || 0);
  if (declared > MAX_API_BODY_BYTES) throw Object.assign(new Error("La requête dépasse la limite de 2 Mo."), { statusCode: 413, code: "BODY_TOO_LARGE" });
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_API_BODY_BYTES) throw Object.assign(new Error("La requête dépasse la limite de 2 Mo."), { statusCode: 413, code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Le corps doit être un objet JSON valide."), { statusCode: 400, code: "INVALID_JSON" });
  }
}

const createRateLimiter = (windowMs) => {
  const clients = new Map();
  return (key, limit) => {
    const now = Date.now();
    if (clients.size > 10_000) {
      for (const [clientKey, entry] of clients) {
        if (entry.resetAt <= now) clients.delete(clientKey);
      }
    }
    const current = clients.get(key);
    if (!current || current.resetAt <= now) {
      clients.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
    }
    current.count += 1;
    return { allowed: current.count <= limit, remaining: Math.max(0, limit - current.count), resetAt: current.resetAt };
  };
};

const rateHeaders = (rate, limit, scope) => ({
  "X-RateLimit-Limit": String(limit),
  "X-RateLimit-Remaining": String(rate.remaining),
  "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  "X-RateLimit-Scope": scope
});

export function createSettleMeshServer({
  root = defaultRoot,
  logger = console,
  rateLimit = 120,
  apiKeys = parseApiKeyConfiguration(),
  registryFile = process.env.SETTLEMESH_REGISTRY_FILE || "",
  membersStoreOption = null,
  cookieSecure = String(process.env.SETTLEMESH_COOKIE_SECURE || "") === "1",
  identityFetch = fetch
} = {}) {
  const normalizedRoot = resolve(root);
  const credentials = parseApiKeyConfiguration(JSON.stringify(apiKeys));
  const registry = registryFile ? createFileRegistry(registryFile) : null;
  const supabaseRegistry = !registry && process.env.SETTLEMESH_SUPABASE_SERVICE_KEY && process.env.SETTLEMESH_SUPABASE_PROJECT_REF
    ? createSupabaseRegistry({ projectRef: process.env.SETTLEMESH_SUPABASE_PROJECT_REF, serviceKey: process.env.SETTLEMESH_SUPABASE_SERVICE_KEY })
    : null;
  const membersStore = membersStoreOption || (supabaseRegistry
    ? createSupabaseMembers({
      projectRef: process.env.SETTLEMESH_SUPABASE_PROJECT_REF,
      serviceKey: process.env.SETTLEMESH_SUPABASE_SERVICE_KEY
    })
    : null);
  const credentialsSource = async () => {
    if (registry) return registry.credentials();
    if (supabaseRegistry) return supabaseRegistry.credentials();
    return credentials;
  };
  const consumeIpRate = createRateLimiter(60_000);
  const consumeOrganizationRate = createRateLimiter(60_000);
  const consumePeppolRate = createRateLimiter(1_000);
  const readOptionalJson = async (request) => {
    if (!Number(request.headers["content-length"] || 0)) return {};
    return readJson(request);
  };

  const registryAdminUnavailable = () => Object.assign(new Error("L'administration des clés exige un registre persistant (SETTLEMESH_REGISTRY_FILE ou SETTLEMESH_SUPABASE_*)."), { statusCode: 409, code: "ADMIN_REQUIRES_REGISTRY" });

  const writeRegistryEntries = async (entries) => {
    if (registry) {
      writeRegistryFile(registryFile, entries);
      return;
    }
    if (supabaseRegistry) {
      await supabaseRegistry.write(entries);
      return;
    }
    throw registryAdminUnavailable();
  };

  return createServer(async (request, response) => {
    const requestId = randomUUID();
    const url = new URL(request.url || "/", "http://localhost");

    if (url.pathname.startsWith("/api/")) {
      const ipRate = consumeIpRate(request.socket.remoteAddress || "unknown", rateLimit);
      const ipRateHeaders = rateHeaders(ipRate, rateLimit, "ip");
      if (!ipRate.allowed) {
        const error = apiError(requestId, "RATE_LIMITED", "Trop de requêtes. Réessayez dans une minute.", 429);
        return jsonResponse(response, error.status, error.body, ipRateHeaders);
      }

      if (url.pathname === "/api/v1/health" && request.method === "GET") {
        return jsonResponse(response, 200, {
          schema: "settlemesh-api-health", apiVersion: API_VERSION, status: "ok",
          validators: { en16931: "1.3.16", peppol: "3.0.21" },
          authentication: { validate: "bearer-api-key", identity: "same-origin", configured: (await credentialsSource()).length > 0, registry: Boolean(registry), supabase: Boolean(supabaseRegistry), members: Boolean(membersStore) },
          identitySources: { vies: "live", peppolDirectory: "live", persistence: false },
          limits: { requestBytes: MAX_API_BODY_BYTES, xmlBytes: 1024 * 1024, ipRequestsPerMinute: rateLimit },
          persistence: false
        }, ipRateHeaders);
      }

      if (["/api/v1/identity/vies", "/api/v1/identity/peppol"].includes(url.pathname)) {
        if (request.method !== "POST") {
          const error = apiError(requestId, "METHOD_NOT_ALLOWED", "Utilisez POST pour vérifier un identifiant.", 405);
          return jsonResponse(response, error.status, error.body, { ...ipRateHeaders, Allow: "POST" });
        }
        if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
          const error = apiError(requestId, "UNSUPPORTED_MEDIA_TYPE", "Utilisez Content-Type: application/json.", 415);
          return jsonResponse(response, error.status, error.body, ipRateHeaders);
        }
        if (url.pathname.endsWith("/peppol")) {
          const upstreamRate = consumePeppolRate("peppol-directory", 2);
          if (!upstreamRate.allowed) {
            const error = apiError(requestId, "UPSTREAM_RATE_LIMITED", "Peppol Directory autorise deux recherches par seconde. Réessayez dans un instant.", 429);
            return jsonResponse(response, error.status, error.body, rateHeaders(upstreamRate, 2, "peppol-directory"));
          }
        }
        try {
          const payload = await readJson(request);
          const result = url.pathname.endsWith("/vies")
            ? await verifyVies(payload, { fetchImpl: identityFetch })
            : await verifyPeppol(payload?.participantId, { fetchImpl: identityFetch });
          return jsonResponse(response, 200, { ...result, requestId }, ipRateHeaders);
        } catch (error) {
          const status = error instanceof IdentityInputError ? 400 : (error.statusCode || 500);
          const failure = apiError(requestId, error.code || "IDENTITY_CHECK_FAILED", status >= 500 ? "La vérification a échoué." : error.message, status);
          return jsonResponse(response, failure.status, failure.body, ipRateHeaders);
        }
      }

      if (url.pathname.startsWith("/api/v1/auth/")) {
        if (!membersStore) {
          const failure = apiError(requestId, "MEMBERS_UNAVAILABLE", "Les sessions humaines exigent le stockage managé (SETTLEMESH_SUPABASE_*).", 409);
          return jsonResponse(response, 409, failure.body, ipRateHeaders);
        }
        const sessionCookie = (request.headers.cookie || "").match(/(?:^|;\s*)settlemesh_session=([0-9a-f-]{36})/i)?.[1] || "";
        const cookieOptions = `Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${cookieSecure ? "; Secure" : ""}`;

        if (url.pathname === "/api/v1/auth/login" && request.method === "POST") {
          try {
            const payload = await readJson(request);
            const member = await membersStore.findMemberByEmail(payload?.email);
            const passwordOk = member && verifyPassword(payload?.password || "", member.password_hash);
            if (!passwordOk) {
              const failure = apiError(requestId, "INVALID_CREDENTIALS", "Identifiants invalides.", 401);
              return jsonResponse(response, 401, failure.body, ipRateHeaders);
            }
            const session = await membersStore.createSession({ memberId: member.id, organizationId: member.organization_id, role: member.role });
            return jsonResponse(response, 200, {
              schema: "settlemesh-session", apiVersion: API_VERSION, requestId,
              organizationId: session.organizationId,
              member: { email: member.email, role: member.role },
              expiresAt: session.expiresAt
            }, { ...ipRateHeaders, "Set-Cookie": `settlemesh_session=${session.sessionId}; ${cookieOptions}` });
          } catch (error) {
            if (error?.code === "MEMBERS_UNAVAILABLE") {
              const failure = apiError(requestId, error.code, error.message, 503);
              return jsonResponse(response, 503, failure.body, ipRateHeaders);
            }
            const failure = apiError(requestId, error.code || "INVALID_CREDENTIALS", error.statusCode && error.statusCode < 500 ? error.message : "Identifiants non analysables.", 400);
            return jsonResponse(response, 400, failure.body, ipRateHeaders);
          }
        }

        if (!sessionCookie) {
          const failure = apiError(requestId, "AUTH_REQUIRED", "Aucune session SettleMesh (cookie) pour cette requête.", 401);
          return jsonResponse(response, 401, failure.body, ipRateHeaders);
        }

        if (url.pathname === "/api/v1/auth/logout" && request.method === "POST") {
          await membersStore.deleteSession(sessionCookie);
          const cookieClearOptions = `Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecure ? "; Secure" : ""}`;
          return jsonResponse(response, 200, { schema: "settlemesh-session", apiVersion: API_VERSION, requestId, terminated: true },
            { ...ipRateHeaders, "Set-Cookie": `settlemesh_session=; ${cookieClearOptions}` });
        }

        if (url.pathname === "/api/v1/auth/me" && request.method === "GET") {
          try {
            const session = await membersStore.findSession(sessionCookie);
            if (!session) {
              const failure = apiError(requestId, "SESSION_EXPIRED", "Session inconnue ou expirée.", 401);
              return jsonResponse(response, 401, failure.body, ipRateHeaders);
            }
            return jsonResponse(response, 200, {
              schema: "settlemesh-session", apiVersion: API_VERSION, requestId,
              organizationId: session.organization_id,
              member: { role: session.role },
              expiresAt: session.expires_at
            }, ipRateHeaders);
          } catch (error) {
            const failure = apiError(requestId, error?.code || "MEMBERS_UNAVAILABLE", error?.message || "Le stockage des membres est momentanément indisponible.", 503);
            return jsonResponse(response, 503, failure.body, ipRateHeaders);
          }
        }

        const errorNoRoute = apiError(requestId, "METHOD_NOT_ALLOWED", "Utilisez POST /auth/login, POST /auth/logout ou GET /auth/me.", 405);
        return jsonResponse(response, 405, errorNoRoute.body, { ...ipRateHeaders, Allow: "POST, GET" });
      }

      if (url.pathname.startsWith("/api/v1/admin/") || url.pathname === "/api/v1/admin") {
        if (!registry && !supabaseRegistry) {
          const failure = apiError(requestId, "ADMIN_REQUIRES_REGISTRY", registryAdminUnavailable().message, 409);
          return jsonResponse(response, 409, failure.body, ipRateHeaders);
        }
        let authentication;
        try {
          authentication = await authenticateApiKey(request.headers.authorization, await credentialsSource());
        } catch (registryError) {
          const failure = apiError(requestId, registryError?.code || "SUPABASE_REGISTRY_UNAVAILABLE", registryError?.code === "SUPABASE_REGISTRY_UNAVAILABLE" ? "Le registre d'organisations est momentanément indisponible. Réessayez." : (registryError?.message || "Registre d'organisations indisponible."), registryError?.status || 503);
          return jsonResponse(response, failure.status, failure.body, ipRateHeaders);
        }
        if (!authentication.ok) {
          const error = apiError(requestId, authentication.code, authentication.message, authentication.statusCode);
          const challenge = authentication.statusCode === 401 ? { "WWW-Authenticate": 'Bearer realm="SettleMesh API"' } : {};
          return jsonResponse(response, error.status, error.body, { ...ipRateHeaders, ...challenge });
        }
        const credential = authentication.credential;
        const organizationRate = consumeOrganizationRate(credential.organizationId, credential.requestsPerMinute);
        if (!organizationRate.allowed) {
          const error = apiError(requestId, "RATE_LIMITED", "Quota de l'organisation atteint. Réessayez dans une minute.", 429);
          return jsonResponse(response, 429, error.body, rateHeaders(organizationRate, credential.requestsPerMinute, "organization"));
        }

        const body = await readOptionalJson(request);
        const segments = url.pathname.replace(/^\/api\/v1\/admin\/?/, "").split("/").filter(Boolean);
        let outcome;
        try {
          outcome = await handleAdminRequest({
            method: request.method,
            segments,
            body,
            credential,
            loadEntries: credentialsSource,
            writeEntries: writeRegistryEntries,
            requestId
          });
        } catch (error) {
          if (error?.code === "SUPABASE_REGISTRY_UNAVAILABLE" || error?.code === "ADMIN_REQUIRES_REGISTRY" || error?.code === "INVALID_API_KEY_CONFIGURATION") {
            const failure = apiError(requestId, error.code, error.message, error.status || 503);
            return jsonResponse(response, failure.status, failure.body, ipRateHeaders);
          }
          throw error;
        }
        if (outcome.failure) {
          const failure = apiError(requestId, outcome.failure.code, outcome.failure.message, outcome.failure.status);
          return jsonResponse(response, failure.status, failure.body, { ...ipRateHeaders, ...rateHeaders(organizationRate, credential.requestsPerMinute, "organization") });
        }
        return jsonResponse(response, outcome.status, outcome.body, { ...ipRateHeaders, ...rateHeaders(organizationRate, credential.requestsPerMinute, "organization") });
      }

      if (url.pathname === "/api/v1/validate") {
        if (request.method !== "POST") {
          const error = apiError(requestId, "METHOD_NOT_ALLOWED", "Utilisez POST pour valider une facture.", 405);
          return jsonResponse(response, error.status, error.body, { ...ipRateHeaders, Allow: "POST" });
        }
        if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
          const error = apiError(requestId, "UNSUPPORTED_MEDIA_TYPE", "Utilisez Content-Type: application/json.", 415);
          return jsonResponse(response, error.status, error.body, ipRateHeaders);
        }

        let authentication;
        try {
          authentication = await authenticateApiKey(request.headers.authorization, await credentialsSource());
        } catch (registryError) {
          const unavailable = registryError?.code === "SUPABASE_REGISTRY_UNAVAILABLE" || /Indisponible|fichier de registre|registre Supabase/i.test(registryError?.message || "");
          if (!unavailable) throw registryError;
          const failure = apiError(requestId, "SUPABASE_REGISTRY_UNAVAILABLE", "Le registre d'organisations est momentanément indisponible. Réessayez.", 503);
          return jsonResponse(response, 503, failure.body, ipRateHeaders);
        }
        if (!authentication.ok) {
          const error = apiError(requestId, authentication.code, authentication.message, authentication.statusCode);
          const challenge = authentication.statusCode === 401 ? { "WWW-Authenticate": 'Bearer realm="SettleMesh API"' } : {};
          return jsonResponse(response, error.status, error.body, { ...ipRateHeaders, ...challenge });
        }

        const { organizationId, requestsPerMinute } = authentication.credential;
        const organizationRate = consumeOrganizationRate(organizationId, requestsPerMinute);
        const organizationRateHeaders = rateHeaders(organizationRate, requestsPerMinute, "organization");
        if (!organizationRate.allowed) {
          const error = apiError(requestId, "RATE_LIMITED", "Quota de l’organisation atteint. Réessayez dans une minute.", 429);
          return jsonResponse(response, error.status, error.body, organizationRateHeaders);
        }
        try {
          const payload = await readJson(request);
          const result = await validateApiInvoice(payload);
          return jsonResponse(response, 200, {
            schema: "settlemesh-validation-response", apiVersion: API_VERSION, requestId,
            processedAt: new Date().toISOString(), organizationId, organizationRole: authentication.credential.role, stored: false, result
          }, { ...organizationRateHeaders, Vary: "Authorization" });
        } catch (error) {
          const status = error.statusCode || 500;
          const message = status >= 500 ? "La validation a échoué de manière inattendue." : error.message;
          const failure = apiError(requestId, error.code || "VALIDATION_FAILED", message, status);
          if (status >= 500) logger?.error?.(`[${requestId}] validation failed without invoice content`, {
            name: error.name || "Error",
            code: error.code || "VALIDATION_FAILED"
          });
          return jsonResponse(response, failure.status, failure.body, organizationRateHeaders);
        }
      }

      const error = apiError(requestId, "NOT_FOUND", "Route API inconnue.", 404);
      return jsonResponse(response, error.status, error.body, ipRateHeaders);
    }

    if (!['GET', 'HEAD'].includes(request.method || '')) {
      response.writeHead(405, { ...securityHeaders, Allow: "GET, HEAD" });
      return response.end();
    }
    try {
      const requestPath = decodeURIComponent(url.pathname);
      let filePath = resolve(normalizedRoot, `.${requestPath === "/" ? "/index.html" : requestPath}`);
      const relativePath = relative(normalizedRoot, filePath);
      if (relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error("forbidden");
      if ((await stat(filePath)).isDirectory()) filePath = join(filePath, "index.html");
      const content = await readFile(filePath);
      response.writeHead(200, { ...securityHeaders, "Content-Type": types[extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch {
      response.writeHead(404, { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
}

export function listen(server, { port = Number(process.env.PORT || 4173), host = "127.0.0.1" } = {}) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}
