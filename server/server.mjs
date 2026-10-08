import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticateApiKey, parseApiKeyConfiguration } from "./auth.mjs";
import { createFileRegistry, writeRegistryFile } from "./registry.mjs";
import { createSupabaseRegistry } from "./registry-supabase.mjs";
import { createSupabaseMembers, verifyPassword, hashPassword } from "./members.mjs";
import { createSupabaseRequirements, sanitizeRequirementProfile, verifyAgainstPublished } from "./requirements.mjs";
import { verifyTotp, generateTotpSecret } from "./totp.mjs";
import { handleAdminRequest } from "./admin.mjs";
import { createFailureTracker } from "./failures.mjs";
import { createSupabaseMetrics, aggregateMetricRows, metricsCsv, validateMetricEvent, validateMetricRange, METRICS_SCHEMA } from "./metrics.mjs";
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

const requireValidSession = async (store, cookie) => {
  if (!cookie) throw Object.assign(new Error("Aucune session SettleMesh (cookie) pour cette requête."), { code: "AUTH_REQUIRED", status: 401 });
  const session = await store.findSession(cookie);
  if (!session) throw Object.assign(new Error("Session inconnue ou expirée."), { code: "SESSION_EXPIRED", status: 401 });
  return session;
};

const membersErrorResponse = (response, requestId, headers, error) => {
  if (error?.code === "MEMBERS_UNAVAILABLE") {
    const failure = apiError(requestId, error.code, error.message, 503);
    return jsonResponse(response, 503, failure.body, headers);
  }
  const status = error?.status || 401;
  const failure = apiError(requestId, error?.code || "INVALID_CREDENTIALS", error?.message || "Erreur de session.", status);
  return jsonResponse(response, status, failure.body, headers);
};

export function createSettleMeshServer({
  root = defaultRoot,
  logger = console,
  rateLimit = 120,
  apiKeys = parseApiKeyConfiguration(),
  registryFile = process.env.SETTLEMESH_REGISTRY_FILE || "",
  membersStoreOption = null,
  requirementsStoreOption = null,
  metricsStoreOption = null,
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
  const loginFailures = createFailureTracker({ limit: 5, windowMs: 600_000 });
  const requirementsStore = requirementsStoreOption || (supabaseRegistry
    ? createSupabaseRequirements({
      projectRef: process.env.SETTLEMESH_SUPABASE_PROJECT_REF,
      serviceKey: process.env.SETTLEMESH_SUPABASE_SERVICE_KEY
    })
    : null);
  const metricsStore = metricsStoreOption || (supabaseRegistry
    ? createSupabaseMetrics({
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

  const sessionCookieOf = (request) => (request.headers.cookie || "").match(/(?:^|;\s*)settlemesh_session=([0-9a-f-]{36})/i)?.[1] || "";

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
        const sessionCookie = sessionCookieOf(request);
        const cookieOptions = `Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${cookieSecure ? "; Secure" : ""}`;

        if (url.pathname === "/api/v1/auth/login" && request.method === "POST") {
          try {
            const payload = await readJson(request);
            const attemptKey = `${request.socket.remoteAddress || "inconnu"}|${String(payload?.email || "").trim().toLowerCase()}`;
            if (loginFailures.blocked(attemptKey)) {
              const seconds = loginFailures.secondsLeft(attemptKey);
              const failure = apiError(requestId, "LOGIN_LOCKED", `Trop de tentatives infructueuses. Réessayez dans ${seconds} secondes.`, 429);
              return jsonResponse(response, 429, failure.body, ipRateHeaders);
            }
            const member = await membersStore.findMemberByEmail(payload?.email);
            const passwordOk = member && verifyPassword(payload?.password || "", member.password_hash);
            if (!passwordOk) {
              const attempt = loginFailures.attempt(attemptKey);
              if (attempt.blocked) {
                const failure = apiError(requestId, "LOGIN_LOCKED", `Trop de tentatives infructueuses. Réessayez dans ${loginFailures.secondsLeft(attemptKey)} secondes.`, 429);
                return jsonResponse(response, 429, failure.body, ipRateHeaders);
              }
              const failure = apiError(requestId, "INVALID_CREDENTIALS", "Identifiants invalides.", 401);
              return jsonResponse(response, 401, failure.body, ipRateHeaders);
            }
            if (member.mfa_enabled && !verifyTotp(member.mfa_secret || "", payload?.code)) {
              const failure = apiError(requestId, "MFA_REQUIRED", "Un code d'authentification valide est requis pour ce compte.", 401);
              return jsonResponse(response, 401, failure.body, ipRateHeaders);
            }
            loginFailures.reset(attemptKey);
            const session = await membersStore.createSession({ memberId: member.id, organizationId: member.organization_id, role: member.role });
            return jsonResponse(response, 200, {
              schema: "settlemesh-session", apiVersion: API_VERSION, requestId,
              organizationId: session.organizationId,
              member: { email: member.email, role: member.role },
              mfaEnrollmentRequired: member.role === "owner" && !member.mfa_enabled,
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

        if (url.pathname === "/api/v1/auth/mfa/setup" && request.method === "POST") {
          try {
            const session = await requireValidSession(membersStore, sessionCookie);
            const member = await membersStore.findMemberById(session.member_id);
            if (!member) throw Object.assign(new Error("Session inconnue ou expirée."), { code: "SESSION_EXPIRED", status: 401 });
            const { secret, otpauthUri } = generateTotpSecret(member.email);
            await membersStore.updateMfa(member.id, { mfaSecret: secret, mfaEnabled: false });
            return jsonResponse(response, 200, {
              schema: "settlemesh-session", apiVersion: API_VERSION, requestId,
              mfaEnabled: false, secret, otpauthUri,
              notice: "Saisissez le secret dans votre application d'authentification (ou ouvrez l'URI otpauth), puis validez via /auth/mfa/enable."
            }, ipRateHeaders);
          } catch (error) {
            return membersErrorResponse(response, requestId, ipRateHeaders, error);
          }
        }

        if (url.pathname === "/api/v1/auth/mfa/enable" && request.method === "POST") {
          try {
            const session = await requireValidSession(membersStore, sessionCookie);
            const payload = await readOptionalJson(request);
            const member = await membersStore.findMemberById(session.member_id);
            if (!member) throw Object.assign(new Error("Session inconnue ou expirée."), { code: "SESSION_EXPIRED", status: 401 });
            if (!member.mfa_secret) {
              const failure = apiError(requestId, "INVALID_ADMIN_PAYLOAD", "Lancez d'abord /api/v1/auth/mfa/setup.", 400);
              return jsonResponse(response, 400, failure.body, ipRateHeaders);
            }
            if (!verifyTotp(member.mfa_secret, payload?.code)) {
              const failure = apiError(requestId, "INVALID_CREDENTIALS", "Code d'authentification invalide.", 401);
              return jsonResponse(response, 401, failure.body, ipRateHeaders);
            }
            const updated = await membersStore.updateMfa(member.id, { mfaSecret: member.mfa_secret, mfaEnabled: true });
            return jsonResponse(response, 200, {
              schema: "settlemesh-session", apiVersion: API_VERSION, requestId,
              mfaEnabled: Boolean(updated?.mfa_enabled ?? true), member: { role: member.role }, organizationId: member.organization_id
            }, ipRateHeaders);
          } catch (error) {
            return membersErrorResponse(response, requestId, ipRateHeaders, error);
          }
        }

        if (url.pathname === "/api/v1/auth/mfa/disable" && request.method === "POST") {
          try {
            const session = await requireValidSession(membersStore, sessionCookie);
            const member = await membersStore.findMemberById(session.member_id);
            if (!member) throw Object.assign(new Error("Session inconnue ou expirée."), { code: "SESSION_EXPIRED", status: 401 });
            const payload = await readOptionalJson(request);
            if (!verifyPassword(payload?.password || "", member.password_hash)) {
              const failure = apiError(requestId, "INVALID_CREDENTIALS", "Identifiants invalides.", 401);
              return jsonResponse(response, 401, failure.body, ipRateHeaders);
            }
            await membersStore.updateMfa(member.id, { mfaSecret: null, mfaEnabled: false });
            return jsonResponse(response, 200, {
              schema: "settlemesh-session", apiVersion: API_VERSION, requestId,
              mfaEnabled: false, member: { role: member.role }, organizationId: member.organization_id
            }, ipRateHeaders);
          } catch (error) {
            return membersErrorResponse(response, requestId, ipRateHeaders, error);
          }
        }

        if (url.pathname === "/api/v1/auth/password" && request.method === "POST") {
          try {
            const session = await requireValidSession(membersStore, sessionCookie);
            const payload = await readOptionalJson(request);
            const member = await membersStore.findMemberById(session.member_id);
            if (!member) throw Object.assign(new Error("Session inconnue ou expirée."), { code: "SESSION_EXPIRED", status: 401 });
            if (!verifyPassword(payload?.currentPassword || "", member.password_hash)) {
              const failure = apiError(requestId, "INVALID_CREDENTIALS", "Identifiants invalides.", 401);
              return jsonResponse(response, 401, failure.body, ipRateHeaders);
            }
            if (typeof payload?.newPassword !== "string" || payload.newPassword.length < 8) {
              const failure = apiError(requestId, "INVALID_ADMIN_PAYLOAD", "Le nouveau mot de passe doit contenir au moins 8 caractères.", 400);
              return jsonResponse(response, 400, failure.body, ipRateHeaders);
            }
            const { stored } = hashPassword(payload.newPassword);
            await membersStore.updatePassword(member.id, stored);
            return jsonResponse(response, 200, { schema: "settlemesh-session", apiVersion: API_VERSION, requestId, passwordChanged: true }, ipRateHeaders);
          } catch (error) {
            return membersErrorResponse(response, requestId, ipRateHeaders, error);
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

      if (url.pathname === "/api/v1/requirements/verify" && request.method === "POST") {
        if (!requirementsStore) {
          const failure = apiError(requestId, "REQUIREMENTS_UNAVAILABLE", "Le registre d'exigences n'est pas configuré.", 503);
          return jsonResponse(response, 503, failure.body, ipRateHeaders);
        }
        try {
          const payload = await readJson(request);
          const clean = sanitizeRequirementProfile(payload?.profile || payload);
          const row = await requirementsStore.findByIdentifier({ vatId: clean.vatId, peppolId: clean.peppolId, companyName: clean.companyName || clean.legalName });
          const verdict = verifyAgainstPublished(clean, row);
          return jsonResponse(response, 200, {
            schema: "settlemesh-requirements-verify", apiVersion: API_VERSION, requestId, stored: false,
            verdict: verdict.verdict, reason: verdict.reason, ...(verdict.mismatches ? { mismatches: verdict.mismatches } : {})
          }, ipRateHeaders);
        } catch (error) {
          if (error?.code === "REQUIREMENTS_UNAVAILABLE") {
            const failure = apiError(requestId, error.code, error.message, 503);
            return jsonResponse(response, 503, failure.body, ipRateHeaders);
          }
          const failure = apiError(requestId, error.code || "INVALID_REQUIREMENTS_PAYLOAD", error.message || "Profil du CheckLink illisible.", error.status || 400);
          return jsonResponse(response, failure.status, failure.body, ipRateHeaders);
        }
      }

      if (url.pathname === "/api/v1/requirements" && request.method === "GET") {
        if (!requirementsStore) {
          const failure = apiError(requestId, "REQUIREMENTS_UNAVAILABLE", "Le registre d'exigences n'est pas configuré.", 503);
          return jsonResponse(response, 503, failure.body, ipRateHeaders);
        }
        try {
          const query = url.searchParams.get("q") || "";
          const results = await requirementsStore.search(query);
          return jsonResponse(response, 200, {
            schema: "settlemesh-requirements", apiVersion: API_VERSION, requestId, query, count: results.length, results, stored: false
          }, ipRateHeaders);
        } catch (error) {
          if (error?.code === "REQUIREMENTS_UNAVAILABLE") {
            const failure = apiError(requestId, error.code, error.message, 503);
            return jsonResponse(response, 503, failure.body, ipRateHeaders);
          }
          const failure = apiError(requestId, error.code || "INVALID_REQUIREMENTS_QUERY", error.message, error.status || 400);
          return jsonResponse(response, failure.status, failure.body, ipRateHeaders);
        }
      }

      if (url.pathname === "/api/v1/requirements" && ["POST", "PATCH", "DELETE"].includes(request.method)) {
        if (!requirementsStore) {
          const failure = apiError(requestId, "REQUIREMENTS_UNAVAILABLE", "Le registre d'exigences exige le stockage managé.", 503);
          return jsonResponse(response, 503, failure.body, ipRateHeaders);
        }
        let credential;
        const sessionCookie = sessionCookieOf(request);
        const authHeader = String(request.headers.authorization || "");
        if (/^Bearer\s+/i.test(authHeader)) {
          const authentication = await authenticateApiKey(authHeader, await credentialsSource());
          if (!authentication.ok) {
            const error = apiError(requestId, authentication.code, authentication.message, authentication.statusCode);
            const challenge = authentication.statusCode === 401 ? { "WWW-Authenticate": 'Bearer realm="SettleMesh API"' } : {};
            return jsonResponse(response, error.status, error.body, { ...ipRateHeaders, ...challenge });
          }
          credential = authentication.credential;
        } else if (sessionCookie) {
          // Session membre humaine : la mutation d'exigences exige l'en-tête CSRF
          // personnalisé, impossible à forger depuis un autre site (SameSite=Lax).
          if (String(request.headers["x-settlemesh-csrf"] || "") !== "session") {
            const failure = apiError(requestId, "CSRF_REQUIRED", "L'en-tête X-SettleMesh-CSRF est requis pour une mutation via session.", 403);
            return jsonResponse(response, 403, failure.body, ipRateHeaders);
          }
          try {
            const session = await requireValidSession(membersStore, sessionCookie);
            credential = { organizationId: session.organization_id, role: session.role, requestsPerMinute: 60 };
          } catch (error) {
            return membersErrorResponse(response, requestId, ipRateHeaders, error);
          }
        } else {
          const failure = apiError(requestId, "AUTH_REQUIRED", "Ajoutez une clé API dans l'en-tête Authorization: Bearer, ou une session membre.", 401);
          return jsonResponse(response, 401, failure.body, { ...ipRateHeaders, "WWW-Authenticate": 'Bearer realm="SettleMesh API"' });
        }
        if (!["owner", "admin"].includes(credential.role)) {
          const failure = apiError(requestId, "FORBIDDEN_ROLE", "La publication d'exigences exige le rôle admin ou owner.", 403);
          return jsonResponse(response, 403, failure.body, ipRateHeaders);
        }
        const organizationRate = consumeOrganizationRate(credential.organizationId, credential.requestsPerMinute);
        if (!organizationRate.allowed) {
          const error = apiError(requestId, "RATE_LIMITED", "Quota de l'organisation atteint. Réessayez dans une minute.", 429);
          return jsonResponse(response, 429, error.body, rateHeaders(organizationRate, credential.requestsPerMinute, "organization"));
        }
        try {
          const payload = await readOptionalJson(request);
          if (request.method === "DELETE") {
            await requirementsStore.delete(credential.organizationId);
            return jsonResponse(response, 200, { schema: "settlemesh-requirements", apiVersion: API_VERSION, requestId, deleted: true, organizationId: credential.organizationId }, ipRateHeaders);
          }
          const published = Boolean(payload?.published);
          const record = await requirementsStore.upsert({
            organizationId: credential.organizationId,
            profile: payload?.profile || {},
            published
          });
          const message = published
            ? "Exigences publiées : cherchables publiquement, sans compte."
            : "Brouillon enregistré : non cherchable tant que published n'est pas true.";
          return jsonResponse(response, request.method === "POST" && !published ? 200 : (request.method === "POST" ? 201 : 200), {
            schema: "settlemesh-requirements", apiVersion: API_VERSION, requestId,
            organizationId: credential.organizationId, published: Boolean(record?.published),
            version: record?.version ?? null, notice: message, stored: false
          }, ipRateHeaders);
        } catch (error) {
          if (error?.code === "REQUIREMENTS_UNAVAILABLE") {
            const failure = apiError(requestId, error.code, error.message, 503);
            return jsonResponse(response, 503, failure.body, ipRateHeaders);
          }
          const failure = apiError(requestId, error.code || "INVALID_REQUIREMENTS_PAYLOAD", error.message || "Profil illisible.", error.status || 400);
          return jsonResponse(response, failure.status, failure.body, ipRateHeaders);
        }
      }

      // — Métriques d'activation consenties (0.22.0) —
      // Événement anonyme : { organizationId, action, day } uniquement,
      // liste blanche stricte, sans compte, limité par la limite IP générale.
      if (url.pathname === "/api/v1/metrics/events" && request.method === "POST") {
        if (!metricsStore) {
          const failure = apiError(requestId, "METRICS_UNAVAILABLE", "La collecte consentie exige le stockage managé.", 503);
          return jsonResponse(response, 503, failure.body, ipRateHeaders);
        }
        try {
          const payload = await readJson(request);
          const event = validateMetricEvent(payload);
          await metricsStore.insert(event);
          return jsonResponse(response, 202, { schema: METRICS_SCHEMA, apiVersion: API_VERSION, requestId, accepted: true, event }, ipRateHeaders);
        } catch (error) {
          if (error?.code === "METRICS_UNAVAILABLE") {
            const failure = apiError(requestId, error.code, error.message, 503);
            return jsonResponse(response, 503, failure.body, ipRateHeaders);
          }
          const failure = apiError(requestId, error?.code || "INVALID_METRICS_PAYLOAD", error?.message || "Événement de mesure illisible.", error?.status || 400);
          return jsonResponse(response, failure.status, failure.body, ipRateHeaders);
        }
      }

      if (url.pathname === "/api/v1/metrics" || url.pathname === "/api/v1/metrics/export") {
        if (!metricsStore) {
          const failure = apiError(requestId, "METRICS_UNAVAILABLE", "La collecte consentie exige le stockage managé.", 503);
          return jsonResponse(response, 503, failure.body, ipRateHeaders);
        }
        let authentication;
        try {
          authentication = await authenticateApiKey(request.headers.authorization, await credentialsSource());
        } catch (registryError) {
          const failure = apiError(requestId, registryError?.code || "SUPABASE_REGISTRY_UNAVAILABLE", registryError?.message || "Registre d'organisations indisponible.", registryError?.status || 503);
          return jsonResponse(response, failure.status, failure.body, ipRateHeaders);
        }
        if (!authentication.ok) {
          const error = apiError(requestId, authentication.code, authentication.message, authentication.statusCode);
          const challenge = authentication.statusCode === 401 ? { "WWW-Authenticate": 'Bearer realm="SettleMesh API"' } : {};
          return jsonResponse(response, error.status, error.body, { ...ipRateHeaders, ...challenge });
        }
        const credential = authentication.credential;
        if (!["owner", "admin"].includes(credential.role)) {
          const failure = apiError(requestId, "FORBIDDEN_ROLE", "La lecture des métriques exige le rôle admin ou owner.", 403);
          return jsonResponse(response, 403, failure.body, ipRateHeaders);
        }
        const organizationRate = consumeOrganizationRate(credential.organizationId, credential.requestsPerMinute);
        if (!organizationRate.allowed) {
          const error = apiError(requestId, "RATE_LIMITED", "Quota de l'organisation atteint. Réessayez dans une minute.", 429);
          return jsonResponse(response, 429, error.body, rateHeaders(organizationRate, credential.requestsPerMinute, "organization"));
        }
        try {
          const { from, to } = validateMetricRange(url.searchParams.get("from"), url.searchParams.get("to"));
          const rows = await metricsStore.range({ organizationId: credential.organizationId, from, to });
          const aggregated = aggregateMetricRows(rows, { organizationId: credential.organizationId, from, to });
          if (url.pathname === "/api/v1/metrics/export") {
            const csv = metricsCsv(aggregated);
            response.writeHead(200, {
              ...ipRateHeaders,
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": `attachment; filename="settlemesh-metriques-${from}-${to}.csv"`,
              "Cache-Control": "no-store"
            });
            response.end(csv);
            return;
          }
          return jsonResponse(response, 200, { schema: METRICS_SCHEMA, apiVersion: API_VERSION, requestId, ...aggregated }, ipRateHeaders);
        } catch (error) {
          if (error?.code === "METRICS_UNAVAILABLE") {
            const failure = apiError(requestId, error.code, error.message, 503);
            return jsonResponse(response, 503, failure.body, ipRateHeaders);
          }
          const failure = apiError(requestId, error?.code || "INVALID_METRICS_RANGE", error?.message || "Période de métriques illisible.", error?.status || 400);
          return jsonResponse(response, failure.status, failure.body, ipRateHeaders);
        }
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
