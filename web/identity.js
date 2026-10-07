const ENDPOINTS = Object.freeze({
  vies: "/api/v1/identity/vies",
  peppol: "/api/v1/identity/peppol"
});

export async function requestIdentityCheck(source, payload, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const endpoint = ENDPOINTS[source];
  if (!endpoint) throw new Error("Source d’identité inconnue.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error?.message || `Vérification impossible (HTTP ${response.status}).`);
      error.status = response.status;
      error.code = body?.error?.code;
      throw error;
    }
    return body;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("La vérification a dépassé le délai de 10 secondes.");
      timeoutError.code = "IDENTITY_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const checkViesIdentity = (countryCode, vatNumber, options) => requestIdentityCheck("vies", { countryCode, vatNumber }, options);
export const checkPeppolIdentity = (participantId, options) => requestIdentityCheck("peppol", { participantId }, options);
