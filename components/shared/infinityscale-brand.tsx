"use client";

import { useEffect, useState } from "react";
import { INFINITYSCALE_URL } from "@/lib/constants";
import { isEmbedMode } from "@/lib/embed/session";
import { cn } from "@/lib/utils";

/** Where the mark sits: with its name, or icon-only in a tight bar. */
type BrandProps = { className?: string; compact?: boolean };

// InfinityScaleBrand is the maker's mark at the top of the studio; it opens the website and hides when embedded in the console.
export function InfinityScaleBrand({ className, compact = false }: BrandProps) {
  const [embedded, setEmbedded] = useState(true);
  useEffect(() => setEmbedded(isEmbedMode()), []);
  if (embedded) return null;
  return (
    <a
      href={INFINITYSCALE_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="InfinityScale — open the website"
      className={cn(
        "no-drag inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors",
        "hover:bg-studio-row-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <img src="/infinityscale-logo.png" alt="" aria-hidden width={16} height={16} className="size-4 shrink-0 rounded-[3px]" />
      <span className={compact ? "sr-only" : undefined}>InfinityScale</span>
    </a>
  );
}
