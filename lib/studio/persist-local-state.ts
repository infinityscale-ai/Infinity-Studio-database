export function persistLocalState(
  connectionId: number,
  entries: Record<string, string | null>,
) {
  if (typeof window === "undefined" || !window.localStorage) return;
  const restoreKey = "infinity-studio-restore-state-" + connectionId;
  const shouldRestore = window.localStorage.getItem(restoreKey) !== "0";
  for (const [key, value] of Object.entries(entries)) {
    if (shouldRestore && value !== null) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  }
}
