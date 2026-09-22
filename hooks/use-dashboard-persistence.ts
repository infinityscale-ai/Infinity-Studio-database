import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { Dashboard, DashboardFolder } from "@/lib/studio/types";
import { normalizeDashboards, normalizeDashboardFolders } from "@/lib/studio/dashboard-utils";
import { getStudioDashboards, saveStudioDashboards } from "@/lib/api/actions-client";
interface UseDashboardPersistenceProps {
  connectionId: number;
  setDashboards: Dispatch<SetStateAction<Dashboard[]>>;
  setDashboardFolders: Dispatch<SetStateAction<DashboardFolder[]>>;
  dashboards: Dashboard[];
  dashboardFolders: DashboardFolder[];
}

function normalizeDashboardsAndFolders(
  rawDashboards: any[], rawFolders: any[],
  setDashboards: Dispatch<SetStateAction<Dashboard[]>>,
  setDashboardFolders: Dispatch<SetStateAction<DashboardFolder[]>>,
) {
  const normalized = normalizeDashboards(rawDashboards);
  const normalizedFolders = normalizeDashboardFolders(rawFolders);
  setDashboardFolders(normalizedFolders);
  setDashboards(normalized);
  return true;
}

export function useDashboardPersistence({
  connectionId,
  setDashboards,
  setDashboardFolders,
  dashboards,
  dashboardFolders,
}: UseDashboardPersistenceProps) {
  const hasLoadedLocalRef = useRef(false);
  const lastSqliteSnapshotRef = useRef<string | null>(null);

  const loadLocalDashboards = useCallback(async () => {
    hasLoadedLocalRef.current = false;
    try {
      const stored = await getStudioDashboards(connectionId).catch(() => null);
      const payload = stored?.success ? stored.data : null;
      const rawDashboards = Array.isArray(payload?.dashboards) ? payload.dashboards : [];
      const rawFolders = Array.isArray(payload?.folders) ? payload.folders : [];

      if (rawDashboards.length > 0 || rawFolders.length > 0) {
        const snapshot = JSON.stringify({ dashboards: rawDashboards, folders: rawFolders });
        if (snapshot === lastSqliteSnapshotRef.current) {
          return true;
        }
        lastSqliteSnapshotRef.current = snapshot;
        normalizeDashboardsAndFolders(rawDashboards, rawFolders, setDashboards, setDashboardFolders);
        return true;
      }

      const storageKey = `rexa-db-dashboards-${connectionId}`;
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          const rawDashboards = Array.isArray(parsed) ? parsed : parsed?.dashboards;
          const rawFolders = Array.isArray(parsed?.folders) ? parsed.folders : [];

          if (Array.isArray(rawDashboards) && rawDashboards.length > 0) {
            normalizeDashboardsAndFolders(rawDashboards, rawFolders, setDashboards, setDashboardFolders);
            return true;
          }
        }
      } catch (error) {
        console.error("Failed to load dashboards from local storage:", error);
      }

      setDashboards([]);
      setDashboardFolders([]);
      return false;
    } finally {
      hasLoadedLocalRef.current = true;
    }
  }, [connectionId, setDashboards, setDashboardFolders]);

  // Load dashboards from local storage and SQLite
  useEffect(() => {
    void loadLocalDashboards();
  }, [loadLocalDashboards]);

  // Save dashboards to local storage
  useEffect(() => {
    if (!hasLoadedLocalRef.current) return;

    // Always save to local SQLite + localStorage
    const payload = { dashboards, folders: dashboardFolders };
    void saveStudioDashboards(connectionId, payload);
    lastSqliteSnapshotRef.current = JSON.stringify(payload);
    const storageKey = `rexa-db-dashboards-${connectionId}`;
    localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [dashboards, dashboardFolders, connectionId]);
}
