"use client";

import { DiscoverLocalPanel } from "@/components/connections/discover-local-panel";
import { useLocalTools } from "@/components/connections/use-local-tools";
import type { SavedLike } from "@/lib/discovery/saved-match";

/** What the section hands back: a string to prefill, or a saved connection to open. */
export type DiscoverSectionProps = { onPick: (connectionString: string) => void; saved: SavedLike[]; onOpenSaved: (id: number) => void };

// DiscoverSection shows the databases found on this machine as connection cards; nothing on a studio that does not serve local tools.
export function DiscoverSection({ onPick, saved, onOpenSaved }: DiscoverSectionProps) {
  const tools = useLocalTools();
  if (!tools?.enabled) return null;
  return <DiscoverLocalPanel onPick={onPick} saved={saved} onOpenSaved={onOpenSaved} />;
}
