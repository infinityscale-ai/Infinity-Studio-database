"use client";

import { describeEmbedEnd, type EmbedEndReason } from "@/lib/embed/claim";

// Tells the person the embedded session is over and where the way back in is: their console, not this page.
export function EmbedExpired({ reason }: { reason: EmbedEndReason }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
      <div role="alert" className="flex w-full max-w-sm flex-col items-start gap-2">
        <h1 className="text-base font-semibold">This session has ended.</h1>
        <p className="text-sm text-muted-foreground">{describeEmbedEnd(reason)}</p>
        <p className="text-sm text-muted-foreground">Reopen the database from your console.</p>
      </div>
    </main>
  );
}
