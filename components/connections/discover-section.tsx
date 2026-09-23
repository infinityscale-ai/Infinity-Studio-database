"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Cloud, Laptop } from "lucide-react";
import { DiscoverLocalPanel } from "@/components/connections/discover-local-panel";
import { DiscoverOciPanel } from "@/components/connections/discover-oci-panel";
import { localToolsEnabled } from "@/lib/api/discover-client";

/** What the section hands back: a string to prefill, or the news that a connection was saved. */
export type DiscoverSectionProps = { onPick: (connectionString: string) => void; onSaved: () => void };

// SectionTitle labels one part of the section with its icon.
function SectionTitle({ icon: Icon, children }: { icon: typeof Laptop; children: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      {children}
    </div>
  );
}

// DiscoverSection lists the databases already running on this machine and, on request, the ones in Oracle Cloud; it renders nothing on a studio that does not serve local tools.
export function DiscoverSection({ onPick, onSaved }: DiscoverSectionProps) {
  const [ociOpen, setOciOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    void localToolsEnabled().then(setEnabled);
  }, []);
  if (!enabled) return null;
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <SectionTitle icon={Laptop}>Found on this machine</SectionTitle>
        <DiscoverLocalPanel onPick={onPick} />
      </section>
      <section className="space-y-2">
        <button
          type="button"
          onClick={() => setOciOpen((o) => !o)}
          aria-expanded={ociOpen}
          className="flex w-full items-center justify-between rounded-lg border border-studio-border/60 bg-studio-bg/60 px-3 py-2 text-left hover:border-studio-border hover:bg-studio-row-hover/80"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <Cloud className="size-4 text-muted-foreground" aria-hidden /> Oracle Cloud databases
          </span>
          <ChevronDown className={`size-4 text-muted-foreground transition-transform ${ociOpen ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {ociOpen && (
          <div className="rounded-lg border border-studio-border/60 p-3">
            <DiscoverOciPanel onSaved={onSaved} />
          </div>
        )}
      </section>
    </div>
  );
}
