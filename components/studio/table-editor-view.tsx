"use client";

import { DataTableToolbar } from "./data-table-toolbar";
import { DataGridAg as DataGrid } from "./data-grid-ag";
import { PendingChangesBanner } from "./pending-changes-banner";
import { GridLoadingSkeleton } from "./grid-glide/grid-loading-skeleton";
import { useState, type ComponentProps } from "react";

type TableEditorViewProps = {
  toolbarProps: ComponentProps<typeof DataTableToolbar>;
  gridProps: ComponentProps<typeof DataGrid>;
  showPendingChangesBanner?: boolean;
  onOpenReviewPanel?: () => void;
};

export function TableEditorView({ toolbarProps, gridProps, showPendingChangesBanner = true, onOpenReviewPanel }: TableEditorViewProps) {
  const isLoading = toolbarProps.loading || toolbarProps.fetchingStructure;
  // The table whose rows the grid last finished showing; opening a different one draws the skeleton, refreshing the same one keeps the rows.
  const currentTable = gridProps.selectedTable ?? null;
  const [loadedTable, setLoadedTable] = useState<string | null>(null);
  if (!isLoading && loadedTable !== currentTable) setLoadedTable(currentTable);
  const switchingTable = isLoading && currentTable !== loadedTable;
  const useSkeleton = isLoading && (switchingTable || gridProps.skeletonLoaders);

  const pendingChanges = (gridProps as any).pendingChanges;
  const pendingActions = (gridProps as any).pendingActions;
  const pendingChangesCount = pendingChanges ? Object.keys(pendingChanges).length : 0;
  const pendingActionsCount = pendingActions ? pendingActions.length : 0;
  const hasPendingItems = pendingChangesCount > 0 || pendingActionsCount > 0;
  const showBanner = showPendingChangesBanner && hasPendingItems;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-studio-bg">
      <DataTableToolbar {...toolbarProps} />
      {showBanner && (
        <PendingChangesBanner
          pendingChangesCount={pendingChangesCount}
          pendingActionsCount={pendingActionsCount}
          onReview={() => onOpenReviewPanel?.()}
        />
      )}
      <div className="w-full bg-transparent overflow-hidden shrink-0 relative">
        {isLoading && !useSkeleton ? (
          <div className="h-[2px] w-full relative">
            <div className="absolute inset-0 overflow-hidden">
              <div
                className="h-full w-full bg-gradient-to-r from-transparent via-blue-500/40 via-blue-400 via-blue-500/40 to-transparent animate-progress-beam"
                style={{ width: "100%" }}
              />
            </div>
          </div>
        ) : (
          <div className="h-0" />
        )}
      </div>
      
      {useSkeleton ? (
        <GridLoadingSkeleton tableName={gridProps.selectedTable} />
      ) : (
        <DataGrid {...gridProps} />
      )}
    </div>
  );
}
