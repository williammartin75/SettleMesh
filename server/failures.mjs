// Traqueur d'échecs de connexion (verrouillage progressif) : pure logique
// testable. N échecs dans la fenêtre → verrou jusqu'à expiration de la
// la fenêtre ; en mémoire par processus, borné à 10 000 entrées, purge des
// entrées expirées. Jamais écrit dans le registre managé ni télémétrie.

const MAX_TRACKED = 10_000;

export function createFailureTracker({ limit = 5, windowMs = 600_000 } = {}) {
  const entries = new Map();
  const prune = (now) => {
    if (entries.size <= MAX_TRACKED) return;
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }
  };
  return {
    attempt(key) {
      const now = Date.now();
      prune(now);
      const current = entries.get(key);
      if (!current || current.resetAt <= now) {
        entries.set(key, { count: 1, resetAt: now + windowMs });
        return { blocked: false, remaining: limit - 1, resetAt: now + windowMs };
      }
      current.count += 1;
      entries.set(key, current);
      const blocked = false; // information seulement : le verrou est évalué par blocked() à l'entrée
      return { blocked, remaining: Math.max(0, limit - current.count), resetAt: current.resetAt };
    },
    blocked(key) {
      const current = entries.get(key);
      return Boolean(current && current.resetAt > Date.now() && current.count >= limit);
    },
    secondsLeft(key) {
      const current = entries.get(key);
      if (!current || current.resetAt <= Date.now()) return 0;
      return Math.ceil((current.resetAt - Date.now()) / 1000);
    },
    reset(key) {
      entries.delete(key);
    },
    size: () => entries.size
  };
}
