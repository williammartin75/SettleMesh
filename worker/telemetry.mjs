// Signed, short-lived organization binding. These remain self-reported usage
// signals, never evidence of customers, unique suppliers or avoided rejection.
const encoder = new TextEncoder();
const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
async function signature(text, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
}
export async function issueMetricsToken(organizationId, secret, now = Date.now()) {
  if (!secret) return null;
  const payload = `${organizationId}.${Math.floor(now / 1000) + 300}`;
  return `${payload}.${await signature(payload, secret)}`;
}
export async function authorizeMetricEvent(event, token, secret, requirementsStore, now = Date.now()) {
  const [organizationId, expires, mac, ...rest] = String(token || "").split(".");
  const payload = `${organizationId}.${expires}`;
  if (!secret || rest.length || organizationId !== event.organizationId || !/^\d+$/.test(expires) || Number(expires) <= now / 1000 || Number(expires) > now / 1000 + 301 || !/^[a-f0-9]{64}$/.test(mac || "") || await signature(payload, secret) !== mac) {
    throw Object.assign(new Error("Jeton de mesure absent, invalide ou expiré. Rechargez le lien publié."), { code: "METRICS_TOKEN_REQUIRED", status: 403 });
  }
  const record = await requirementsStore?.findByOrganization(event.organizationId);
  if (!record?.published || record.profile?.usageMetricsConsent !== true) throw Object.assign(new Error("Cette organisation n'a pas activé la mesure sur un profil publié."), { code: "METRICS_NOT_ENABLED", status: 403 });
}
