"use client";

import { Loader2 } from "@/lib/icon-theme/lucide-react";
import { cn } from "@/lib/utils";

/** How many columns and rows the placeholder draws: enough to fill a screen without a scrollbar. */
const COLUMNS = 7;
const ROWS = 18;
/** Column widths, so the placeholder looks like a table with real columns rather than equal stripes. */
const COLUMN_WIDTHS = ["w-16", "w-36", "w-28", "w-40", "w-24", "w-32", "w-20"];

// Bar is one grey placeholder line that pulses while the table loads.
function Bar({ className }: { className?: string }) {
  return <div className={cn("h-3 animate-pulse rounded bg-muted", className)} />;
}

// GridLoadingSkeleton is the table drawn in grey while its rows arrive, shaped like the grid so nothing jumps when it lands.
export function GridLoadingSkeleton({ tableName }: { tableName?: string | null }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden" role="status" aria-busy="true">
      <span className="sr-only">{tableName ? `Loading table ${tableName}` : "Loading table"}</span>
      <div className="flex h-10 shrink-0 items-center border-b border-border bg-table-header-bg">
        <div className="flex w-10 shrink-0 justify-center"><Bar className="w-4" /></div>
        {COLUMN_WIDTHS.slice(0, COLUMNS).map((width, i) => (
          <div key={i} className="flex h-full w-44 shrink-0 items-center gap-2 border-l border-border px-3">
            <Bar className="w-3 opacity-70" />
            <Bar className={cn(width, "max-w-[7rem]")} />
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {Array.from({ length: ROWS }).map((_, row) => (
          <div key={row} className="flex h-9 items-center border-b border-border/60" style={{ opacity: 1 - row * 0.045 }}>
            <div className="flex w-10 shrink-0 justify-center"><Bar className="w-4 opacity-60" /></div>
            {COLUMN_WIDTHS.slice(0, COLUMNS).map((width, i) => (
              <div key={i} className="flex h-full w-44 shrink-0 items-center px-3">
                <Bar className={cn((row + i) % 3 === 0 ? "w-12" : width, "max-w-[9rem]")} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex h-11 shrink-0 items-center justify-between border-t border-border px-4">
        <span className="flex items-center gap-2 text-xs text-muted-foreground" aria-hidden>
          <Loader2 className="size-3.5 animate-spin" />
          {tableName ? `Loading ${tableName}…` : "Loading table…"}
        </span>
        <Bar className="w-20" />
      </div>
    </div>
  );
}
