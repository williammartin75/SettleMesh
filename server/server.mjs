import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticateApiKey, parseApiKeyConfiguration } from "./auth.mjs";
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
  identityFetch = fetch
} = {}) {
  const normalizedRoot = resolve(root);
  const credentials = parseApiKeyConfiguration(JSON.stringify(apiKeys));
  const consumeIpRate = createRateLimiter(60_000);
  const consumeOrganizationRate = createRateLimiter(60_000);
  const consumePeppolRate = createRateLimiter(1_000);
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
          authentication: { validate: "bearer-api-key", identity: "same-origin", configured: credentials.length > 0 },
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

      if (url.pathname === "/api/v1/validate") {
        if (request.method !== "POST") {
          const error = apiError(requestId, "METHOD_NOT_ALLOWED", "Utilisez POST pour valider une facture.", 405);
          return jsonResponse(response, error.status, error.body, { ...ipRateHeaders, Allow: "POST" });
        }
        if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
          const error = apiError(requestId, "UNSUPPORTED_MEDIA_TYPE", "Utilisez Content-Type: application/json.", 415);
          return jsonResponse(response, error.status, error.body, ipRateHeaders);
        }

        const authentication = authenticateApiKey(request.headers.authorization, credentials);
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
            processedAt: new Date().toISOString(), organizationId, stored: false, result
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
