"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CONNECTION_CARD_CLASS } from "@/components/connections/connection-card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** How many cards sit side by side: two in the add-connection screen, one in the narrow first-run step. */
export type FoundColumns = 1 | 2;

/** A titled group of found databases: its header, its controls on the right, and its cards or state. */
export type FoundGroupProps = { icon: LucideIcon; title: string; controls?: ReactNode; children: ReactNode };

// foundGridClass lays found cards out like the saved list, fitted to the width they get.
export function foundGridClass(columns: FoundColumns): string {
  return cn("grid grid-cols-1 gap-3", columns === 2 && "sm:grid-cols-2");
}

// FoundGroup is one titled section of found databases.
export function FoundGroup({ icon: Icon, title, controls, children }: FoundGroupProps) {
  return (
    <section className="space-y-2" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Icon className="size-4 text-muted-foreground" aria-hidden /> {title}
        </h3>
        {controls ? <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{controls}</div> : null}
      </div>
      {children}
    </section>
  );
}

// FoundSkeleton holds the place of the cards that are still being found, at their real size.
export function FoundSkeleton({ columns, label }: { columns: FoundColumns; label: string }) {
  return (
    <div role="status" aria-busy className={foundGridClass(columns)}>
      <span className="sr-only">{label}</span>
      {[0, 1].map((i) => (
        <div key={i} className={cn(CONNECTION_CARD_CLASS, "space-y-3 hover:bg-card")}>
          <div className="flex items-center gap-3">
            <Skeleton className="size-[27px] rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

// FoundNotice is a group's empty or error line, in words, with its one next step.
export function FoundNotice({ tone = "muted", children, action }: { tone?: "muted" | "error"; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-studio-border/60 px-4 py-5 text-center text-sm">
      <p className={tone === "error" ? "text-destructive" : "text-muted-foreground"}>{children}</p>
      {action}
    </div>
  );
}
