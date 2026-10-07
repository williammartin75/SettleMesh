export const STORAGE_KEY = "settlemesh-v1";
export const LEGACY_STORAGE_KEYS = Object.freeze(["eurule-checklink-v1"]);

export function readPersistedState(storage) {
  for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
    try {
      const raw = storage?.getItem?.(key);
      if (!raw) continue;
      return { value: JSON.parse(raw), sourceKey: key, migrated: key !== STORAGE_KEY };
    } catch {
      // Une entrée illisible ne doit pas masquer une ancienne sauvegarde valide.
    }
  }
  return { value: null, sourceKey: "", migrated: false };
}

export function writePersistedState(storage, value) {
  storage?.setItem?.(STORAGE_KEY, JSON.stringify(value));
}
