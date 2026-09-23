"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { InfinityScaleBrand } from "@/components/shared/infinityscale-brand";
import { isEmbedMode } from "@/lib/embed/session";

/** Where the return control goes when the shell gives it no home of its own: the connections page. */
const CONNECTIONS_PATH = "/";

// StudioReturn is the studio title bar's left corner: the InfinityScale mark with its name, and the way back to Connections.
export function StudioReturn({ onHome }: { onHome?: () => void }) {
  const router = useRouter();
  const [embedded, setEmbedded] = useState(true);
  useEffect(() => setEmbedded(isEmbedMode()), []);
  if (embedded) return null;
  return (
    <div className="flex items-center gap-1">
      <InfinityScaleBrand />
      <span className="h-4 w-px bg-studio-border" aria-hidden />
      <button
        type="button"
        onClick={() => (onHome ? onHome() : router.push(CONNECTIONS_PATH))}
        title="Back to Connections"
        className="no-drag inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-studio-row-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Connections
      </button>
    </div>
  );
}
