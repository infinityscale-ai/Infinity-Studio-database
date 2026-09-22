"use client";

import { cn } from "@/lib/utils";
import { CommandSearchBar } from "@/components/ui/command-search-bar";
import { UpdateHeaderBadge } from "@/components/providers/update-header-badge";
import { UserAvatarDropdown } from "@/components/ui/user-avatar-dropdown";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Settings,
  BarChart3,
  Activity,
  ArrowLeft,
  User as UserIcon,
} from "@/lib/icon-theme/lucide-react";
import { useGlobalStudioSettings } from "@/hooks/use-global-studio-settings";
import { useDesktopWindow } from "@/hooks/use-desktop-window";
import { SupabaseLogo } from "@/components/shared/provider-logo";
import {
  EditProfileModal,
  useLocalProfileEditor,
} from "@/components/edit-profile-modal";
import { WindowControls } from "@/components/shared/window-controls";
import { HeaderIconButton } from "@/components/shared/header-icon-button";

interface ConnectionsHeaderProps {
  displayName?: string;
  showBackButton?: boolean;
  onBack?: () => void;
  onCommandSearchClick?: () => void;
  showAnalyticsToggle?: boolean;
  isAnalyticsEnabled?: boolean;
  onAnalyticsToggle?: (enabled: boolean) => void;
  showActivityButton?: boolean;
  activityActive?: boolean;
  onActivityClick?: () => void;
  settingsActive?: boolean;
  onSettingsClick?: () => void;
  supabaseActive?: boolean;
  onSupabaseClick?: () => void;
}

// Top bar of the connections screen: local profile menu, command search, provider and settings buttons.
export function ConnectionsHeader({
  displayName: externalDisplayName,
  showBackButton,
  onBack,
  onCommandSearchClick,
  showAnalyticsToggle,
  isAnalyticsEnabled,
  onAnalyticsToggle,
  showActivityButton,
  activityActive,
  onActivityClick,
  settingsActive,
  onSettingsClick,
  supabaseActive,
  onSupabaseClick,
}: ConnectionsHeaderProps) {
  const { sleekLayout, hideWindowActions } = useGlobalStudioSettings();
  const { isMaximized, sendWindowAction, canUseDesktop, isMac, isLinuxCloseOnly } = useDesktopWindow();
  const editor = useLocalProfileEditor({ name: externalDisplayName });
  const displayName = externalDisplayName || editor.profile.fullName;

  const avatarMenu = (
    <UserAvatarDropdown
      displayName={displayName}
      onOpenSettings={onSettingsClick}
      sleekLayout={sleekLayout}
    >
      <DropdownMenuSeparator className="bg-studio-border" />
      <DropdownMenuItem
        onClick={() => editor.setOpen(true)}
        className="gap-2 text-xs cursor-pointer"
      >
        <UserIcon className="w-3.5 h-3.5" />
        Edit profile
      </DropdownMenuItem>
    </UserAvatarDropdown>
  );

  return (
    <>
      <header
        className={cn(
          "app-drag-region flex items-center justify-between px-4 shrink-0 z-20 bg-studio-header-bg/90 backdrop-blur-xl transition-all duration-300",
          "h-14 border-b border-studio-border",
        )}
        data-tauri-drag-region="deep"
      >
        <div className="flex items-center gap-2 w-1/3">
          {isMac && <div className="w-[72px] shrink-0" />}
          {!isMac && avatarMenu}
          {showBackButton && onBack && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "gap-1 text-muted-foreground hover:text-foreground",
                sleekLayout ? "h-8 text-xs" : "h-9",
              )}
              onClick={onBack}
            >
              <ArrowLeft className={sleekLayout ? "w-3.5 h-3.5" : "w-4 h-4"} />
              Back
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CommandSearchBar
            sleekLayout={sleekLayout}
            noDrag
            onClick={onCommandSearchClick}
          />
          <UpdateHeaderBadge variant="command" sleekLayout={sleekLayout} />
        </div>
        <div className="flex items-center justify-end gap-3 w-1/3">
          {showAnalyticsToggle && onAnalyticsToggle && (
            <HeaderIconButton
              icon={BarChart3}
              onClick={() => onAnalyticsToggle(!isAnalyticsEnabled)}
              title={isAnalyticsEnabled ? "Analytics on" : "Analytics off"}
              active={isAnalyticsEnabled}
              sleekLayout={sleekLayout}
              native={!isMac}
            />
          )}
          {showActivityButton && (
            <HeaderIconButton
              icon={Activity}
              onClick={onActivityClick || (() => {})}
              title={activityActive ? "Hide activity overview" : "Show activity overview"}
              active={activityActive}
              sleekLayout={sleekLayout}
              native={!isMac}
            />
          )}
          <button
            type="button"
            onClick={onSupabaseClick ?? (() => {})}
            title={supabaseActive ? "Close Supabase" : "Supabase accounts"}
            aria-label={supabaseActive ? "Close Supabase" : "Supabase accounts"}
            className={cn(
              "flex items-center justify-center transition-colors no-drag",
              !isMac
                ? "h-8 w-8 hover:bg-studio-border/50"
                : "border border-studio-border rounded-lg bg-background/15 hover:bg-background/25",
              !isMac ? "rounded" : sleekLayout ? "h-8 w-8" : "h-9 w-9",
            )}
          >
            <SupabaseLogo
              className={cn(
                sleekLayout ? "w-3.5 h-3.5" : "w-4 h-4",
                supabaseActive ? "" : "opacity-60",
              )}
            />
          </button>
          <HeaderIconButton
            icon={Settings}
            onClick={onSettingsClick || (() => {})}
            title={settingsActive ? "Close settings" : "Settings"}
            active={settingsActive}
            sleekLayout={sleekLayout}
            native={!isMac}
          />
          {isMac && avatarMenu}

          {canUseDesktop && !isMac && (!hideWindowActions || isLinuxCloseOnly) && (
            <WindowControls
              isMaximized={isMaximized}
              onMinimize={() => sendWindowAction("minimize")}
              onMaximizeToggle={() => sendWindowAction("maximize-toggle")}
              onClose={() => sendWindowAction("close")}
              wayland={isLinuxCloseOnly}
            />
          )}
        </div>
      </header>
      <EditProfileModal
        open={editor.open}
        onOpenChange={editor.setOpen}
        profile={editor.profile}
        onSave={editor.save}
      />
    </>
  );
}
