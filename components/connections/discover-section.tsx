"use client";

import { useEffect, useState } from "react";
import { DiscoverLocalPanel } from "@/components/connections/discover-local-panel";
import { DiscoverOciPanel } from "@/components/connections/discover-oci-panel";
import { localToolsEnabled } from "@/lib/api/discover-client";
import type { SavedLike } from "@/lib/discovery/saved-match";

/** What the section hands back: a string to prefill, a saved connection to open, or the news that one was saved. */
export type DiscoverSectionProps = { onPick: (connectionString: string) => void; onSaved: () => void; saved: SavedLike[]; onOpenSaved: (id: number) => void };

// DiscoverSection shows the databases found on this machine and in Oracle Cloud as connection cards; nothing on a studio that does not serve local tools.
export function DiscoverSection({ onPick, onSaved, saved, onOpenSaved }: DiscoverSectionProps) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    void localToolsEnabled().then(setEnabled);
  }, []);
  if (!enabled) return null;
  return (
    <div className="space-y-6">
      <DiscoverLocalPanel onPick={onPick} saved={saved} onOpenSaved={onOpenSaved} />
      <DiscoverOciPanel onSaved={onSaved} saved={saved} onOpenSaved={onOpenSaved} />
    </div>
  );
}
