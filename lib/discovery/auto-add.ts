import { candidateConnectionString, candidateKey, engineLabel, providerOf, type DatabaseCandidate } from "./database-candidate";
import { savedForEndpoint, type SavedLike } from "./saved-match";

/** A found database the studio saves on its own, in local mode only. */
export type AutoAddition = { key: string; name: string; connectionString: string; connectionType: string };

// autoAddName names a found database the way its card does: the container, or the engine and port.
export function autoAddName(c: DatabaseCandidate): string {
  return c.container || `${engineLabel(c.engine)} on port ${c.port}`;
}

// pickAutoAdditions lists the found databases to save: not saved yet, and never added before (a deleted one stays deleted).
export function pickAutoAdditions(candidates: DatabaseCandidate[], saved: SavedLike[], addedBefore: ReadonlySet<string>): AutoAddition[] {
  return candidates
    .filter((c) => !addedBefore.has(candidateKey(c)) && !savedForEndpoint(saved, c.host, c.port))
    .map((c) => ({ key: candidateKey(c), name: autoAddName(c), connectionString: candidateConnectionString(c), connectionType: providerOf(c.engine) }));
}
