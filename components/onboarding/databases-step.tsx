"use client";

import { DiscoverLocalPanel } from "@/components/connections/discover-local-panel";
import { PRIMARY_BTN } from "@/components/onboarding/primary-button";

// Step 4: show the databases already running on this machine; using one finishes onboarding with it, skipping finishes without.
export function DatabasesStep({ onUse, onSkip }: { onUse: (connectionString: string) => void; onSkip: () => void }) {
  return (
    <>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Databases found here</h1>
        <p className="text-muted-foreground">
          These are already running on this machine. Pick one to open it right away, or skip and add a connection later.
        </p>
      </div>
      <div className="max-h-[40vh] overflow-y-auto pr-1">
        <DiscoverLocalPanel onPick={onUse} columns={1} />
      </div>
      <button type="button" onClick={onSkip} className={PRIMARY_BTN}>
        Skip for now
      </button>
    </>
  );
}
