import { parseRegistryDocument, buildRegistryDocument } from "./registry.mjs";

// Adaptateur Supabase du registre d'organisations (même contrat que le
// fichier local : document settlemesh-registry-1). Une seule ligne
// (id = 1) porte le document complet ; l'écriture est un upsert atomique
// et la lecture est mise en cache quelques secondes pour limiter la
// latence tout en conservant l'effet « à chaud » des révocations.
// Utilise uniquement fetch natif : aucune dépendance nouvelle.

const SCHEMA_NAME = "settlemesh-registry-1";

const registryUnavailable = (detail) => Object.assign(
  new Error(`Registre Supabase indisponible : ${detail}`),
  { statusCode: 503, code: "SUPABASE_REGISTRY_UNAVAILABLE" }
);

const restBase = (projectRef) => `https://${projectRef}.supabase.co/rest/v1`;

export function createSupabaseRegistry({ projectRef, serviceKey, fetchImpl = globalThis.fetch, pollMs = 5000 } = {}) {
  if (!projectRef || !serviceKey) {
    throw registryUnavailable("SETTLEMESH_SUPABASE_PROJECT_REF et SETTLEMESH_SUPABASE_SERVICE_KEY sont requis.");
  }
  if (typeof fetchImpl !== "function") {
    throw registryUnavailable("fetch indisponible dans cet environnement.");
  }
  const base = restBase(projectRef);
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Accept: "application/json" };
  let cache = null;
  let cachedAtMs = 0;

  const load = async (force = false) => {
    if (!force && cache && Date.now() - cachedAtMs < pollMs) return cache;
    let response;
    try {
      response = await fetchImpl(`${base}/settlemesh_registry?select=schema_name,document&id=eq.1`, { headers });
    } catch (error) {
      throw registryUnavailable(error?.message || "requête impossible");
    }
    if (!response.ok && response.status !== 404) {
      throw registryUnavailable(`réponse ${response.status} lors de la lecture`);
    }
    const rows = response.ok ? await response.json() : [];
    if (!Array.isArray(rows)) throw registryUnavailable("réponse inattendue du stockage");
    if (!rows.length) {
      cache = { entries: [], document: null };
    } else {
      const parsed = parseRegistryDocument(rows[0].document);
      cache = { entries: parsed.entries, document: parsed.document };
    }
    cachedAtMs = Date.now();
    return cache;
  };

  return {
    credentials: async (force = false) => (await load(force)).entries,
    document: async (force = false) => (await load(force)).document,
    write: async (entries) => {
      const document = buildRegistryDocument(entries);
      parseRegistryDocument(document);
      const body = { id: 1, schema_name: SCHEMA_NAME, document, updated_at: new Date().toISOString() };
      let response;
      try {
        response = await fetchImpl(`${base}/settlemesh_registry?on_conflict=id`, {
          method: "POST",
          headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(body)
        });
      } catch (error) {
        throw registryUnavailable(error?.message || "écriture impossible");
      }
      if (!response.ok && response.status !== 201 && response.status !== 204) {
        throw registryUnavailable(`réponse ${response.status} lors de l'écriture`);
      }
      cache = { entries: parseRegistryDocument(document).entries, document };
      cachedAtMs = Date.now();
      return document;
    }
  };
}
