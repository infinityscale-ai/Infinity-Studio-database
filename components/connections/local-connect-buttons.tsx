"use client";

import { Cloud, Laptop, type LucideIcon } from "lucide-react";
import { useLocalTools } from "@/components/connections/use-local-tools";

/** One typed-in connection type the Add Connection screen offers. */
type ConnectTypeProps = { icon: LucideIcon; title: string; hint: string; onOpen: () => void };

// ConnectType is one large button opening a typed-in connection form, styled like the Supabase account button beside it.
function ConnectType({ icon: Icon, title, hint, onOpen }: ConnectTypeProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full min-w-0 flex items-center gap-3 rounded-lg border border-studio-border/60 bg-studio-bg/60 p-3 text-left hover:border-studio-border hover:bg-studio-row-hover/80"
    >
      <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-muted/60 flex items-center justify-center">
        <Icon className="h-6 w-6 text-foreground/80" aria-hidden />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{title}</div>
        <div className="text-xs text-muted-foreground line-clamp-2">{hint}</div>
      </div>
    </button>
  );
}

// LocalConnectButtons offers the Localhost and Oracle Cloud forms; shown only where the studio serves local tools.
export function LocalConnectButtons({ onLocalhost, onOracleCloud }: { onLocalhost: () => void; onOracleCloud: () => void }) {
  const tools = useLocalTools();
  if (!tools?.enabled) return null;
  return (
    <>
      <ConnectType icon={Laptop} title="Localhost" hint="A database on this computer, no password unless it needs one" onOpen={onLocalhost} />
      <ConnectType icon={Cloud} title="Oracle Cloud" hint="MySQL HeatWave or PostgreSQL, through your cluster" onOpen={onOracleCloud} />
    </>
  );
}
