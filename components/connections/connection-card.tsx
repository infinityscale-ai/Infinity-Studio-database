"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { getProviderLogoUrl } from "@/components/shared/provider-logo";
import { cn } from "@/lib/utils";

/** The one surface every connection card shares, saved or found. */
export const CONNECTION_CARD_CLASS = "group relative rounded-lg border border-studio-border/60 bg-card p-4 text-left transition-colors hover:border-studio-border hover:bg-studio-row-hover";

/** What the top row of a card shows: the provider mark, the name and the provider, plus anything on the right. */
export type ConnectionCardHeaderProps = {
  logo: ReactNode;
  title: string;
  subtitle?: string;
  badges?: ReactNode;
  actions?: ReactNode;
};

// ProviderMark is the 27 px provider logo every card leads with.
export function ProviderMark({ provider, label }: { provider: string; label: string }) {
  return <Image src={getProviderLogoUrl(provider)} alt={label} width={27} height={27} className="rounded-lg object-contain" />;
}

// CardBadge is a small neutral tag beside a card's name: where it lives, or that it is already saved.
export function CardBadge({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded border border-studio-border bg-muted/60 px-1.5 py-px text-[11px] font-medium text-muted-foreground">{children}</span>;
}

// ConnectionCardHeader lays out a card's top row the same way for every connection.
export function ConnectionCardHeader({ logo, title, subtitle, badges, actions }: ConnectionCardHeaderProps) {
  return (
    <div className="mb-3 flex items-start justify-between gap-2">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative shrink-0">{logo}</div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-medium text-foreground">{title}</h3>
            {badges}
          </div>
          {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      {actions}
    </div>
  );
}

/** A whole card that is one control: found databases, which have nothing else to click inside. */
export type ConnectionCardButtonProps = ConnectionCardHeaderProps & {
  footer: ReactNode;
  onActivate: () => void;
  disabled?: boolean;
  ariaLabel: string;
};

// ConnectionCardButton renders a card as a single keyboard-reachable button.
export function ConnectionCardButton({ footer, onActivate, disabled, ariaLabel, ...header }: ConnectionCardButtonProps) {
  return (
    <button
      type="button"
      onClick={onActivate}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(CONNECTION_CARD_CLASS, "w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", disabled && "cursor-not-allowed opacity-60 hover:border-studio-border/60 hover:bg-card")}
    >
      <ConnectionCardHeader {...header} />
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">{footer}</div>
    </button>
  );
}
