export const VIES_ENDPOINT = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
export const PEPPOL_DIRECTORY_ENDPOINT = "https://directory.peppol.eu/search/1.0/json";

const VAT_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT",
  "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI"
]);

export class IdentityInputError extends Error {
  constructor(message, code = "INVALID_IDENTITY_INPUT") {
    super(message);
    this.name = "IdentityInputError";
    this.code = code;
    this.statusCode = 400;
  }
}

export function normalizeVatInput(input = {}) {
  const countryCode = String(input.countryCode || "").trim().toUpperCase();
  if (!VAT_COUNTRIES.has(countryCode)) {
    throw new IdentityInputError("Sélectionnez un pays pris en charge par VIES.", "INVALID_VAT_COUNTRY");
  }
  let vatNumber = String(input.vatNumber || "").trim().toUpperCase().replace(/[\s.\-]/g, "");
  if (vatNumber.startsWith(countryCode)) vatNumber = vatNumber.slice(countryCode.length);
  if (!/^[A-Z0-9]{2,14}$/.test(vatNumber)) {
    throw new IdentityInputError("Saisissez un numéro de TVA valide, sans le préfixe pays.", "INVALID_VAT_NUMBER");
  }
  return { countryCode, vatNumber };
}

export function normalizePeppolInput(value) {
  const raw = String(value || "").trim();
  const participantId = raw.replace(/^iso6523-actorid-upis::/i, "");
  if (!/^\d{4}:[A-Za-z0-9][A-Za-z0-9._+\-/:]{1,79}$/.test(participantId)) {
    throw new IdentityInputError("Utilisez le format Peppol 0088:1234567890123.", "INVALID_PEPPOL_ID");
  }
  return participantId;
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

const unavailable = (source, identifier, message) => ({
  schema: "settlemesh-identity-check",
  source,
  status: "unavailable",
  identifier,
  checkedAt: new Date().toISOString(),
  stored: false,
  message
});

export async function verifyVies(input, { fetchImpl = fetch, timeoutMs = 8_000 } = {}) {
  const { countryCode, vatNumber } = normalizeVatInput(input);
  const identifier = `${countryCode}${vatNumber}`;
  try {
    const response = await fetchWithTimeout(fetchImpl, VIES_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ countryCode, vatNumber })
    }, timeoutMs);
    if (!response.ok) return unavailable("VIES", identifier, `VIES a répondu avec le statut HTTP ${response.status}.`);
    const result = await response.json();
    const verified = result?.valid === true;
    return {
      schema: "settlemesh-identity-check",
      source: "VIES",
      status: verified ? "verified" : "not_verified",
      identifier,
      checkedAt: result?.requestDate || new Date().toISOString(),
      stored: false,
      legalName: verified && result?.name && result.name !== "---" ? String(result.name) : null,
      address: verified && result?.address && result.address !== "---" ? String(result.address) : null,
      message: verified
        ? "Numéro déclaré valide par VIES au moment de la requête."
        : "VIES n’a pas confirmé ce numéro au moment de la requête."
    };
  } catch (error) {
    const message = error?.name === "AbortError" ? "VIES n’a pas répondu dans le délai prévu." : "VIES est momentanément inaccessible.";
    return unavailable("VIES", identifier, message);
  }
}

export async function verifyPeppol(value, { fetchImpl = fetch, timeoutMs = 8_000 } = {}) {
  const participantId = normalizePeppolInput(value);
  const participant = `iso6523-actorid-upis::${participantId}`;
  const url = `${PEPPOL_DIRECTORY_ENDPOINT}?participant=${encodeURIComponent(participant)}`;
  try {
    const response = await fetchWithTimeout(fetchImpl, url, { method: "GET", headers: { Accept: "application/json" } }, timeoutMs);
    if (!response.ok) return unavailable("Peppol Directory", participantId, `Peppol Directory a répondu avec le statut HTTP ${response.status}.`);
    const result = await response.json();
    const match = Array.isArray(result?.matches) ? result.matches[0] : null;
    const entity = Array.isArray(match?.entities) ? match.entities[0] : null;
    const nameEntry = Array.isArray(entity?.name) ? entity.name[0] : null;
    const verified = Number(result?.["total-result-count"] || 0) > 0 && Boolean(match);
    return {
      schema: "settlemesh-identity-check",
      source: "Peppol Directory",
      status: verified ? "verified" : "not_verified",
      identifier: participantId,
      checkedAt: result?.["creation-dt"] || new Date().toISOString(),
      stored: false,
      legalName: verified && nameEntry?.name ? String(nameEntry.name) : null,
      countryCode: verified && entity?.countryCode ? String(entity.countryCode) : null,
      registeredOn: verified && entity?.regDate ? String(entity.regDate) : null,
      acceptedDocumentTypes: verified && Array.isArray(match?.docTypes) ? match.docTypes.length : 0,
      message: verified
        ? "Participant trouvé dans Peppol Directory au moment de la requête."
        : "Aucun participant correspondant n’a été trouvé dans Peppol Directory."
    };
  } catch (error) {
    const message = error?.name === "AbortError" ? "Peppol Directory n’a pas répondu dans le délai prévu." : "Peppol Directory est momentanément inaccessible.";
    return unavailable("Peppol Directory", participantId, message);
  }
}
