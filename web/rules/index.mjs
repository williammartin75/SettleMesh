// Moteur de packs de règles nationales. Chaque pack est une donnée déclarative
// figée (pays, version, dates d'effet, sources citées). Aucune règle ne peut
// convertir une indisponibilité de validateur en succès et aucune règle ne
// contient de logique exécutée à l'aveugle : seuls les types connus du moteur
// sont évalués, les autres sont ignorés prudemment.

import frPack from "./fr-1.3.0.mjs";
import dePack from "./de-1.0.0.mjs";
import bePack from "./be-1.0.0.mjs";

const PACKS = [frPack, dePack, bePack];
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
    if (rule.kind === "id-format") {
      if (!Array.isArray(rule.fields) || !rule.fields.length) throw new Error(`Pack national invalide : la règle ${rule.id} ne cible aucun champ.`);
      if (!new RegExp(rule.pattern, "u")) throw new Error(`Pack national invalide : motif illégal dans ${rule.id}.`);
    }
    if (rule.kind === "numeric-id") {
      if (!Array.isArray(rule.fields) || !rule.fields.length) throw new Error(`Pack national invalide : la règle ${rule.id} ne cible aucun champ.`);
      if (!(new RegExp(rule.digits9Pattern, "u")) || !(new RegExp(rule.digits14Pattern, "u"))) throw new Error(`Pack national invalide : motif illégal dans ${rule.id}.`);
    }
    if (rule.kind === "facturx-profile") {
      const hasWarnOn = Array.isArray(rule.warnOn) && rule.warnOn.length > 0;
      const hasNoticeOn = Array.isArray(rule.noticeOn) && rule.noticeOn.length > 0;
      if (!hasWarnOn && !hasNoticeOn) throw new Error(`Pack national invalide : la règle ${rule.id} ne déclare ni warnOn ni noticeOn.`);
    }
    if (rule.kind === "cii-sublines") {
      if (!Number.isFinite(rule.tolerance) || rule.tolerance < 0) throw new Error(`Pack national invalide : tolérance numérique attendue dans ${rule.id}.`);
    }
    if (rule.kind === "structured-comms" || rule.kind === "leitweg-id") {
      if (!Array.isArray(rule.fields) || !rule.fields.length) throw new Error(`Pack national invalide : la règle ${rule.id} ne cible aucun champ.`);
      if (rule.kind === "leitweg-id" && typeof rule.trigger !== "string") throw new Error(`Pack national invalide : déclencheur (trigger) attendu dans ${rule.id}.`);
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

// Luhn — clé de contrôle des identifiants INSEE (SIREN 9 chiffres, SIRET :
// SIREN + 5 chiffres d'établissement, la validité de la partie SIREN est
// indépendante du NIC).
const luhnValid = (digits) => {
  let sum = 0;
  let double = false;
  for (let position = digits.length - 1; position >= 0; position -= 1) {
    let value = digits.charCodeAt(position) - 48;
    if (value < 0 || value > 9) return false;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
};

// Mod 97-10 (ISO/IEC 7064) sur une séquence de chiffres
const mod97Digits = (digits) => {
  let remainder = 0;
  for (const digit of digits) {
    const value = digit.charCodeAt(0) - 48;
    if (value < 0 || value > 9) return NaN;
    remainder = (remainder * 10 + value) % 97;
  }
  return remainder;
};

// Conversion alphanumérique pour Mod 97-10 : A=10 … Z=35, autres caractères ignorés
const toDigits97 = (text) => [...String(text || "").toUpperCase()]
  .map((char) => (/[0-9]/.test(char) ? char : /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : ""))
  .join("");

const makeCheck = (id, status, title, message, fix, field) => ({ id, status, title, message, fix, field });

const nationalRuleCheck = (rule, invoice) => {
  if (rule.kind === "notice") return makeCheck(rule.id, "info", rule.title, rule.message, rule.fix || "", rule.field);
  if (rule.kind === "id-format") {
    let evaluated = 0;
    let problem = false;
    for (const name of rule.fields) {
      const value = upperId(invoice?.[name]);
      if (!value || !value.startsWith(rule.prefix)) continue;
      evaluated += 1;
      if (!patternOf(rule.pattern).test(value)) problem = true;
    }
    if (!evaluated) return null; // aucun identifiant du pays visé : la règle n'a rien à dire
    return problem
      ? makeCheck(rule.id, "error", rule.title, rule.koMessage, rule.fix, rule.field)
      : makeCheck(rule.id, "pass", rule.title, rule.okMessage, "", rule.field);
  }
  if (rule.kind === "numeric-id") {
    const digits9 = patternOf(rule.digits9Pattern);
    const digits14 = patternOf(rule.digits14Pattern);
    let evaluated = 0;
    let problem = false;
    for (const name of rule.fields) {
      const raw = String(invoice?.[name] || "").trim();
      const value = upperId(raw.replace(/^[0-9]{1,4}\s*:\s*/, "")); // retirer l'éventuel préfixe de schéma (ex. 0009:)
      if (digits9.test(value)) {
        evaluated += 1;
        if (!luhnValid(value)) problem = true;
      } else if (digits14.test(value)) {
        evaluated += 1;
        if (!luhnValid(value.slice(0, 9))) problem = true;
      }
    }
    if (!evaluated) return null; // identifiant non numérique de 9 ou 14 chiffres : pas une donnée SIRET applicable
    return problem
      ? makeCheck(rule.id, "error", rule.title, rule.koMessage, rule.fix, rule.field)
      : makeCheck(rule.id, "pass", rule.title, rule.okMessage, "", rule.field);
  }
  if (rule.kind === "facturx-profile") {
    const level = String(invoice?.containerPreflight?.conformanceLevel || "").trim();
    if (!level) return null; // pas un conteneur Factur-X lu : la règle n'a rien à dire
    const upper = level.toUpperCase();
    const matchedNotice = (rule.noticeOn || []).find((prefix) => upper.startsWith(String(prefix).toUpperCase()));
    if (matchedNotice) return makeCheck(rule.id, "info", rule.title, rule.noticeMessage, rule.fix || "", rule.field);
    if (!(rule.warnOn || []).length) return null; // règle purement informative non déclenchée : silencieuse
    const matchedWarn = (rule.warnOn || []).find((prefix) => upper.startsWith(String(prefix).toUpperCase()));
    if (matchedWarn) return makeCheck(rule.id, "warning", rule.title, rule.koMessage, rule.fix, rule.field);
    return makeCheck(rule.id, "pass", rule.title, rule.okMessage.replace("{level}", level), "", rule.field);
  }
  if (rule.kind === "cii-sublines") {
    const sub = invoice?.cheminDeFer;
    if (!sub || !sub.subLineCount) return null; // chemin de fer absent : la règle n'a rien à dire
    if (sub.unknownParents) return makeCheck(rule.id, "error", rule.title, rule.orphanMessage, rule.fix, rule.field);
    if (invoice?.lineTotal == null || sub.topLineSum == null) {
      return makeCheck(rule.id, "warning", rule.title, rule.partialMessage, rule.fix, rule.field);
    }
    const delta = Math.abs(sub.topLineSum - invoice.lineTotal);
    return delta <= rule.tolerance
      ? makeCheck(rule.id, "pass", rule.title, rule.okMessage, "", rule.field)
      : makeCheck(rule.id, "error", rule.title, rule.koMessage.replace("{delta}", delta.toFixed(2)), rule.fix, rule.field);
  }
  if (rule.kind === "structured-comms") {
    const digits = String(invoice?.[rule.fields[0]] || "").replace(/\D/g, "");
    if (digits.length !== 12) return null; // pas une communication structurée : la règle n'a rien à dire
    const expected = Number(digits.slice(0, 10)) % 97 || 97;
    return Number(digits.slice(10)) === expected
      ? makeCheck(rule.id, "pass", rule.title, rule.okMessage, "", rule.field)
      : makeCheck(rule.id, "warning", rule.title, `${rule.koMessage} Clé attendue : ${expected}.`, rule.fix, rule.field);
  }
  if (rule.kind === "leitweg-id") {
    if (rule.trigger && !String(invoice?.customizationId || "").toLowerCase().includes(rule.trigger.toLowerCase())) return null; // hors XRechnung : la règle n'a rien à dire
    const raw = String(invoice?.[rule.fields[0]] || "").trim();
    if (!raw) return makeCheck(rule.id, "error", rule.title, rule.koEmptyMessage, rule.fix, rule.field);
    const parts = raw.split("-");
    const grob = parts[0] || "";
    const fine = parts.length === 3 ? parts[1] : "";
    const check = parts.at(-1) || "";
    const structureOk = parts.length >= 2 && parts.length <= 3
      && /^\d{2,12}$/.test(grob)
      && raw.length >= 5 && raw.length <= 46
      && (parts.length === 2 || /^[A-Za-z0-9]{1,30}$/.test(fine))
      && /^\d{2}$/.test(check);
    if (!structureOk) return makeCheck(rule.id, "error", rule.title, rule.koMessage, rule.fix, rule.field);
    const body = toDigits97(raw.slice(0, raw.length - 3));
    const remainder = mod97Digits(body + check);
    return remainder === 1
      ? makeCheck(rule.id, "pass", rule.title, rule.okMessage, "", rule.field)
      : makeCheck(rule.id, "error", rule.title, rule.orphanMessage, rule.fix, rule.field);
  }
  return null; // type inconnu : ignoré prudemment
};

export function nationalChecks(invoice, profile, { country, date = todayIsoDate() } = {}) {
  const normalizedCountry = String(country || profile?.country || "").trim().toUpperCase();
  const checks = [];
  for (const pack of listPacks()) {
    if (!packActive(pack, normalizedCountry, date)) continue;
    for (const rule of pack.rules) {
      const produced = nationalRuleCheck(rule, invoice);
      if (produced) checks.push(produced);
    }
  }
  return checks;
}
