const SVRL_NS = "http://purl.oclc.org/dsdl/svrl";

const normalizeMessage = (value) => String(value || "").replace(/\s+/g, " ").trim();

export function parseSvrl(serialized, label, prefix, Parser = globalThis.DOMParser) {
  if (typeof Parser !== "function") throw new Error(`Le parseur XML requis pour ${label} est indisponible.`);
  const report = new Parser().parseFromString(String(serialized || ""), "application/xml");
  const parserErrors = report.getElementsByTagNameNS?.("*", "parsererror") || [];
  if (parserErrors.length) throw new Error(`Le rapport ${label} est illisible.`);
  if (report.documentElement?.namespaceURI !== SVRL_NS || report.documentElement?.localName !== "schematron-output") throw new Error(`Le rapport ${label} n'est pas un rapport SVRL.`);
  const firedRules = report.getElementsByTagNameNS(SVRL_NS, "fired-rule").length;
  if (!firedRules) throw new Error(`Aucune règle ${label} n'a été exécutée : ce rapport ne prouve pas une validation.`);
  const failures = [...report.getElementsByTagNameNS(SVRL_NS, "failed-assert")];
  const checks = failures.slice(0, 24).map((failure, index) => {
    const reference = failure.getAttribute("id") || `${prefix}-${index + 1}`;
    const flag = `${failure.getAttribute("flag") || ""} ${failure.getAttribute("role") || ""}`.toLowerCase();
    const warning = flag.includes("warning") || flag.includes("warn");
    const message = normalizeMessage(failure.getElementsByTagNameNS(SVRL_NS, "text")[0]?.textContent) || "Une règle officielle n’est pas respectée.";
    return {
      id: `${prefix}-${reference}-${index}`,
      status: warning ? "warning" : "error",
      title: `${label} · ${reference}`,
      message,
      fix: "Corrigez le champ concerné dans le logiciel émetteur, puis relancez le contrôle.",
      field: reference
    };
  });

  if (failures.length > checks.length) {
    checks.push({
      id: `${prefix}-more`, status: "error", title: `${failures.length - checks.length} autres règles non respectées`,
      message: "Le rapport est volontairement condensé pour rester lisible.",
      fix: "Téléchargez le rapport SettleMesh ou corrigez les premières anomalies avant de relancer le contrôle.", field: label
    });
  }

  if (!checks.length) {
    checks.push({
      id: `${prefix}-valid`, status: "pass", title: `${label} validé`,
      message: "Aucune assertion bloquante n’a été trouvée par l’artefact officiel.", fix: "", field: label
    });
  }
  return { failures: failures.length, firedRules, checks };
}
