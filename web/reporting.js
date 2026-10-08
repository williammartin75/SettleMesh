// Signalement d'activation consentie, côté navigateur.
// INVARIANT ABSOLU : sans consentement explicite porté par le profil
// (usageMetricsConsent === true), AUCUNE requête n'est déclenchée — zéro
// octet ne quitte le navigateur. Le corps est exactement
// { organizationId, action, day } : jamais de contenu de facture,
// d'identifiant fiscal, de fournisseur, de montant ni d'horodatage fin.

import { profileSlug } from "./core.js";

const EVENT_ENDPOINT = "/api/v1/metrics/events";

const localDay = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

export async function reportEvent(profile, action, { fetchImpl = fetch, day, timeoutMs = 5_000 } = {}) {
  if (profile?.usageMetricsConsent !== true) return { sent: false, reason: "no-consent" };
  const organizationId = String(profile.companySlug || profileSlug(profile.companyName) || "").slice(0, 64);
  if (!organizationId) return { sent: false, reason: "no-organization" };
  const body = { organizationId, action, day: day || localDay() };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(EVENT_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
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
