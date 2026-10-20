"use client";

import { useEffect, useRef } from "react";
import { discoverLocal, localToolsEnabled, saveConnection } from "@/lib/api/discover-client";
import { pickAutoAdditions } from "@/lib/discovery/auto-add";
import type { SavedLike } from "@/lib/discovery/saved-match";

/** Where this browser remembers the endpoints it already added, so a connection the user deleted is not added back. */
const ADDED_KEY = "infstudio.autoAddedLocal";

// readAdded loads the endpoints added before; an unreadable store counts as none.
function readAdded(): Set<string> {
  try {
    const raw = window.localStorage.getItem(ADDED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

// writeAdded stores the endpoints added so far; failing to write only means the next scan may offer them again.
function writeAdded(keys: Iterable<string>): void {
  try {
    window.localStorage.setItem(ADDED_KEY, JSON.stringify([...new Set(keys)]));
  } catch {
    // Storage blocked: nothing to keep, and nothing breaks.
  }
}

// addLocalDatabases scans this machine and saves every database not saved or added before, returning how many it saved.
async function addLocalDatabases(saved: SavedLike[]): Promise<number> {
  if (!(await localToolsEnabled())) return 0;
  const candidates = (await discoverLocal()).candidates;
  const added = readAdded();
  const additions = pickAutoAdditions(candidates, saved, added);
  // Claimed before saving, so a second tab or reload scanning at the same time does not add them twice.
  writeAdded([...added, ...additions.map((a) => a.key)]);
  const done: string[] = [];
  for (const a of additions) {
    await saveConnection({ name: a.name, connectionString: a.connectionString, connectionType: a.connectionType }).then(() => done.push(a.key), () => undefined);
  }
  writeAdded([...readAdded()].filter((k) => added.has(k) || done.includes(k) || !additions.some((a) => a.key === k)));
  return done.length;
}

// useAutoAddLocal saves the databases running on this machine once the saved list has loaded, then reloads it; local mode only.
export function useAutoAddLocal(saved: SavedLike[], loading: boolean, reload: () => Promise<void> | void): void {
  const ran = useRef(false);
  useEffect(() => {
    if (loading || ran.current) return;
    ran.current = true;
    void addLocalDatabases(saved)
      .then((count) => (count > 0 ? reload() : undefined))
      .catch(() => undefined);
  }, [loading, saved, reload]);
}
