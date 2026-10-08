// Moteur de packs de règles nationales. Chaque pack est une donnée déclarative
// figée (pays, version, dates d'effet, sources citées). Aucune règle ne peut
// convertir une indisponibilité de validateur en succès et aucune règle ne
// contient de logique exécutée à l'aveugle : seuls les types connus du moteur
// sont évalués, les autres sont ignorés prudemment.

import frPack from "./fr-1.0.0.mjs";

const PACKS = [frPack];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ISO_DATE_PATTERN = (value) => ISO_DATE.test(String(value || ""));
const todayIsoDate = () => {
  const date = new Date();
  const part = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
};

export function validatePack(pack) {
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) throw new Error("Pack national invalide : objet attendu.");
  if (typeof pack.country !== "string" || !/^[A-Z]{2}$/.test(pack.country)) throw new Error("Pack national invalide : code pays attendu (deux lettres majuscules).");
  if (!/^\d+\.\d+\.\d+$/.test(String(pack.version || ""))) throw new Error("Pack national invalide : version formée de trois nombres attendue.");
  if (!ISO_DATE_PATTERN(pack.effectiveFrom)) throw new Error("Pack national invalide : effectiveFrom au format AAAA-MM-JJ attendu.");
  if (pack.effectiveUntil !== null && pack.effectiveUntil !== undefined && !ISO_DATE_PATTERN(pack.effectiveUntil)) throw new Error("Pack national invalide : effectiveUntil doit être null ou une date AAAA-MM-JJ.");
  if (pack.effectiveUntil && pack.effectiveUntil < pack.effectiveFrom) throw new Error("Pack national invalide : effectiveUntil anterior à effectiveFrom.");
  if (!Array.isArray(pack.rules) || !pack.rules.length) throw new Error("Pack national invalide : aucune règle fournie.");
  if (!pack.source || typeof pack.source.label !== "string" || !pack.source.label.trim()) throw new Error("Pack national invalide : source obligatoire, une règle officielle doit rester identifiable.");
  for (const rule of pack.rules) {
    if (!rule || typeof rule.id !== "string" || !rule.id) throw new Error("Pack national invalide : règle sans identifiant.");
    if (!["id-format", "notice"].includes(rule.kind)) continue; // les types inconnus sont ignorés par le moteur
    if (rule.kind === "id-format") {
      if (!Array.isArray(rule.fields) || !rule.fields.length) throw new Error(`Pack national invalide : la règle ${rule.id} ne cible aucun champ.`);
      if (!new RegExp(rule.pattern, "u")) throw new Error(`Pack national invalide : motif illégal dans ${rule.id}.`);
    }
  }
  return pack;
}

export function listPacks() {
  return PACKS;
}

function packActive(pack, country, date) {
  if (pack.country !== country) return false;
  if (date < pack.effectiveFrom) return false;
  if (pack.effectiveUntil && date > pack.effectiveUntil) return false;
  return true;
}

export function activePacks(country, date = todayIsoDate()) {
  const normalizedCountry = String(country || "").trim().toUpperCase();
  return PACKS.filter((pack) => packActive(pack, normalizedCountry, date)).map((pack) => ({
    country: pack.country,
    version: pack.version,
    effectiveFrom: pack.effectiveFrom,
    sourceLabel: pack.source.label,
    sourceHref: pack.source.href,
    checkIds: pack.rules.map((rule) => rule.id),
    ruleTitles: pack.rules.map((rule) => rule.title)
  }));
}

const upperId = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const patternOf = (() => {
  const memo = new Map();
  return (source) => {
    if (!memo.has(source)) memo.set(source, new RegExp(source));
    return memo.get(source);
  };
})();

const makeCheck = (id, status, title, message, fix, field) => ({ id, status, title, message, fix, field });

export function nationalChecks(invoice, profile, { country, date = todayIsoDate() } = {}) {
  const normalizedCountry = String(country || profile?.country || "").trim().toUpperCase();
  const checks = [];
  for (const pack of listPacks()) {
    if (!packActive(pack, normalizedCountry, date)) continue;
    for (const rule of pack.rules) {
      if (rule.kind === "notice") {
        checks.push(makeCheck(rule.id, "info", rule.title, rule.message, rule.fix || "", rule.field));
        continue;
      }
      if (rule.kind !== "id-format") continue; // type inconnu : ignoré prudemment
      let evaluated = 0;
      let problem = false;
      for (const name of rule.fields) {
        const value = upperId(invoice?.[name]);
        if (!value || !value.startsWith(rule.prefix)) continue;
        evaluated += 1;
        if (!patternOf(rule.pattern).test(value)) problem = true;
      }
      if (!evaluated) continue; // aucun identifiant du pays visé : la règle n'a rien à dire
      checks.push(problem
        ? makeCheck(rule.id, "error", rule.title, rule.koMessage, rule.fix, rule.field)
        : makeCheck(rule.id, "pass", rule.title, rule.okMessage, "", rule.field));
    }
  }
  return checks;
}
