import { useEffect, useRef } from "react";
import { type Snippet, type Folder, type DashboardWidgetType, type DashboardConditionOperator, type DashboardConditionActionType, type DashboardFolder, type Dashboard, type AgentGeneratedWidgetType, type AgentGeneratedWidgetPlan, type AgentDashboardPlan, type AgentChatMessage, type AgentChatHistoryMessage, type SchemaContextTable, type QueryValidationShapeResult, type SqlEditorEngine, type StudioSplitViewState } from "@/lib/studio/types";
import type { SidebarBehavior } from "@/lib/studio/sidebar-behavior";
import { saveKeybindingsFile } from "@/lib/api/actions-client";

interface UseStudioDataPersistenceProps {
  connectionId: number;
  isDataLoaded: boolean;
  queueStudioSave: (key: string, data: any, description: string) => void;
  snippets: Snippet[];
  folders: Folder[];
  openTabs: Array<{ id: string; type: 'table' | 'key' | 'sql' | 'create-table' | 'create-key' | 'create-enum' | 'create-index' | 'create-trigger' | 'create-schema' | 'create-database' | 'dashboard' | 'note' | 'import-export' | 'history' | 'analytics' | 'advisor' | 'workflow' | 'erd-designer' | 'database-schema' | 'database-tables' | 'database-catalog' | 'database-functions' | 'database-extensions' | 'database-triggers' | 'database-enums' | 'database-indexes' | 'database-rls-policies' | 'database-sessions' | 'database-locks' | 'database-explain-plan' | 'database-backup-restore' | 'database-spacetimedb-reducers' | 'database-spacetimedb-logs' | 'database-spacetimedb-schema' | 'rls-policy-edit' | 'auth-users' | 'auth-sessions' | 'auth-providers' | 'storage-files' | 'storage-settings' | 'storage-policies' | 'storage-bucket' | 'edge-functions' | 'edge-secrets' | 'edge-function' | 'settings' | 'agent-settings' | 'profile-settings' | 'keybindings' | 'snapshots' | 'snapshot-table' | 'diff-table' | 'browser' | 'extensions' | 'extension-view' | 'extension-panel'; name: string; schema?: string; query?: string }>;
  activeTabId: string | null;
  sidebarSortMode: 'alphabetical' | 'tags';
  sidebarView: 'dashboard' | 'tables' | 'sql' | 'database' | 'import-export' | 'auth' | 'storage' | 'edge-functions' | 'themes' | 'workflows' | 'agents' | 'erd' | 'notes';
  sidebarBehavior: SidebarBehavior;
  keybindings: Record<string, any>;
  searchSettings: any;
  splitView: StudioSplitViewState;
  tags: Array<{ name: string; color: string }>;
  tableTags: Record<string, string[]>;
}

export function useStudioDataPersistence({
  connectionId,
  isDataLoaded,
  queueStudioSave,
  snippets,
  folders,
  openTabs,
  activeTabId,
  sidebarSortMode,
  sidebarView,
  sidebarBehavior,
  keybindings,
  searchSettings,
  splitView,
    tags,
    tableTags,
}: UseStudioDataPersistenceProps) {
  const snippetsDidMountRef = useRef(false);
  const dedupeById = <T extends { id: string }>(items: T[]) =>
    Array.from(new Map(items.map((item) => [item.id, item])).values());

  const foldersDidMountRef = useRef(false);
  useEffect(() => {
    if (!isDataLoaded) return;
    if (foldersDidMountRef.current) {
      const dedupedFolders = dedupeById(
        folders.map(f => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId,
          createdAt: f.createdAt
        }))
      );
      queueStudioSave("folders", dedupedFolders, "folders");
    } else {
      foldersDidMountRef.current = true;
    }
  }, [folders, queueStudioSave, isDataLoaded]);

  useEffect(() => {
    if (!isDataLoaded) return;
    if (snippetsDidMountRef.current) {
      const dedupedSnippets = dedupeById(
        snippets.map(s => ({
          id: s.id,
          name: s.name,
          query: s.query,
          folderId: s.folderId,
          createdAt: s.createdAt,
          isShared: Boolean(s.isShared)
        }))
      );
      queueStudioSave("snippets", dedupedSnippets, "snippets");
    } else {
      snippetsDidMountRef.current = true;
    }
  }, [snippets, queueStudioSave, isDataLoaded]);

  const tabsDidMountRef = useRef(false);
  const tabsSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isDataLoaded) return;
    if (tabsDidMountRef.current) {
      if (tabsSaveTimeoutRef.current) clearTimeout(tabsSaveTimeoutRef.current);
      tabsSaveTimeoutRef.current = setTimeout(() => {
        queueStudioSave("tabs", openTabs.map((t, index) => ({
          id: t.id,
          type: t.type,
          name: t.name,
          schema: t.schema,
          query: t.query,
          order: index
        })), "tabs");
      }, 1000);
    } else {
      tabsDidMountRef.current = true;
    }
    return () => {
      if (tabsSaveTimeoutRef.current) clearTimeout(tabsSaveTimeoutRef.current);
    };
  }, [openTabs, queueStudioSave, isDataLoaded]);

  const settingsDidMountRef = useRef(false);
  useEffect(() => {
    if (!isDataLoaded) return;
    if (settingsDidMountRef.current) {
      queueStudioSave("settings", {
        activeTabId,
        sidebarSortMode,
        sidebarView,
        sidebarBehavior,
        searchSettings: JSON.stringify(searchSettings),
        splitView: JSON.stringify(splitView),
      }, "settings");
    } else {
      settingsDidMountRef.current = true;
    }
  }, [activeTabId, sidebarSortMode, sidebarView, sidebarBehavior, searchSettings, splitView, queueStudioSave, isDataLoaded]);

  // Keybindings are a global preference, saved to keybindings.json rather
  // than per-connection SQLite settings — see lib/db/keybindings-store.ts.
  const keybindingsDidMountRef = useRef(false);
  useEffect(() => {
    if (!isDataLoaded) return;
    if (keybindingsDidMountRef.current) {
      void saveKeybindingsFile(keybindings);
    } else {
      keybindingsDidMountRef.current = true;
    }
  }, [keybindings, isDataLoaded]);

  const tagsDidMountRef = useRef(false);
  useEffect(() => {
    if (!isDataLoaded) return;
    if (tagsDidMountRef.current) {
      queueStudioSave("tags", tags.map(t => ({
        name: t.name,
        color: t.color
      })), "tags");
    } else {
      tagsDidMountRef.current = true;
    }
  }, [tags, queueStudioSave, isDataLoaded]);

  const tableTagsDidMountRef = useRef(false);
  useEffect(() => {
    if (!isDataLoaded) return;
    if (tableTagsDidMountRef.current) {
      queueStudioSave("table-tags", tableTags, "table tags");
    } else {
      tableTagsDidMountRef.current = true;
    }
  }, [tableTags, queueStudioSave, isDataLoaded]);
}
