"use client";

import { Skeleton } from "@/components/ui/skeleton";

// Holds the studio's footprint (rail, sidebar, content card) while the session is being claimed, so nothing jumps.
export function EmbedSkeleton() {
  return (
    <div role="status" aria-busy className="flex h-svh w-full bg-sidebar p-2 gap-2">
      <span className="sr-only">Opening the studio…</span>
      <div className="flex w-10 shrink-0 flex-col items-center gap-3 pt-8">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="size-6 rounded-md" />
        ))}
      </div>
      <div className="hidden w-56 shrink-0 flex-col gap-2 rounded-lg border border-border p-2 md:flex">
        <Skeleton className="h-7 w-full" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-5 w-3/4" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg border border-border p-2">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="min-h-0 flex-1" />
      </div>
    </div>
  );
}
