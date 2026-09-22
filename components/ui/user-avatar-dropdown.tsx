"use client";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronsUpDown, Settings } from "@/lib/icon-theme/lucide-react";
import type { ReactNode } from "react";

interface UserAvatarDropdownProps {
  displayName: string;
  onOpenSettings?: () => void;
  sleekLayout?: boolean;
  children?: ReactNode;
}

// Header avatar button that opens the local user's menu: name, caller-provided items, then Settings.
export function UserAvatarDropdown({
  displayName,
  onOpenSettings,
  sleekLayout,
  children,
}: UserAvatarDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 px-2 text-xs font-normal border border-studio-border rounded-lg bg-background/15 hover:bg-background/25 transition-colors no-drag",
            sleekLayout ? "h-8" : "h-9",
          )}
        >
          <div className="w-5 h-5 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <span className="max-w-[100px] truncate">{displayName}</span>
          <ChevronsUpDown className="w-3 h-3 text-muted-foreground/40" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 bg-popover border-studio-border [.tui-mode_&]:border"
      >
        <DropdownMenuLabel>
          <p className="text-sm font-medium">{displayName}</p>
        </DropdownMenuLabel>
        {children}
        <DropdownMenuSeparator className="bg-studio-border" />
        <DropdownMenuItem
          onClick={onOpenSettings ?? (() => {})}
          className="gap-2 text-xs cursor-pointer"
        >
          <Settings className="w-3.5 h-3.5" />
          Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
