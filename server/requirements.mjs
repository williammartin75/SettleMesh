// Registre public d'exigences de réception (étape 4 du pack).
// Objectif : un fournisseur peut trouver et vérifier les exigences d'un
// client, sans compte. Invariant central : rien n'est cherchable sans
// publication explicite (published = true). Les champs sont une liste
// blanche stricte — uniquement ce que le fragment CheckLink porte déjà :
// jamais de secret, jamais de donnée bancaire, jamais de contenu de
// facture ni d'obligation.

const PROFILE_FIELDS = [
  "companyName", "legalName", "country", "vatId", "peppolId", "routingProvider",
  "acceptedFormats", "acceptedCurrencies",
  "requirePurchaseOrder", "requireBuyerReference", "requireEndpoint", "requireAttachment",
  "submissionEmail", "instructions"
];
const SEARCH_MINIMIZED_FIELDS = ["companyName", "legalName", "country", "vatId", "peppolId", "acceptedFormats", "acceptedCurrencies"];

const cleanText = (value) => String(value ?? "").trim();
const cleanUpper = (value) => cleanText(value).toUpperCase().replace(/\s+/g, "");

// Liste blanche : propriétés inconnues (et tout contenu de facture ou
// d'obligation) sont silencieusement écartés de la publication.
export function sanitizeRequirementProfile(profile) {
  const source = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
  const clean = {};
  for (const field of PROFILE_FIELDS) {
    if (source[field] === undefined) continue;
    if (Array.isArray(source[field])) {
      clean[field] = [...new Set(source[field].map((item) => cleanUpper(item)))].filter(Boolean);
    } else if (typeof source[field] === "boolean") {
      clean[field] = Boolean(source[field]);
    } else if (field === "submissionEmail") {
      clean[field] = cleanText(source[field]).toLowerCase();
    } else if (field === "vatId" || field === "peppolId" || field === "country") {
      clean[field] = field === "country" ? cleanUpper(source[field]).slice(0, 2) : cleanUpper(source[field]);
    } else {
      clean[field] = cleanText(source[field]);
    }
  }
  if (!clean.companyName && !clean.legalName) {
    throw Object.assign(new Error("Un profil publié doit porter un nom d'entreprise."), { code: "INVALID_REQUIREMENTS_PAYLOAD", status: 400 });
  }
  return clean;
}

const canonicalName = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Normalisation symétrique : un champ omis est équivalent à sa valeur par
// défaut ("" ou false ou []), des deux côtés de la comparaison — un lien
// CheckLink porte le profil entier, mais la comparaison ne doit jamais
// diverger sur une simple asymétrie omission/défaut.
const PROFILE_DEFAULTS = {
  companyName: "", legalName: "", country: "", vatId: "", peppolId: "", routingProvider: "",
  acceptedFormats: [], acceptedCurrencies: [],
  requirePurchaseOrder: false, requireBuyerReference: false, requireEndpoint: false, requireAttachment: false,
  submissionEmail: "", instructions: ""
};
const normalizedSide = (profile) => {
  const clean = sanitizeRequirementProfile(profile && typeof profile === "object" ? profile : {});
  const normalized = {};
  for (const field of PROFILE_FIELDS) {
    normalized[field] = clean[field] ?? PROFILE_DEFAULTS[field];
  }
  return normalized;
};

// Comparaison entre le profil décodé d'un CheckLink et l'entrée publiée.
// Verdicts : verified | mismatch | not_published | unknown.
// La réponse liste seulement les noms de champs divergents (minimisée).
export function verifyAgainstPublished(decodedProfile, publishedRow) {
  if (!publishedRow) return { verdict: "unknown", reason: "aucune exigence publiée pour cette organisation." };
  if (!publishedRow.published) return { verdict: "not_published", reason: "les exigences existent mais ne sont pas publiées." };
  const candidate = normalizedSide(decodedProfile);
  const stored = normalizedSide(publishedRow.profile || {});
  const mismatches = [];
  for (const field of PROFILE_FIELDS) {
    const left = JSON.stringify(candidate[field] ?? null);
    const right = JSON.stringify(stored[field] ?? null);
    const same = left === right
      || (field === "companyName" || field === "legalName"
        ? canonicalName(candidate[field]) === canonicalName(stored[field]) && canonicalName(candidate[field]) !== ""
        : false);
    if (!same) mismatches.push(field);
  }
  return mismatches.length
    ? { verdict: "mismatch", reason: "le profil du lien ne correspond pas aux exigences publiées.", mismatches }
    : { verdict: "verified", reason: "le profil du CheckLink correspond aux exigences publiées." };
}

const restUnavailable = (detail) => Object.assign(
  new Error(`Registre d'exigences indisponible : ${detail}`),
  { statusCode: 503, code: "REQUIREMENTS_UNAVAILABLE" }
);

const ROW_FIELDS = ["id", "organization_id", "company_name", "legal_name", "country", "vat_id", "peppol_id", "accepted_formats", "accepted_currencies", "requirements", "version", "published", "created_at", "updated_at"];

const rowToRecord = (row) => row && ({
  organizationId: row.organization_id,
  profile: {
    companyName: row.company_name,
    legalName: row.legal_name,
    country: row.country || "",
    vatId: row.vat_id || "",
    peppolId: row.peppol_id || "",
    ...(row.accepted_formats ? { acceptedFormats: row.accepted_formats } : {}),
    ...(row.accepted_currencies ? { acceptedCurrencies: row.accepted_currencies } : {}),
    ...(row.requirements || {})
  },
  version: row.version,
  published: row.published,
  updatedAt: row.updated_at
});

export function createSupabaseRequirements({ projectRef, serviceKey, fetchImpl = globalThis.fetch } = {}) {
  if (!projectRef || !serviceKey) {
    throw restUnavailable("SETTLEMESH_SUPABASE_PROJECT_REF et SETTLEMESH_SUPABASE_SERVICE_KEY sont requis.");
  }
  const base = `https://${projectRef}.supabase.co/rest/v1`;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Accept: "application/json" };
  const request = async (url, init = {}) => {
    let response;
    try {
      response = await fetchImpl(`${base}${url}`, { ...init, headers: { ...headers, ...init.headers } });
    } catch (error) {
      throw restUnavailable(error?.message || "requête impossible");
    }
    if (!response.ok) throw restUnavailable(`réponse ${response.status}`);
    return response;
  };

  return {
    async upsert({ organizationId, profile, published }) {
      const clean = sanitizeRequirementProfile(profile);
      // incrément de version à chaque écriture : la version publiée est
      // réversible et observable par le fournisseur (verify, mise en cache)
      const existing = await this.findByOrganization(organizationId);
      const version = (Number(existing?.version) || 0) + 1;
      const body = {
        organization_id: organizationId,
        company_name: clean.companyName || clean.legalName,
        legal_name: clean.legalName || clean.companyName || "",
        country: clean.country || "",
        vat_id: clean.vatId || "",
        peppol_id: clean.peppolId || "",
        accepted_formats: clean.acceptedFormats || [],
        accepted_currencies: clean.acceptedCurrencies || [],
        requirements: {
          routingProvider: clean.routingProvider || "",
          requirePurchaseOrder: Boolean(clean.requirePurchaseOrder),
          requireBuyerReference: Boolean(clean.requireBuyerReference),
          requireEndpoint: Boolean(clean.requireEndpoint),
          requireAttachment: Boolean(clean.requireAttachment),
          submissionEmail: clean.submissionEmail || "",
          instructions: clean.instructions || ""
        },
        published: Boolean(published),
        version,
        updated_at: new Date().toISOString()
      };
      const response = await request("/settlemesh_requirements?on_conflict=organization_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(body)
      });
      const rows = await response.json();
      return rows.length ? rowToRecord(rows[0]) : null;
    },
    async findByOrganization(organizationId) {
      const response = await request(`/settlemesh_requirements?organization_id=eq.${encodeURIComponent(organizationId)}&select=${ROW_FIELDS.join(",")}`);
      const rows = await response.json();
      return rows.length ? rowToRecord(rows[0]) : null;
    },
    async findByIdentifier({ vatId = "", peppolId = "", companyName = "" } = {}) {
      const vat = cleanUpper(vatId);
      const peppol = cleanUpper(peppolId);
      const name = cleanText(companyName);
      if (vat) {
        const response = await request(`/settlemesh_requirements?vat_id=eq.${encodeURIComponent(vat)}&select=${ROW_FIELDS.join(",")}`);
        const rows = await response.json();
        if (rows.length) return rowToRecord(rows[0]);
      }
      if (peppol) {
        const response = await request(`/settlemesh_requirements?peppol_id=eq.${encodeURIComponent(peppol)}&select=${ROW_FIELDS.join(",")}`);
        const rows = await response.json();
        if (rows.length) return rowToRecord(rows[0]);
      }
      if (name) {
        const response = await request(`/settlemesh_requirements?company_name=eq.${encodeURIComponent(name)}&select=${ROW_FIELDS.join(",")}`);
        const rows = await response.json();
        if (rows.length) return rowToRecord(rows[0]);
      }
      return null;
    },
    async search(query) {
      const q = cleanText(query);
      if (!q) throw Object.assign(new Error("Une recherche exige un mot-clé (raison sociale, TVA ou identifiant Peppol)."), { code: "INVALID_REQUIREMENTS_QUERY", status: 400 });
      // toute forme nettoyée de numéro intracommunautaire (2 lettres + au moins 5 signes) est traitée comme une TVA
      const cleaned = cleanUpper(q);
      const vat = /^[A-Z]{2}[0-9A-Z]{5,}$/.test(cleaned) ? cleaned : "";
      const conditions = [
        `company_name.ilike.${encodeURIComponent(`*${q}*`)}`,
        vat ? `vat_id.eq.${vat}` : null,
        `peppol_id.eq.${encodeURIComponent(cleanUpper(q))}`
      ].filter(Boolean).join(",");
      const response = await request(`/settlemesh_requirements?published=eq.true&or=(${conditions})&select=${ROW_FIELDS.join(",")}&order=company_name&limit=20`);
      const rows = await response.json();
      return (Array.isArray(rows) ? rows : []).map(rowToRecord).map((record) => {
        const minimized = {};
        for (const field of SEARCH_MINIMIZED_FIELDS) {
          if (record.profile[field] !== undefined) minimized[field] = record.profile[field];
        }
        return { organizationId: record.organizationId, profile: minimized, published: record.published };
      });
    },
    async delete(organizationId) {
      await request(`/settlemesh_requirements?organization_id=eq.${encodeURIComponent(organizationId)}`, { method: "DELETE" });
      return true;
    }
  };
}
