"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Eye,
  GripVertical,
  Check,
  Globe,
  Upload,
  Code,
  ArrowRight,
  Search,
  SearchX,
} from "@/lib/icon-theme/lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  createThemeId,
  parseThemeJson,
  type CustomEditorTheme,
} from "@/lib/studio/editor-themes";
import {
  BUILTIN_APP_THEMES,
  type CustomAppTheme,
} from "@/lib/studio/app-themes";
import { BUILTIN_EDITOR_THEMES } from "@/lib/studio/themes/theme-catalog";
import { hasHostTheme } from "@/lib/embed/host-theme";
import { AiSettingsSection } from "@/components/studio/ai/ai-settings-section";
import { AiProvidersPage } from "@/components/studio/ai/ai-providers-page";
import { IconThemeSetting } from "@/components/studio/settings/icon-theme-setting";
import { CustomFontSetting } from "@/components/studio/settings/custom-font-setting";
import { ThemesSection } from "@/components/studio/settings/themes-section";
import { SqlEditorEngineSetting } from "@/components/studio/settings/sql-editor-engine-setting";
import { ZoomSetting } from "@/components/studio/settings/zoom-setting";
import {
  SettingsSidebar,
  isSettingsSectionAvailable,
  type SettingsSectionId,
} from "@/components/studio/settings/settings-sidebar";
import {
  SETTINGS_SECTION_LABELS,
  filterSettingsSearch,
  type SettingsSearchEntry,
} from "@/components/studio/settings/settings-search";
import type { SqlEditorEngine } from "@/lib/studio/types";
import type { CustomIconTheme } from "@/lib/icon-theme/types";
import { useAppUpdate } from "@/hooks/use-app-update";
import { pickCommonSettings } from "@/lib/studio/settings-common";
import { KeybindingsPanel } from "@/components/studio/keybindings-view";
import { McpSettingsSection } from "@/components/studio/settings/mcp-settings-section";

function AddThemeMenu({
  onBrowseThemes,
  onCustomTheme,
  icon: Icon,
}: {
  onBrowseThemes: () => void;
  onCustomTheme?: () => void;
  icon: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className="h-7 px-2.5 text-xs">
          Add Theme
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48 bg-popover border-border"
      >
        <DropdownMenuItem
          className="text-xs gap-2 cursor-pointer"
          onClick={onBrowseThemes}
        >
          <Globe className="w-3.5 h-3.5" />
          Browse Themes
        </DropdownMenuItem>
        {onCustomTheme ? (
          <DropdownMenuItem
            className="text-xs gap-2 cursor-pointer"
            onClick={onCustomTheme}
          >
            {Icon}
            Custom Theme
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ThemeDialogConfig {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  nameValue: string;
  onNameChange: (value: string) => void;
  jsonValue: string;
  onJsonChange: (value: string) => void;
  jsonPlaceholder: string;
  fileName: string | null;
  onFileUpload: (file: File | null) => void;
  onCancel: () => void;
  onAdd: () => void;
  dialogPos: { x: number; y: number };
  onDialogHeaderMouseDown: (e: React.MouseEvent) => void;
}

function ThemeAddDialog(cfg: ThemeDialogConfig) {
  return (
    <Dialog open={cfg.open} onOpenChange={cfg.onOpenChange} modal={false}>
      <DialogContent
        className="max-w-2xl max-h-[80vh]"
        overlayClassName="!bg-transparent !backdrop-blur-none pointer-events-none"
        style={{
          top: cfg.dialogPos.y,
          left: cfg.dialogPos.x,
          transform: "none",
        }}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader
          onMouseDown={cfg.onDialogHeaderMouseDown}
          className="cursor-grab active:cursor-grabbing select-none"
        >
          <DialogTitle>{cfg.title}</DialogTitle>
          <DialogDescription>{cfg.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground">
              Theme Name
            </label>
            <Input
              value={cfg.nameValue}
              onChange={(e) => cfg.onNameChange(e.target.value)}
              placeholder="My Custom Theme"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground">
              Theme JSON
            </label>
            <Textarea
              value={cfg.jsonValue}
              onChange={(e) => cfg.onJsonChange(e.target.value)}
              placeholder={cfg.jsonPlaceholder}
              className="min-h-[200px] max-h-[300px] font-mono text-xs"
            />
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs text-muted-foreground">
                {cfg.fileName
                  ? `Loaded: ${cfg.fileName}`
                  : "Upload a .json theme file"}
              </label>
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => cfg.onFileUpload(e.target.files?.[0] || null)}
                className="text-xs text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-secondary/60 file:px-3 file:py-1 file:text-xs file:font-medium file:text-foreground"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={cfg.onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={cfg.onAdd}>
            Add Theme
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ThemeSelectSection({
  value,
  onValueChange,
  builtInThemes,
  customThemes,
  onCustomTheme,
  onBrowseThemes,
  icon,
}: {
  value: string;
  onValueChange: (v: string) => void;
  builtInThemes: Array<{ id: string; label: string }>;
  customThemes: Array<{ id: string; name: string }>;
  onCustomTheme?: () => void;
  onBrowseThemes: () => void;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-8 w-48 bg-secondary/50 border-border text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-popover border-border">
          {builtInThemes.map((theme) => (
            <SelectItem key={theme.id} value={theme.id}>
              {theme.label}
            </SelectItem>
          ))}
          {customThemes.length > 0 ? (
            <div className="px-2 py-1 text-xstracking-wide text-muted-foreground">
              Custom
            </div>
          ) : null}
          {customThemes.map((theme) => (
            <SelectItem key={theme.id} value={theme.id}>
              {theme.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <AddThemeMenu
        onBrowseThemes={onBrowseThemes}
        onCustomTheme={onCustomTheme}
        icon={icon}
      />
    </div>
  );
}

interface CommandMenuSection {
  id: string;
  name: string;
  isVisible: boolean;
}

interface StudioSettingsModel {
  appZoom: number;
  setAppZoom: (value: number) => void;
  executionMode: "direct" | "review";
  setExecutionMode: (value: "direct" | "review") => void;
  rowSpacing: "compact" | "standard" | "relaxed";
  setRowSpacing: (value: "compact" | "standard" | "relaxed") => void;
  alternatingRowColors: boolean;
  setAlternatingRowColors: (value: boolean) => void;
  editorFontSize: string;
  setEditorFontSize: (value: string) => void;
  editorFontFamily: string;
  setEditorFontFamily: (value: string) => void;
  sqlEditorEngine: SqlEditorEngine;
  setSqlEditorEngine: (value: SqlEditorEngine) => void;
  editorThemeId: string;
  setEditorThemeId: (value: string) => void;
  customEditorThemes: CustomEditorTheme[];
  setCustomEditorThemes: Dispatch<SetStateAction<CustomEditorTheme[]>>;
  appThemeId: string;
  setAppThemeId: (value: string) => void;
  customAppThemes: CustomAppTheme[];
  setCustomAppThemes: Dispatch<SetStateAction<CustomAppTheme[]>>;
  customFontFamily: string;
  setCustomFontFamily: (value: string) => void;
  iconThemeId: string;
  setIconThemeId: (value: string) => void;
  customIconThemes: CustomIconTheme[];
  setCustomIconThemes: Dispatch<SetStateAction<CustomIconTheme[]>>;
  tuiMode: boolean;
  setTuiMode: (value: boolean) => void;
  tuiTheme: "auto" | "light" | "dark";
  setTuiTheme: (value: "auto" | "light" | "dark") => void;
  commandMenuSections: CommandMenuSection[];
  setCommandMenuSections: Dispatch<SetStateAction<CommandMenuSection[]>>;
  glassmorphicHeaders: boolean;
  setGlassmorphicHeaders: (value: boolean) => void;
  gridAnimations: boolean;
  setGridAnimations: (value: boolean) => void;
  sleekSelection: boolean;
  setSleekSelection: (value: boolean) => void;
  colorizedPills: boolean;
  setColorizedPills: (value: boolean) => void;
  relativeDates: boolean;
  setRelativeDates: (value: boolean) => void;
  richJsonInspector: boolean;
  setRichJsonInspector: (value: boolean) => void;
  dataBars: boolean;
  setDataBars: (value: boolean) => void;
  skeletonLoaders: boolean;
  setSkeletonLoaders: (value: boolean) => void;
  sleekLayout: boolean;
  setSleekLayout: (value: boolean) => void;
  activeSleekLayout: boolean;
  showTabIndicator: boolean;
  setShowTabIndicator: (value: boolean) => void;
  restoreAppState: boolean;
  setRestoreAppState: (value: boolean) => void;
  openConnectionsInNewWindow: boolean;
  setOpenConnectionsInNewWindow: (value: boolean) => void;
  schemaExplorer: boolean;
  setSchemaExplorer: (value: boolean) => void;
  databaseExplorer: boolean;
  setDatabaseExplorer: (value: boolean) => void;
  hideWindowActions: boolean;
  setHideWindowActions: (value: boolean) => void;
  autoClosePane: boolean;
  setAutoClosePane: (value: boolean) => void;
  rlsPolicyTabEditor: boolean;
  setRlsPolicyTabEditor: (value: boolean) => void;
  tableExpansion: boolean;
  setTableExpansion: (value: boolean) => void;
  confirmSheetClose: boolean;
  setConfirmSheetClose: (value: boolean) => void;
  sidebarToggleBeforeConnection: boolean;
  setSidebarToggleBeforeConnection: (value: boolean) => void;
  autoSaveQueries: boolean;
  setAutoSaveQueries: (value: boolean) => void;
  vimMode: boolean;
  setVimMode: (value: boolean) => void;
  slashAiTrigger: boolean;
  setSlashAiTrigger: (value: boolean) => void;
  resultTabsEnabled: boolean;
  setResultTabsEnabled: (value: boolean) => void;
  showPendingChangesBanner: boolean;
  setShowPendingChangesBanner: (value: boolean) => void;
  previewTabs: boolean;
  setPreviewTabs: (value: boolean) => void;
  noiseBgEnabled: boolean;
  setNoiseBgEnabled: (value: boolean) => void;
  noiseBgOpacity: number;
  setNoiseBgOpacity: (value: number) => void;
  noiseBgSize: number;
  setNoiseBgSize: (value: number) => void;
  noiseBgBlendMode: "overlay" | "soft-light" | "multiply" | "screen";
  setNoiseBgBlendMode: (value: "overlay" | "soft-light" | "multiply" | "screen") => void;
  noiseBgColor: string;
  setNoiseBgColor: (value: string) => void;
  noiseBgTranslucent: boolean;
  setNoiseBgTranslucent: (value: boolean) => void;
  sqlFormatTabWidth: number;
  setSqlFormatTabWidth: (value: number) => void;
  sqlFormatUseTabs: boolean;
  setSqlFormatUseTabs: (value: boolean) => void;
  sqlFormatKeywordCase: "preserve" | "upper" | "lower";
  setSqlFormatKeywordCase: (value: "preserve" | "upper" | "lower") => void;
  sqlFormatDataTypeCase: "preserve" | "upper" | "lower";
  setSqlFormatDataTypeCase: (value: "preserve" | "upper" | "lower") => void;
  sqlFormatFunctionCase: "preserve" | "upper" | "lower";
  setSqlFormatFunctionCase: (value: "preserve" | "upper" | "lower") => void;
  sqlFormatIdentifierCase: "preserve" | "upper" | "lower";
  setSqlFormatIdentifierCase: (value: "preserve" | "upper" | "lower") => void;
  sqlFormatLogicalOperatorNewline: "before" | "after";
  setSqlFormatLogicalOperatorNewline: (value: "before" | "after") => void;
  sqlFormatExpressionWidth: number;
  setSqlFormatExpressionWidth: (value: number) => void;
  sqlFormatLinesBetweenQueries: number;
  setSqlFormatLinesBetweenQueries: (value: number) => void;
  sqlFormatDenseOperators: boolean;
  setSqlFormatDenseOperators: (value: boolean) => void;
  sqlFormatNewlineBeforeSemicolon: boolean;
  setSqlFormatNewlineBeforeSemicolon: (value: boolean) => void;
  searchSettings: any;
  setSearchSettings: (value: any) => void;
  settingsInitialSection?: SettingsSectionId;
  keybindings: Record<string, any>;
  setKeybindings: Dispatch<SetStateAction<Record<string, any>>>;
}

interface SettingsViewProps {
  studio: StudioSettingsModel;
  onOpenThemeCreator?: () => void;
  onOpenIconThemeCreator?: () => void;
}

export function SettingRow({
  title,
  description,
  children,
  settingId,
}: {
  title: string;
  description: string;
  children: ReactNode;
  settingId?: string;
}) {
  return (
    <div
      className="flex items-center justify-between border-t border-border py-3"
      data-setting-id={settingId}
      id={settingId ? `setting-${settingId}` : undefined}
    >
      <div className="flex flex-col">
        <span className="font-medium text-xs">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      {children}
    </div>
  );
}

function ToggleSetting({
  title,
  description,
  value,
  onChange,
  settingId,
}: {
  title: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  settingId?: string;
}) {
  return (
    <SettingRow title={title} description={description} settingId={settingId}>
      <button
        onClick={() => onChange(!value)}
        className={cn(
          "w-10 h-5 rounded-lg relative transition-colors duration-200 outline-none border border-border",
          value ? "bg-primary" : "bg-muted",
        )}
      >
        <div
          className={cn(
            "absolute top-0.5 w-3.5 h-3.5 rounded-lg transition-transform duration-200",
            value
              ? "translate-x-5.5 bg-primary-foreground"
              : "translate-x-0.5 bg-muted-foreground/50",
          )}
        />
      </button>
    </SettingRow>
  );
}

export function SwitchSetting({
  title,
  description,
  value,
  onChange,
  settingId,
}: {
  title: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  settingId?: string;
}) {
  return (
    <SettingRow title={title} description={description} settingId={settingId}>
      <Switch checked={value} onCheckedChange={onChange} />
    </SettingRow>
  );
}

export function SelectSetting<T extends string>({
  title,
  description,
  value,
  onValueChange,
  options,
  width = "w-32",
  disabled,
  settingId,
}: {
  title: string;
  description: string;
  value: T;
  onValueChange: (v: T) => void;
  options: { value: T; label: string }[];
  width?: string;
  disabled?: boolean;
  settingId?: string;
}) {
  return (
    <SettingRow title={title} description={description} settingId={settingId}>
      <Select
        value={value}
        onValueChange={onValueChange as (v: string) => void}
        disabled={disabled}
      >
        <SelectTrigger
          className={cn(
            "h-8 bg-secondary/50 border-border text-xs",
            width,
            disabled && "opacity-60",
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-popover border-border">
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

function removeCustomTheme(
  setThemes: React.Dispatch<React.SetStateAction<any[]>>,
  currentId: string,
  setCurrentId: (id: string) => void,
  fallbackId: string,
  themeId: string,
) {
  setThemes((prev) => prev.filter((t) => t.id !== themeId));
  if (currentId === themeId) {
    setCurrentId(fallbackId);
  }
}

function generateCopyName(
  selectedName: string,
  existingNames: Set<string>,
): string {
  let newName = `${selectedName} (copy)`;
  let counter = 2;
  while (existingNames.has(newName)) {
    newName = `${selectedName} (copy ${counter})`;
    counter++;
  }
  return newName;
}

function validateAndPrepareTheme(
  jsonInput: string,
  parseTheme: (json: string) => { error?: string; theme?: any },
  nameInput: string,
  builtInThemes: Array<{ id: string; label?: string; name?: string }>,
  customThemes: Array<{ name: string; id: string }>,
): { name: string; id: string; parsed: any } | null {
  if (!jsonInput.trim()) {
    toast.error("Paste a theme JSON first.");
    return null;
  }
  const parsed = parseTheme(jsonInput);
  if (parsed.error || !parsed.theme) {
    toast.error(parsed.error || "Invalid theme JSON.");
    return null;
  }
  const name = nameInput.trim() || parsed.theme?.name || "Custom Theme";
  if (!validateThemeName(name, builtInThemes, customThemes)) return null;
  const id = generateThemeId(name, customThemes, builtInThemes);
  return { name, id, parsed };
}

function validateThemeName(
  name: string,
  builtInThemes: Array<{ label?: string; name?: string }>,
  customThemes: Array<{ name: string }>,
): boolean {
  const labels = builtInThemes.map((t: any) => t.label ?? t.name);
  const existingNames = new Set([
    ...labels,
    ...customThemes.map((t) => t.name),
  ]);
  if (existingNames.has(name)) {
    toast.error(`Theme name "${name}" already exists.`);
    return false;
  }
  return true;
}

function generateThemeId(
  name: string,
  customThemes: Array<{ id: string }>,
  builtInThemes: Array<{ id: string }>,
): string {
  const existingIds = new Set(customThemes.map((t) => t.id));
  builtInThemes.forEach((t) => existingIds.add(t.id));
  return createThemeId(name, existingIds);
}

const SETTINGS_SEARCH_SECTION_ORDER: SettingsSectionId[] = [
  "general",
  "editor",
  "themes",
  "ai",
  "mcp",
  "security",
  "keybindings",
  "advanced",
];

function SettingsSearchResults({
  query,
  results,
  onNavigate,
  onClear,
}: {
  query: string;
  results: SettingsSearchEntry[];
  onNavigate: (entry: SettingsSearchEntry) => void;
  onClear: () => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<SettingsSectionId, SettingsSearchEntry[]>();
    for (const entry of results) {
      const list = map.get(entry.section);
      if (list) list.push(entry);
      else map.set(entry.section, [entry]);
    }
    return SETTINGS_SEARCH_SECTION_ORDER.filter((section) =>
      map.has(section),
    ).map((section) => ({
      section,
      entries: map.get(section) ?? [],
    }));
  }, [results]);

  if (results.length === 0) {
    return (
      <section className="flex flex-col items-center gap-2 py-16 text-center">
        <SearchX className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm font-medium">
          No settings match &ldquo;{query.trim()}&rdquo;
        </p>
        <p className="text-xs text-muted-foreground">
          Try a different keyword, or browse sections in the sidebar.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 h-7 text-xs"
          onClick={onClear}
        >
          Clear search
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-semibold">
            {results.length} {results.length === 1 ? "result" : "results"}
          </span>
          <span className="text-muted-foreground">
            for &ldquo;{query.trim()}&rdquo;
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onClear}
        >
          Clear
        </Button>
      </div>
      {grouped.map(({ section, entries }) => (
        <div key={section} className="space-y-1">
          <h3 className="text-xs font-semiboldtracking-wider text-muted-foreground">
            {SETTINGS_SECTION_LABELS[section]}
          </h3>
          <div className="overflow-hidden rounded-lg border border-border">
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onNavigate(entry)}
                className="group flex w-full items-center justify-between gap-3 border-b border-border bg-card px-3.5 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/50"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-xs font-medium">{entry.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {entry.description}
                  </span>
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export function SettingsView({
  studio,
  onOpenThemeCreator,
  onOpenIconThemeCreator,
}: SettingsViewProps) {
  const {
    appZoom,
    setAppZoom,
    executionMode,
    setExecutionMode,
    rowSpacing,
    setRowSpacing,
    alternatingRowColors,
    setAlternatingRowColors,
    editorFontSize,
    setEditorFontSize,
    editorFontFamily,
    setEditorFontFamily,
    sqlEditorEngine,
    setSqlEditorEngine,
    editorThemeId,
    setEditorThemeId,
    customEditorThemes,
    setCustomEditorThemes,
    appThemeId,
    setAppThemeId,
    customAppThemes,
    setCustomAppThemes,
    customFontFamily,
    setCustomFontFamily,
    iconThemeId,
    setIconThemeId,
    customIconThemes,
    setCustomIconThemes,
    tuiMode,
    setTuiMode,
    tuiTheme,
    setTuiTheme,
    commandMenuSections,
    setCommandMenuSections,
    glassmorphicHeaders,
    setGlassmorphicHeaders,
    gridAnimations,
    setGridAnimations,
    sleekSelection,
    setSleekSelection,
    colorizedPills,
    setColorizedPills,
    relativeDates,
    setRelativeDates,
    richJsonInspector,
    setRichJsonInspector,
    dataBars,
    setDataBars,
    skeletonLoaders,
    setSkeletonLoaders,
    showPendingChangesBanner,
    setShowPendingChangesBanner,
    previewTabs,
    setPreviewTabs,
    noiseBgEnabled,
    setNoiseBgEnabled,
    noiseBgOpacity,
    setNoiseBgOpacity,
    noiseBgSize,
    setNoiseBgSize,
    noiseBgBlendMode,
    setNoiseBgBlendMode,
    noiseBgColor,
    setNoiseBgColor,
    noiseBgTranslucent,
    setNoiseBgTranslucent,
    sleekLayout,
    setSleekLayout,
    activeSleekLayout,
    showTabIndicator,
    setShowTabIndicator,
    restoreAppState,
    setRestoreAppState,
    openConnectionsInNewWindow,
    setOpenConnectionsInNewWindow,
    schemaExplorer,
    setSchemaExplorer,
    databaseExplorer,
    setDatabaseExplorer,
    tableExpansion,
    setTableExpansion,
    hideWindowActions,
    setHideWindowActions,
    autoClosePane,
    setAutoClosePane,
    rlsPolicyTabEditor,
    setRlsPolicyTabEditor,
    searchSettings,
    setSearchSettings,
    keybindings,
    setKeybindings,
  } = studio;

  const {
    confirmSheetClose,
    setConfirmSheetClose,
    sidebarToggleBeforeConnection,
    setSidebarToggleBeforeConnection,
    autoSaveQueries,
    setAutoSaveQueries,
    vimMode,
    setVimMode,
    slashAiTrigger,
    setSlashAiTrigger,
    resultTabsEnabled,
    setResultTabsEnabled,
    sqlFormatTabWidth,
    setSqlFormatTabWidth,
    sqlFormatUseTabs,
    setSqlFormatUseTabs,
    sqlFormatKeywordCase,
    setSqlFormatKeywordCase,
    sqlFormatDataTypeCase,
    setSqlFormatDataTypeCase,
    sqlFormatFunctionCase,
    setSqlFormatFunctionCase,
    sqlFormatIdentifierCase,
    setSqlFormatIdentifierCase,
    sqlFormatLogicalOperatorNewline,
    setSqlFormatLogicalOperatorNewline,
    sqlFormatExpressionWidth,
    setSqlFormatExpressionWidth,
    sqlFormatLinesBetweenQueries,
    setSqlFormatLinesBetweenQueries,
    sqlFormatDenseOperators,
    setSqlFormatDenseOperators,
    sqlFormatNewlineBeforeSemicolon,
    setSqlFormatNewlineBeforeSemicolon,
  } = pickCommonSettings(studio);

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const dragOverIndex = useRef<number | null>(null);
  const {
    updateState,
    setUpdateState,
    installing: installingUpdate,
    setInstalling: setInstallingUpdate,
    checkForUpdates,
    handleDownload,
    handleInstall,
  } = useAppUpdate();
  const [isEditorThemeDialogOpen, setIsEditorThemeDialogOpen] = useState(false);
  const [themeNameInput, setThemeNameInput] = useState("");
  const [themeJsonInput, setThemeJsonInput] = useState("");
  const [themeFileName, setThemeFileName] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() => {
    const initial: SettingsSectionId = studio.settingsInitialSection ?? "general";
    return isSettingsSectionAvailable(initial) ? initial : "general";
  });
  const [showProviders, setShowProviders] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);

  const searchResults = useMemo(
    () => filterSettingsSearch(searchQuery).filter((entry) => isSettingsSectionAvailable(entry.section)),
    [searchQuery],
  );
  const isSearching = searchQuery.trim().length > 0;

  const handleSearchNavigate = useCallback((entry: SettingsSearchEntry) => {
    setActiveSection(entry.section);
    setSearchQuery("");
    // Wait a tick for the section to render, then deep-scroll to the setting.
    setTimeout(() => {
      const el = document.querySelector(`[data-setting-id="${entry.id}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Tailwind picks these classes up from these literals at build time.
        el.classList.add("rounded-lg", "ring-2", "ring-primary/50");
        setTimeout(
          () => el.classList.remove("rounded-lg", "ring-2", "ring-primary/50"),
          2200,
        );
      } else {
        contentRef.current?.scrollTo({ top: 0 });
      }
    }, 80);
  }, []);
  useEffect(() => {
    if (activeSection !== "ai") setShowProviders(false);
  }, [activeSection]);
  useEffect(() => {
    if (studio.settingsInitialSection) {
      setActiveSection(studio.settingsInitialSection);
    }
  }, [studio.settingsInitialSection]);
  const [themeDialogPos, setThemeDialogPos] = useState({ x: 0, y: 0 });
  const themeDialogDrag = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    startPosX: 0,
    startPosY: 0,
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const d = themeDialogDrag.current;
      if (!d.dragging) return;
      setThemeDialogPos({
        x: d.startPosX + e.clientX - d.startX,
        y: d.startPosY + e.clientY - d.startY,
      });
    };
    const up = () => {
      themeDialogDrag.current.dragging = false;
    };
    window.addEventListener("mousemove", handler);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", handler);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const handleDialogHeaderMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    themeDialogDrag.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startPosX: themeDialogPos.x,
      startPosY: themeDialogPos.y,
    };
  };

  useEffect(() => {
    if (isEditorThemeDialogOpen) {
      setThemeDialogPos({
        x: Math.max(24, window.innerWidth - 696),
        y: Math.max(60, Math.round(window.innerHeight * 0.5)),
      });
    }
  }, [isEditorThemeDialogOpen]);

  const appBuiltInThemes = BUILTIN_APP_THEMES.map((theme) => ({
    id: theme.id,
    label: theme.name,
  }));
  const editorBuiltInThemes = [...BUILTIN_EDITOR_THEMES];
  // When the hosting console chose the theme, the look is not this viewer's to change.
  const lookOwnedByHost = hasHostTheme();

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // Create a ghost image if needed, or just let default happen
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "0.4";
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedIndex(null);
    dragOverIndex.current = null;
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    if (draggedIndex === null || draggedIndex === index) return;

    // Live reordering logic
    const newSections = [...commandMenuSections];
    const movedSection = newSections[draggedIndex];
    newSections.splice(draggedIndex, 1);
    newSections.splice(index, 0, movedSection);

    setCommandMenuSections(newSections);
    setDraggedIndex(index);
  };

  const toggleSectionVisibility = (id: string) => {
    setCommandMenuSections((prev) =>
      prev.map((section) =>
        section.id === id
          ? { ...section, isVisible: !section.isVisible }
          : section,
      ),
    );
  };

  const handleFileUpload = useCallback(
    (
      file: File | null,
      setJson: (v: string) => void,
      setFileName: (v: string | null) => void,
      nameInput: string,
      setNameInput: (v: string) => void,
      label: string,
    ) => {
      if (!file) return;
      file
        .text()
        .then((text) => {
          setJson(text);
          setFileName(file.name);
          if (!nameInput.trim()) {
            setNameInput(file.name.replace(/\\.json$/i, ""));
          }
        })
        .catch((err) => {
          console.error(`Failed to read ${label} file`, err);
          toast.error(`Failed to read ${label} file.`);
        });
    },
    [],
  );

  const handleThemeFileUpload = (file: File | null) =>
    handleFileUpload(
      file,
      setThemeJsonInput,
      setThemeFileName,
      themeNameInput,
      setThemeNameInput,
      "theme",
    );

  const resetThemeInputs = (
    setName: (v: string) => void,
    setJson: (v: string) => void,
    setFileName: (v: string | null) => void,
  ) => {
    setName("");
    setJson("");
    setFileName(null);
  };

  const resetThemeDialog = () =>
    resetThemeInputs(setThemeNameInput, setThemeJsonInput, setThemeFileName);

  const handleAddEditorTheme = () => {
    const result = validateAndPrepareTheme(
      themeJsonInput,
      parseThemeJson,
      themeNameInput,
      editorBuiltInThemes,
      customEditorThemes,
    );
    if (!result) return;
    setCustomEditorThemes([
      ...customEditorThemes,
      { id: result.id, name: result.name, themeJson: themeJsonInput },
    ]);
    setEditorThemeId(result.id);
    setIsEditorThemeDialogOpen(false);
    resetThemeDialog();
    toast.success(`Added "${result.name}" theme.`);
  };

  const handleRemoveEditorTheme = (themeId: string) =>
    removeCustomTheme(
      setCustomEditorThemes,
      editorThemeId,
      setEditorThemeId,
      "auto",
      themeId,
    );

  const handleRemoveAppTheme = (themeId: string) =>
    removeCustomTheme(
      setCustomAppThemes,
      appThemeId,
      setAppThemeId,
      "infinity-studio-dark",
      themeId,
    );

  useEffect(() => {
    if (!isEditorThemeDialogOpen) return;
    const selected = customEditorThemes.find((t) => t.id === editorThemeId);
    if (selected) {
      setThemeJsonInput(selected.themeJson);
      const existingLabels = new Set([
        ...editorBuiltInThemes.map((t) => t.label),
        ...customEditorThemes.map((t) => t.name),
      ]);
      setThemeNameInput(generateCopyName(selected.name, existingLabels));
    } else {
      setThemeJsonInput(
        JSON.stringify(
          { base: "vs-dark", inherit: true, rules: [], colors: {} },
          null,
          2,
        ),
      );
      setThemeNameInput("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditorThemeDialogOpen, editorThemeId, customEditorThemes]);

  const handleCheckUpdates = async () => {
    toast.success("Checking for updates...");
    await checkForUpdates();
  };

  const handleDownloadUpdate = async () => {
    if (!handleDownload) {
      toast.error("Update controls are only available in the desktop app.");
      return;
    }
    await handleDownload();
    toast.success("Downloading update...");
  };

  const handleInstallUpdate = async () => {
    if (!handleInstall) {
      toast.error("Update controls are only available in the desktop app.");
      return;
    }
    setInstallingUpdate(true);
    try {
      await handleInstall();
    } catch {
      setInstallingUpdate(false);
      toast.error("Failed to install update.");
      return;
    }
    toast.success("Installing update and restarting...");
  };

  return (
    <div className="flex-1 overflow-auto bg-background text-foreground h-full">
      <div className="flex h-full min-h-0">
        <SettingsSidebar
          activeSection={activeSection}
          onSelect={setActiveSection}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        <div
          ref={contentRef}
          className="min-w-0 flex-1 space-y-8 overflow-auto px-8 py-6"
        >
          {isSearching ? (
            <SettingsSearchResults
              query={searchQuery}
              results={searchResults}
              onNavigate={handleSearchNavigate}
              onClear={() => setSearchQuery("")}
            />
          ) : null}
          {!isSearching && activeSection === "ai" ? (
            showProviders ? (
              <AiProvidersPage onBack={() => setShowProviders(false)} />
            ) : (
              <section className="space-y-4">
                <div data-setting-id="ai-models">
                  <AiSettingsSection
                    onOpenProviders={() => setShowProviders(true)}
                  />
                </div>
                <div
                  data-setting-id="slash-ai-trigger"
                  className="flex items-center justify-between rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-xs">Slash AI Trigger</span>
                    <span className="text-xs text-muted-foreground">
                      Type / in an empty editor to activate AI mode.
                    </span>
                  </div>
                  <Switch
                    checked={slashAiTrigger}
                    onCheckedChange={setSlashAiTrigger}
                  />
                </div>
              </section>
            )
          ) : null}

          {!isSearching && activeSection === "general" ? (
            <section className="space-y-5">
              <h2 className="text-sm font-semibold">General</h2>

              <div className="space-y-4">
                {lookOwnedByHost ? null : (<>
                {/* Appearance */}
                <div data-setting-id="appearance" className="flex flex-col space-y-3">
                  <div className="flex flex-col">
                    <span className="font-medium text-xs">Appearance</span>
                    <span className="text-xs text-muted-foreground">
                      Select how Infinity Studio looks on your device.
                    </span>
                  </div>

                  <div className="grid max-w-lg grid-cols-3 gap-3">
                    {[
                      {
                        id: "light",
                        themeId: "light",
                        label: "Light",
                        preview: "bg-white",
                      },
                      {
                        id: "dark",
                        themeId: "infinity-studio-dark",
                        label: "Dark",
                        preview: "bg-[#0F0F0F]",
                      },
                      {
                        id: "system",
                        themeId: "system",
                        label: "System",
                        preview: "bg-gradient-to-br from-white to-[#0F0F0F]",
                      },
                    ].map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setAppThemeId(item.themeId)}
                        className="group flex flex-col items-center gap-1.5"
                      >
                        <div
                          className={cn(
                            "w-full aspect-[16/10] rounded-lg border-2 flex flex-col overflow-hidden relative transition-all",
                            appThemeId === item.themeId
                              ? "border-blue-500 shadow-sm"
                              : "border-border group-hover:border-muted-foreground/20",
                          )}
                        >
                          <div className={cn("flex-1", item.preview)} />
                          <div className="h-4 bg-muted/30 border-t border-border flex items-center px-1.5 gap-1">
                            <div className="w-1.5 h-1.5 rounded-lg bg-red-500/50" />
                            <div className="w-1.5 h-1.5 rounded-lg bg-amber-500/50" />
                            <div className="w-1.5 h-1.5 rounded-lg bg-green-500/50" />
                          </div>
                          {appThemeId === item.themeId && (
                            <div className="absolute top-2 right-2 w-4 h-4 bg-blue-500 rounded-lg flex items-center justify-center">
                              <Check className="w-2.5 h-2.5 text-white" />
                            </div>
                          )}
                        </div>
                        <span
                          className={cn(
                            "text-xs font-medium transition-colors",
                            appThemeId === item.themeId
                              ? "text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {item.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* App Theme */}
                <div
                  data-setting-id="app-theme"
                  className="flex items-start justify-between gap-3 border-t border-border py-3"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-xs">App Theme</span>
                    <span className="text-xs text-muted-foreground max-w-md">
                      Choose a built-in theme or add a custom palette for the
                      whole app.
                    </span>
                  </div>
                  <ThemeSelectSection
                    value={appThemeId}
                    onValueChange={setAppThemeId}
                    builtInThemes={appBuiltInThemes}
                    customThemes={customAppThemes}
                    onCustomTheme={onOpenThemeCreator}
                    onBrowseThemes={() => setActiveSection("themes")}
                    icon={<Upload className="w-3.5 h-3.5" />}
                  />
                </div>

                {customAppThemes.length > 0 ? (
                  <div className="flex flex-col gap-1.5 pb-1">
                    <span className="text-xs text-muted-foreground">
                      Custom app themes
                    </span>
                    <div className="flex flex-col gap-1.5">
                      {customAppThemes.map((theme) => (
                        <div
                          key={theme.id}
                          className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/20 px-2.5 py-1.5"
                        >
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-foreground">
                              {theme.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {theme.id} • {theme.base}
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-red-500 hover:text-red-600"
                            onClick={() => handleRemoveAppTheme(theme.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div data-setting-id="app-font">
                  <CustomFontSetting
                    value={customFontFamily}
                    onChange={setCustomFontFamily}
                  />
                </div>
                </>)}
                <div data-setting-id="icon-theme">
                  <IconThemeSetting
                    iconThemeId={iconThemeId}
                    setIconThemeId={setIconThemeId}
                    customIconThemes={customIconThemes}
                    setCustomIconThemes={setCustomIconThemes}
                  />
                </div>

                <div data-setting-id="zoom">
                  <ZoomSetting value={appZoom} onChange={setAppZoom} />
                </div>

                {/* Row Spacing */}
                <SelectSetting
                  settingId="row-spacing"
                  title="Row Spacing"
                  description="Adjust the vertical spacing between rows in data tables."
                  value={rowSpacing}
                  onValueChange={setRowSpacing}
                  options={[
                    { value: "compact", label: "Compact" },
                    { value: "standard", label: "Standard" },
                    { value: "relaxed", label: "Relaxed" },
                  ]}
                />

                {/* Terminal UI */}
                <ToggleSetting
                  settingId="tui-mode"
                  title="Terminal UI (Experimental)"
                  description="Switch the app to a blocky terminal-style UI with mono typography."
                  value={tuiMode}
                  onChange={setTuiMode}
                />

                {/* Terminal Theme */}
                <SelectSetting
                  settingId="tui-theme"
                  title="Terminal Theme"
                  description="Choose light, dark, or follow system while in terminal UI."
                  value={tuiTheme}
                  onValueChange={setTuiTheme}
                  disabled={!tuiMode}
                  options={[
                    { value: "auto", label: "System" },
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                />

                {/* Sleek Layout */}
                <SettingRow
                  settingId="sleek-layout"
                  title="Sleek Layout"
                  description="Add padding and rounded corners to main interface panels."
                >
                  <div className="flex flex-col items-end gap-1">
                    {sleekLayout !== activeSleekLayout && (
                      <span className="text-xs text-amber-500 font-medium whitespace-nowrap">
                        Applying layout changes...
                      </span>
                    )}
                    <button
                      onClick={() => setSleekLayout(!sleekLayout)}
                      className={cn(
                        "w-10 h-5 rounded-lg relative transition-colors duration-200 outline-none border border-border",
                        sleekLayout ? "bg-primary" : "bg-muted",
                      )}
                    >
                      <div
                        className={cn(
                          "absolute top-0.5 w-3.5 h-3.5 rounded-lg transition-transform duration-200",
                          sleekLayout
                            ? "translate-x-5.5 bg-primary-foreground"
                            : "translate-x-0.5 bg-muted-foreground/50",
                        )}
                      />
                    </button>
                  </div>
                </SettingRow>

                {/* Translucent Background */}
                <ToggleSetting
                  settingId="translucent-bg"
                  title="Translucent Background"
                  description="Make the outer chrome translucent with a blur effect, showing the desktop behind the window."
                  value={noiseBgTranslucent}
                  onChange={setNoiseBgTranslucent}
                />

                {/* Background Noise */}
                <ToggleSetting
                  settingId="bg-noise"
                  title="Background Noise"
                  description="Add a subtle grain texture to the sidebar and outer surface."
                  value={noiseBgEnabled}
                  onChange={setNoiseBgEnabled}
                />
                {noiseBgEnabled && (
                  <div className="flex flex-col space-y-3 border-t border-border pt-3">
                    <SettingRow
                      settingId="noise-size"
                      title="Noise Size"
                      description="Scale of the noise pattern (smaller = finer grain)."
                    >
                      <input
                        type="range"
                        min={1}
                        max={100}
                        value={noiseBgSize}
                        onChange={(e) => setNoiseBgSize(Number(e.target.value))}
                        className="h-2 w-28 cursor-pointer appearance-none rounded-full bg-muted accent-primary
                          [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                      />
                    </SettingRow>
                    <SelectSetting
                      settingId="noise-blend"
                      title="Blend Mode"
                      description="How the noise blends with the background."
                      value={noiseBgBlendMode}
                      onValueChange={setNoiseBgBlendMode}
                      options={[
                        { value: "overlay", label: "Overlay" },
                        { value: "soft-light", label: "Soft Light" },
                        { value: "multiply", label: "Multiply" },
                        { value: "screen", label: "Screen" },
                      ]}
                    />
                    <SettingRow
                      settingId="noise-color"
                      title="Color"
                      description="Tint color for the noise texture."
                    >
                      <input
                        type="color"
                        value={noiseBgColor}
                        onChange={(e) => setNoiseBgColor(e.target.value)}
                        className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-none"
                      />
                    </SettingRow>
                    <SettingRow
                      settingId="noise-opacity"
                      title="Opacity"
                      description="Strength of the noise effect."
                    >
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={noiseBgOpacity}
                        onChange={(e) => setNoiseBgOpacity(Number(e.target.value))}
                        className="h-2 w-28 cursor-pointer appearance-none rounded-full bg-muted accent-primary
                          [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                      />
                    </SettingRow>
                  </div>
                )}

                {/* Alternating Row Colors */}
                <ToggleSetting
                  settingId="alternating-rows"
                  title="Alternating Row Colors"
                  description="Apply alternating background colors to rows in data tables for easier reading."
                  value={alternatingRowColors}
                  onChange={setAlternatingRowColors}
                />

                {/* Pending Changes Banner */}
                <ToggleSetting
                  settingId="pending-banner"
                  title="Show Pending Changes Banner"
                  description="Display a banner above the data grid when there are unsaved changes."
                  value={showPendingChangesBanner}
                  onChange={setShowPendingChangesBanner}
                />

                {/* Restore App State */}
                <ToggleSetting
                  settingId="restore-state"
                  title="Restore App State"
                  description="When enabled, reopens tabs and restores your previous session when you return to a connection."
                  value={restoreAppState}
                  onChange={setRestoreAppState}
                />

                {/* Open Connections in New Window */}
                <ToggleSetting
                  settingId="open-new-window"
                  title="Open Connections in New Window"
                  description="When enabled, each connection opens in its own window instead of replacing the current one."
                  value={openConnectionsInNewWindow}
                  onChange={setOpenConnectionsInNewWindow}
                />

                {/* Auto-Save Executed Queries */}
                <ToggleSetting
                  settingId="autosave-queries"
                  title="Auto-Save Executed Queries"
                  description="Automatically save every executed query as a snippet with a query number and timestamp."
                  value={autoSaveQueries}
                  onChange={setAutoSaveQueries}
                />

                {/* Local Search Index */}
                <ToggleSetting
                  settingId="local-search-index"
                  title="Local Search Index"
                  description="Cache universal search results in a local SQLite database for instant repeat searches. Indexed data is stored separately from your connection database."
                  value={searchSettings?.localIndexEnabled ?? false}
                  onChange={(v: boolean) =>
                    setSearchSettings((prev: any) => ({
                      ...prev,
                      localIndexEnabled: v,
                    }))
                  }
                />
              </div>
            </section>
          ) : null}

          {!isSearching && activeSection === "editor" ? (
            <section className="space-y-5">
              <h2 className="text-sm font-semibold">Editor</h2>

              <div className="space-y-4">
                <SelectSetting
                  settingId="editor-font-size"
                  title="Editor Font Size"
                  description="Adjust the font size for query editors."
                  value={editorFontSize}
                  onValueChange={setEditorFontSize}
                  options={[
                    { value: "12px", label: "12px" },
                    { value: "13px", label: "13px" },
                    { value: "14px", label: "14px" },
                    { value: "16px", label: "16px" },
                  ]}
                />

                {lookOwnedByHost ? null : (
                <div data-setting-id="editor-font-family">
                  <CustomFontSetting
                    value={editorFontFamily}
                    onChange={setEditorFontFamily}
                    title="Editor Font Family"
                    description="Use a specific font for the SQL editor. If empty, it will follow the app font."
                  />
                </div>
                )}

                <SwitchSetting
                  settingId="vim-mode"
                  title="Vim Mode"
                  description="Enable Vim keybindings for the SQL editor."
                  value={vimMode}
                  onChange={setVimMode}
                />
                <SwitchSetting
                  settingId="result-tabs"
                  title="Result Tabs"
                  description="Show query results in individual tabs for multi-statement queries."
                  value={resultTabsEnabled}
                  onChange={setResultTabsEnabled}
                />

                {lookOwnedByHost ? null : (
                <div
                  data-setting-id="editor-theme"
                  className="flex items-start justify-between gap-3 border-t border-border py-3"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-xs">Editor Theme</span>
                    <span className="text-xs text-muted-foreground max-w-md">
                      Choose a built-in theme or add a custom VS Code theme JSON
                      for editors.
                    </span>
                  </div>
                  <ThemeSelectSection
                    value={editorThemeId}
                    onValueChange={setEditorThemeId}
                    builtInThemes={editorBuiltInThemes}
                    customThemes={customEditorThemes}
                    onCustomTheme={() => setIsEditorThemeDialogOpen(true)}
                    onBrowseThemes={() => setActiveSection("themes")}
                    icon={<Code className="w-3.5 h-3.5" />}
                  />
                </div>
                )}
              </div>

              {/* SQL Formatting */}
              <div className="space-y-4">
                <h3 className="text-xs font-semiboldtracking-wider text-muted-foreground pt-4">
                  SQL Formatting
                </h3>

                <SelectSetting
                  settingId="sql-keyword-case"
                  title="Keyword Case"
                  description="Casing for SQL keywords (SELECT, FROM, WHERE...)."
                  value={sqlFormatKeywordCase}
                  onValueChange={(v) =>
                    setSqlFormatKeywordCase(v as "preserve" | "upper" | "lower")
                  }
                  options={[
                    { value: "preserve", label: "Preserve" },
                    { value: "upper", label: "Upper" },
                    { value: "lower", label: "Lower" },
                  ]}
                />
                <SelectSetting
                  settingId="sql-datatype-case"
                  title="Data Type Case"
                  description="Casing for data types (INT, VARCHAR...)."
                  value={sqlFormatDataTypeCase}
                  onValueChange={(v) =>
                    setSqlFormatDataTypeCase(
                      v as "preserve" | "upper" | "lower",
                    )
                  }
                  options={[
                    { value: "preserve", label: "Preserve" },
                    { value: "upper", label: "Upper" },
                    { value: "lower", label: "Lower" },
                  ]}
                />
                <SelectSetting
                  settingId="sql-function-case"
                  title="Function Case"
                  description="Casing for function names (COUNT, SUM...)."
                  value={sqlFormatFunctionCase}
                  onValueChange={(v) =>
                    setSqlFormatFunctionCase(
                      v as "preserve" | "upper" | "lower",
                    )
                  }
                  options={[
                    { value: "preserve", label: "Preserve" },
                    { value: "upper", label: "Upper" },
                    { value: "lower", label: "Lower" },
                  ]}
                />
                <SelectSetting
                  settingId="sql-identifier-case"
                  title="Identifier Case"
                  description="Casing for identifiers (experimental)."
                  value={sqlFormatIdentifierCase}
                  onValueChange={(v) =>
                    setSqlFormatIdentifierCase(
                      v as "preserve" | "upper" | "lower",
                    )
                  }
                  options={[
                    { value: "preserve", label: "Preserve" },
                    { value: "upper", label: "Upper" },
                    { value: "lower", label: "Lower" },
                  ]}
                />

                <SelectSetting
                  settingId="sql-tab-width"
                  title="Tab Width"
                  description="Number of spaces per indentation level."
                  value={String(sqlFormatTabWidth)}
                  onValueChange={(v) => setSqlFormatTabWidth(Number(v))}
                  width="w-24"
                  options={[1, 2, 3, 4, 6, 8].map((n) => ({
                    value: String(n),
                    label: `${n} ${n === 1 ? "space" : "spaces"}`,
                  }))}
                />

                <SwitchSetting
                  settingId="sql-use-tabs"
                  title="Use Tabs"
                  description="Use tab characters instead of spaces for indentation."
                  value={sqlFormatUseTabs}
                  onChange={setSqlFormatUseTabs}
                />

                <SelectSetting
                  settingId="sql-logical-newline"
                  title="Logical Operator Newline"
                  description="Place AND/OR before or after the newline."
                  value={sqlFormatLogicalOperatorNewline}
                  onValueChange={(v) =>
                    setSqlFormatLogicalOperatorNewline(v as "before" | "after")
                  }
                  width="w-28"
                  options={[
                    { value: "before", label: "Before" },
                    { value: "after", label: "After" },
                  ]}
                />

                <SelectSetting
                  settingId="sql-expression-width"
                  title="Expression Width"
                  description="Max chars in parentheses before wrapping."
                  value={String(sqlFormatExpressionWidth)}
                  onValueChange={(v) => setSqlFormatExpressionWidth(Number(v))}
                  width="w-28"
                  options={[10, 20, 30, 40, 50, 60, 80, 100, 120].map((n) => ({
                    value: String(n),
                    label: String(n),
                  }))}
                />
                <SelectSetting
                  settingId="sql-lines-between"
                  title="Lines Between Queries"
                  description="Number of blank lines between separate queries."
                  value={String(sqlFormatLinesBetweenQueries)}
                  onValueChange={(v) =>
                    setSqlFormatLinesBetweenQueries(Number(v))
                  }
                  width="w-24"
                  options={[0, 1, 2, 3, 4, 5].map((n) => ({
                    value: String(n),
                    label: String(n),
                  }))}
                />

                <SwitchSetting
                  settingId="sql-dense-operators"
                  title="Dense Operators"
                  description="Remove spaces around operators (e.g. a=b instead of a = b)."
                  value={sqlFormatDenseOperators}
                  onChange={setSqlFormatDenseOperators}
                />
                <SwitchSetting
                  settingId="sql-newline-semicolon"
                  title="Newline Before Semicolon"
                  description="Place semicolons on their own line."
                  value={sqlFormatNewlineBeforeSemicolon}
                  onChange={setSqlFormatNewlineBeforeSemicolon}
                />
              </div>
            </section>
          ) : null}

          {!isSearching && activeSection === "themes" ? (
            <div data-setting-id="themes-browse">
              <ThemesSection
              customAppThemes={customAppThemes}
              setCustomAppThemes={setCustomAppThemes}
              appThemeId={appThemeId}
              setAppThemeId={setAppThemeId}
              customEditorThemes={customEditorThemes}
              setCustomEditorThemes={setCustomEditorThemes}
              onOpenEditorThemeDialog={() => setIsEditorThemeDialogOpen(true)}
              onOpenThemeCreator={onOpenThemeCreator}
              onOpenIconThemeCreator={onOpenIconThemeCreator}
              />
            </div>
          ) : null}

          {!isSearching && activeSection === "security" ? (
            <section className="space-y-5">
              <h2 className="text-sm font-semibold">Security</h2>

              <div className="space-y-4">
                <SelectSetting
                  settingId="execution-mode"
                  title="Execution Mode"
                  description={
                    'When set to "Review", queries are sent to a review panel instead of executing directly.'
                  }
                  value={executionMode}
                  onValueChange={setExecutionMode}
                  options={[
                    { value: "direct", label: "Direct" },
                    { value: "review", label: "Review" },
                  ]}
                />
              </div>
            </section>
          ) : null}

          {!isSearching && activeSection === "keybindings" ? (
            <section className="space-y-4">
              <div data-setting-id="keybindings-list">
                <KeybindingsPanel
                  keybindings={keybindings}
                  setKeybindings={setKeybindings}
                />
              </div>
            </section>
          ) : null}

          {!isSearching && activeSection === "mcp" ? (
            <div data-setting-id="mcp-enable">
              <McpSettingsSection />
            </div>
          ) : null}

          {!isSearching && activeSection === "advanced" ? (
            <section className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">Advanced</h2>
                <p className="text-xs text-muted-foreground">
                  Configure advanced behavior and appearance of the application.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-4">
                  <h3 className="text-sm font-medium">Interface Polish</h3>

                  <SwitchSetting
                    settingId="tab-indicator"
                    title="Show Tab Indicator"
                    description="Display the primary color line above the active editor tab."
                    value={showTabIndicator}
                    onChange={setShowTabIndicator}
                  />
                  <SwitchSetting
                    settingId="window-actions"
                    title="Window Action Buttons"
                    description="Show custom minimize, maximize, and close buttons in the header. Disable if your window manager provides these natively."
                    value={!hideWindowActions}
                    onChange={(v) => setHideWindowActions(!v)}
                  />
                  <SwitchSetting
                    settingId="sidebar-toggle-pos"
                    title="Sidebar Toggle Before Connection"
                    description="Move the sidebar toggle button before the connection selector in the header."
                    value={sidebarToggleBeforeConnection}
                    onChange={setSidebarToggleBeforeConnection}
                  />
                </div>

                <div className="space-y-4 pt-4">
                  <h3 className="text-sm font-medium">
                    Data Grid - Visual Overhaul
                  </h3>

                  <SwitchSetting
                    settingId="glass-headers"
                    title="Glassmorphic Sticky Headers"
                    description="Translucent, blurred backdrop for grid headers."
                    value={glassmorphicHeaders}
                    onChange={setGlassmorphicHeaders}
                  />
                  <SwitchSetting
                    settingId="grid-animations"
                    title="Micro-Animations"
                    description="Subtle transition effects on row hover."
                    value={gridAnimations}
                    onChange={setGridAnimations}
                  />
                  <SwitchSetting
                    settingId="sleek-selection"
                    title="Sleek Selection States"
                    description="Subtle box-shadow glow for selected cells and rows."
                    value={sleekSelection}
                    onChange={setSleekSelection}
                  />
                </div>

                <div className="space-y-4 pt-4">
                  <h3 className="text-sm font-medium">
                    Data Grid - Smart Cell Visualizations
                  </h3>

                  <SwitchSetting
                    settingId="colorized-pills"
                    title="Colorized Pills"
                    description="Render Booleans and Enums as elegant, colored pills."
                    value={colorizedPills}
                    onChange={setColorizedPills}
                  />
                  <SwitchSetting
                    settingId="relative-dates"
                    title="Relative Dates"
                    description="Format dates into a more readable relative format."
                    value={relativeDates}
                    onChange={setRelativeDates}
                  />
                  <SwitchSetting
                    settingId="json-inspector"
                    title="Rich JSON Inspector"
                    description="Formatted mini-pill for JSON objects with tooltip."
                    value={richJsonInspector}
                    onChange={setRichJsonInspector}
                  />
                  <SwitchSetting
                    settingId="data-bars"
                    title="Data Bars"
                    description="Inline background progress bar for numeric columns."
                    value={dataBars}
                    onChange={setDataBars}
                  />
                </div>

                <div className="space-y-4 pt-4">
                  <h3 className="text-sm font-medium">
                    Data Grid - Empty States & Loading Polish
                  </h3>

                  <SwitchSetting
                    settingId="skeleton-loaders"
                    title="Skeleton Loaders"
                    description="Animated skeleton rows during data loading."
                    value={skeletonLoaders}
                    onChange={setSkeletonLoaders}
                  />
                </div>

                <div className="space-y-4 pt-4">
                  <h3 className="text-sm font-medium">Schema Explorer</h3>

                  <SwitchSetting
                    settingId="schema-explorer"
                    title="Enable Schema Explorer"
                    description="Show tables, functions, triggers, and indexes in a unified explorer with schema icon."
                    value={schemaExplorer}
                    onChange={setSchemaExplorer}
                  />
                </div>

                <div className="space-y-4 pt-4">
                  <h3 className="text-sm font-medium">Database Explorer</h3>

                  <SwitchSetting
                    settingId="database-explorer"
                    title="Enable Database Explorer"
                    description="Browse all schemas and object types (tables, functions, triggers, indexes, enums) in a hierarchical tree view."
                    value={databaseExplorer}
                    onChange={setDatabaseExplorer}
                  />

                  <SwitchSetting
                    settingId="table-expansion"
                    title="Enable Table Expansion"
                    description="Show expand/collapse arrows next to table names to view columns inline in the sidebar."
                    value={tableExpansion}
                    onChange={setTableExpansion}
                  />
                </div>

                <div className="space-y-4 pt-4">
                  <h3 className="text-sm font-medium">Tab Behavior</h3>

                  <SwitchSetting
                    settingId="preview-tabs"
                    title="Preview Tabs"
                    description="VS Code-style preview mode. Opening a table, snippet, or dashboard shows it in a temporary tab (italicized) that gets replaced when you open another item. Double-click a tab or pin it to keep it permanently."
                    value={previewTabs}
                    onChange={setPreviewTabs}
                  />
                </div>

                <div className="space-y-4 pt-4">
                  <h3 className="text-sm font-medium">Pane Behavior</h3>

                  <SwitchSetting
                    settingId="autoclose-pane"
                    title="Auto-close Empty Panes"
                    description="Automatically close a split pane when its last tab is closed."
                    value={autoClosePane}
                    onChange={setAutoClosePane}
                  />
                  <SwitchSetting
                    settingId="confirm-sheet-close"
                    title="Confirm Unsaved Sheet Close"
                    description="Show a confirmation dialog when clicking outside a form sheet with unsaved changes."
                    value={confirmSheetClose}
                    onChange={setConfirmSheetClose}
                  />
                </div>
              </div>

              <div className="space-y-1 mt-8">
                <h3 className="text-sm font-medium">System Configuration</h3>
              </div>

              <div
                data-setting-id="sql-engine"
                className="space-y-2.5 border-t border-border py-3"
              >
                <SqlEditorEngineSetting
                  onChange={setSqlEditorEngine}
                  value={sqlEditorEngine}
                />
              </div>

              <SwitchSetting
                settingId="rls-tab-editor"
                title="Open RLS Policies in Tab"
                description="Edit and create Row-Level Security policies in an editor tab instead of a side sheet."
                value={rlsPolicyTabEditor}
                onChange={setRlsPolicyTabEditor}
              />

              <div data-setting-id="app-updates" className="space-y-2.5">
                <div className="flex flex-col">
                  <span className="font-medium text-xs">App Updates</span>
                  <span className="text-xs text-muted-foreground">
                    Current version: {updateState.currentVersion || "Unknown"}
                    {updateState.latestVersion
                      ? ` • Latest: ${updateState.latestVersion}`
                      : ""}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={handleCheckUpdates}
                    disabled={
                      updateState.checking ||
                      updateState.downloading ||
                      installingUpdate
                    }
                    className="h-7 rounded-lg border border-border bg-secondary/40 px-2.5 text-xs font-medium text-foreground hover:bg-secondary/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updateState.checking
                      ? "Checking..."
                      : "Check for Updates"}
                  </button>
                  <button
                    onClick={handleDownloadUpdate}
                    disabled={
                      !updateState.updateAvailable ||
                      updateState.downloading ||
                      updateState.updateDownloaded ||
                      installingUpdate
                    }
                    className="h-7 rounded-lg border border-border bg-secondary/40 px-2.5 text-xs font-medium text-foreground hover:bg-secondary/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updateState.downloading
                      ? `Downloading${typeof updateState.progressPercent === "number" ? ` ${Math.round(updateState.progressPercent)}%` : "..."}`
                      : updateState.updateDownloaded
                        ? "Downloaded"
                        : "Download Update"}
                  </button>
                  <button
                    onClick={handleInstallUpdate}
                    disabled={
                      !updateState.updateDownloaded || installingUpdate
                    }
                    className="h-7 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {installingUpdate
                      ? "Installing..."
                      : "Install and Restart"}
                  </button>
                </div>
                {!updateState.enabled ? (
                  <p className="text-xs text-muted-foreground">
                    Automatic updates are not configured for this build.
                  </p>
                ) : null}
                {updateState.error ? (
                  <p className="text-xs text-red-500">{updateState.error}</p>
                ) : null}
              </div>

              <div data-setting-id="command-menu" className="space-y-1 mt-8">
                <h3 className="text-sm font-medium">
                  Command Menu Customization
                </h3>
                <p className="text-xs text-muted-foreground">
                  Drag to reorder or click the eye icon to show/hide sections in
                  the command menu (⌘K).
                </p>
              </div>

              <div className="space-y-1.5 border-t border-border pt-3">
                {commandMenuSections.map((section, index: number) => (
                  <div
                    key={section.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, index)}
                    className={cn(
                      "flex items-center justify-between rounded-lg border p-2.5 group cursor-default transition-all duration-200",
                      draggedIndex === index
                        ? "bg-blue-500/10 border-blue-500/50 scale-[1.02] shadow-lg z-10"
                        : !section.isVisible
                          ? "bg-secondary/10 border-border/40 opacity-60"
                          : "bg-secondary/30 border-border hover:bg-secondary/50",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <GripVertical
                        className={cn(
                          "w-4 h-4 transition-colors",
                          draggedIndex === index
                            ? "text-blue-500"
                            : "text-muted-foreground/30 group-hover:text-muted-foreground/60 cursor-grab active:cursor-grabbing",
                        )}
                      />
                      <span
                        className={cn(
                          "text-xs font-medium transition-all duration-200",
                          draggedIndex === index
                            ? "text-blue-500"
                            : !section.isVisible
                              ? "text-muted-foreground line-through"
                              : "text-foreground",
                        )}
                      >
                        {section.name}
                      </span>
                    </div>
                    <button
                      onClick={() => toggleSectionVisibility(section.id)}
                      className={cn(
                        "p-1 rounded hover:bg-muted transition-colors",
                        section.isVisible
                          ? "text-foreground/70"
                          : "text-muted-foreground",
                      )}
                    >
                      <Eye
                        className={cn(
                          "w-4 h-4",
                          !section.isVisible && "opacity-50",
                        )}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <ThemeAddDialog
        open={isEditorThemeDialogOpen}
        onOpenChange={(open) => {
          setIsEditorThemeDialogOpen(open);
          if (!open) resetThemeDialog();
        }}
        title="Add Custom Editor Theme"
        description="Paste a VS Code theme JSON (colors + tokenColors) or a Monaco theme definition."
        nameValue={themeNameInput}
        onNameChange={setThemeNameInput}
        jsonValue={themeJsonInput}
        onJsonChange={setThemeJsonInput}
        jsonPlaceholder="Paste theme JSON here"
        fileName={themeFileName}
        onFileUpload={handleThemeFileUpload}
        onCancel={() => setIsEditorThemeDialogOpen(false)}
        onAdd={handleAddEditorTheme}
        dialogPos={themeDialogPos}
        onDialogHeaderMouseDown={handleDialogHeaderMouseDown}
      />
    </div>
  );
}
