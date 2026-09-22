"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Code,
  Palette,
} from "@/lib/icon-theme/lucide-react";
import type { CustomAppTheme } from "@/lib/studio/app-themes";
import type { CustomEditorTheme } from "@/lib/studio/editor-themes";
import { MarketplaceExtensionList } from "@/components/studio/marketplace-extension-list";

interface ThemesSectionProps {
  customAppThemes: CustomAppTheme[];
  setCustomAppThemes: Dispatch<SetStateAction<CustomAppTheme[]>>;
  appThemeId: string;
  setAppThemeId: (id: string) => void;
  customEditorThemes: CustomEditorTheme[];
  setCustomEditorThemes: Dispatch<SetStateAction<CustomEditorTheme[]>>;
  onOpenEditorThemeDialog: () => void;
  onOpenThemeCreator?: () => void;
  onOpenIconThemeCreator?: () => void;
}

export function ThemesSection({
  setCustomAppThemes,
  appThemeId,
  setAppThemeId,
  customAppThemes,
  customEditorThemes,
  setCustomEditorThemes,
  onOpenEditorThemeDialog,
  onOpenThemeCreator,
  onOpenIconThemeCreator,
}: ThemesSectionProps) {
  const handleInstall = useCallback((themeName: string) => {
    const theme = customAppThemes.find((t) => t.name === themeName + " (App)");
    if (theme) setAppThemeId(theme.id);
  }, [customAppThemes, setAppThemeId]);

  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Themes</h2>
          <p className="text-xs text-muted-foreground">
            Browse and install themes from the VS Code Marketplace.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="h-8 px-3 text-xs gap-1.5 shrink-0">
              <Plus className="w-3.5 h-3.5" />
              Add Theme
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 bg-popover border-border">
            {onOpenThemeCreator && (
              <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={onOpenThemeCreator}>
                <Palette className="w-3.5 h-3.5" />
                Custom App Theme
              </DropdownMenuItem>
            )}
            {onOpenIconThemeCreator && (
              <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={onOpenIconThemeCreator}>
                <Palette className="w-3.5 h-3.5" />
                Visual Icon Theme
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={onOpenEditorThemeDialog}>
              <Code className="w-3.5 h-3.5" />
              Custom Editor Theme
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Marketplace */}
      <div className="border border-studio-border rounded-lg overflow-hidden bg-popover">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-studio-border/40 bg-muted/20">
          <Palette className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">VS Code Marketplace</span>
        </div>
        <div className="p-3 max-h-[500px] overflow-y-auto">
          <MarketplaceExtensionList
            customAppThemes={customAppThemes}
            setCustomAppThemes={setCustomAppThemes}
            customEditorThemes={customEditorThemes}
            setCustomEditorThemes={setCustomEditorThemes}
            autoLoad
            onInstall={handleInstall}
          />
        </div>
      </div>

    </section>
  );
}
