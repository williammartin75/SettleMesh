// Métriques d'activation consenties, côté serveur (0.22.0).
// Chaque ligne d'événement est minimisée (pas une garantie d'anonymat réseau) —
// organisation, jour, action, quantité 1. Rien d'autre : jamais de numéro
// de facture, de fournisseur, de montant, d'identifiant fiscal, de XML,
// d'adresse IP ou d'identifiant de session dans la table. La ligne ne doit
// pas contenir d'identifiant de facture ou de personne. L'hébergeur reçoit
// néanmoins les métadonnées réseau usuelles ; ces compteurs sont déclaratifs.

export const METRICS_SCHEMA = "settlemesh-metrics";
export const METRICS_ACTIONS = Object.freeze(["checklink_copied", "invoice_checked", "invoice_ready"]);

const ORGANIZATION_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 92;
const DAY_MS = 86_400_000;
const validDay = (day) => DAY_PATTERN.test(day || "") && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;

const invalid = (message) => Object.assign(new Error(message), { code: "INVALID_METRICS_PAYLOAD", status: 400 });

// Liste blanche stricte : la fonction renvoie EXACTEMENT les trois champs
// autorisés ; toute autre propriété du corps (numéro de facture, fournisseur,
// montant, identifiant fiscal, xml, ip, session…) est ignorée et jamais
// transportée vers le stockage.
export function validateMetricEvent(payload) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const organizationId = String(source.organizationId ?? "").trim();
  const action = String(source.action ?? "").trim();
  const day = String(source.day ?? "").trim();
  if (!ORGANIZATION_PATTERN.test(organizationId)) throw invalid("L'identifiant d'organisation attend la forme d'un slug (lettres, chiffres, tirets).");
  if (!METRICS_ACTIONS.includes(action)) throw invalid(`L'action de mesure doit être l'une de : ${METRICS_ACTIONS.join(", ")}.`);
  if (!validDay(day)) throw invalid("Le jour attend une date réelle au format AAAA-MM-JJ.");
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (day > todayUtc && Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayUtc}T00:00:00Z`) > DAY_MS) {
    throw invalid("Un jour futur ne peut pas être mesuré.");
  }
  return { organizationId, action, day };
}

export function validateMetricRange(from, to) {
  if (!DAY_PATTERN.test(from || "") || !DAY_PATTERN.test(to || "")) throw Object.assign(new Error("Les bornes from et to attendent le format AAAA-MM-JJ."), { code: "INVALID_METRICS_RANGE", status: 400 });
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!validDay(from) || !validDay(to)) throw Object.assign(new Error("Bornes de période illisibles."), { code: "INVALID_METRICS_RANGE", status: 400 });
  if (start > end) throw Object.assign(new Error("La borne from doit précéder la borne to."), { code: "INVALID_METRICS_RANGE", status: 400 });
  if (end - start > MAX_RANGE_DAYS * DAY_MS) throw Object.assign(new Error(`La période de lecture est limitée à ${MAX_RANGE_DAYS} jours.`), { code: "INVALID_METRICS_RANGE", status: 400 });
  return { from, to };
}

// Agrégation par jour et action, filtrée sur l'organisation résolue côté
// serveur (défense en profondeur : une ligne d'une autre organisation
// n'entre jamais dans la réponse).
export function aggregateMetricRows(rows, { organizationId, from, to }) {
  const totals = Object.fromEntries(METRICS_ACTIONS.map((action) => [action, 0]));
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.organization_id !== organizationId) continue;
    if (String(row.day) < from || String(row.day) > to) continue;
    if (!METRICS_ACTIONS.includes(row.action)) continue;
    const count = Math.max(0, Math.floor(Number(row.count) || 0));
    totals[row.action] += count;
    const key = `${row.day}:${row.action}`;
    grouped.set(key, { day: String(row.day), action: row.action, count: (grouped.get(key)?.count || 0) + count });
  }
  const days = [...grouped.values()];
  days.sort((left, right) => left.day.localeCompare(right.day) || left.action.localeCompare(right.action));
  return { organizationId, from, to, totals, days };
}

// Export CSV neutralisé : toute cellule commençant par =, +, - ou @ est
// préfixée d'une apostrophe (aucune formule exécutable dans un tableur).
const neutralizeCell = (value) => (/^[=+@-]/.test(String(value)) ? `'${value}` : String(value));

export function metricsCsv(aggregated) {
  const lines = ["day,action,count"];
  for (const entry of aggregated.days) {
    lines.push(`${neutralizeCell(entry.day)},${neutralizeCell(entry.action)},${neutralizeCell(entry.count)}`);
  }
  return `${lines.join("\r\n")}\r\n`;
}

const restUnavailable = (detail) => Object.assign(
  new Error(`Collecte de métriques indisponible : ${detail}`),
  { statusCode: 503, code: "METRICS_UNAVAILABLE" }
);

// Adaptateur PostgREST (fetch natif, aucune dépendance) : insertions
// append-only d'une ligne par événement, lecture bornée par organisation.
export function createSupabaseMetrics({ projectRef, serviceKey, fetchImpl = globalThis.fetch } = {}) {
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
    async insert({ organizationId, action, day }) {
      await request("/settlemesh_metrics", {
        method: "POST",
        body: JSON.stringify([{ organization_id: organizationId, action, day, count: 1 }])
      });
      return true;
    },
    async range({ organizationId, from, to }) {
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const response = await request(`/settlemesh_metrics?organization_id=eq.${encodeURIComponent(organizationId)}&day=gte.${encodeURIComponent(from)}&day=lte.${encodeURIComponent(to)}&select=organization_id,day,action,count&order=id&limit=1000&offset=${offset}`);
        const page = await response.json();
        if (!Array.isArray(page)) throw restUnavailable("réponse illisible");
        rows.push(...page);
        if (page.length < 1000) return rows;
        if (rows.length >= 100_000) throw restUnavailable("volume trop important : agrégation en base requise, aucun total partiel servi");
      }
    }
  };
}
