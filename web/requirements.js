// Client same-origin du registre public d'exigences. Comme identity.js :
// uniquement des routes relatives à la même origine, réponses structurées,
// jamais de contenu de facture ni d'obligation dans un appel.

const BASE = "/api/v1/requirements";

const request = async (path, { method = "GET", payload, fetchImpl = fetch, timeoutMs = 10_000, sessionMutation = false } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: "application/json" };
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    if (sessionMutation) headers["X-SettleMesh-CSRF"] = "session";
    const response = await fetchImpl(`${BASE}${path}`, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller.signal
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error?.message || `Requête impossible (HTTP ${response.status}).`);
      error.status = response.status;
      error.code = body?.error?.code;
      throw error;
    }
    return body;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("La requête a dépassé le délai de 10 secondes.");
      timeoutError.code = "REQUIREMENTS_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const searchRequirements = (q, options) => request(`?q=${encodeURIComponent(String(q || ""))}`, options);
export const resolveRequirements = (organizationId, options) => request(`/public/${encodeURIComponent(organizationId)}`, options);
export const verifyRequirements = (profile, options) => request("/verify", { method: "POST", payload: { profile }, ...options });
export const publishRequirements = (profile, { published = true, ...options } = {}) => request("", { method: "POST", payload: { profile, published }, sessionMutation: true, ...options });
export const unpublishRequirements = (options) => request("", { method: "DELETE", sessionMutation: true, ...options });
