// Usage déclaré : accord du visiteur ET activation par l'acheteur publié.
// Sans ces deux choix, aucune requête de mesure. Le corps ne contient que
// { organizationId, action, day }, avec un jeton d'organisation en en-tête.
// Pas de données de facture ; le transport réseau reste visible à l'hébergeur.

const EVENT_ENDPOINT = "/api/v1/metrics/events";

const localDay = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

export async function reportEvent(profile, action, { fetchImpl = fetch, day, timeoutMs = 5_000, visitorConsent = false } = {}) {
  if (profile?.usageMetricsConsent !== true || visitorConsent !== true) return { sent: false, reason: "no-consent" };
  const organizationId = String(profile.organizationId || "");
  if (!organizationId) return { sent: false, reason: "no-organization" };
  if (!profile.metricsToken) return { sent: false, reason: "no-token" };
  const body = { organizationId, action, day: day || localDay() };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(EVENT_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-SettleMesh-Metrics-Token": profile.metricsToken },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    return { sent: response.ok, reason: response.ok ? "accepted" : `http-${response.status}` };
  } catch {
    // Un échec d'envoi ne doit jamais perturber l'expérience : silencieux.
    return { sent: false, reason: "unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}
