"use client";

import { StudioInterface } from "@/components/studio/studio-interface";
import { InitialLoadingScreen } from "@/components/studio/initial-loading-screen";
import { useStudioBootstrap } from "@/hooks/use-studio-bootstrap";
import { useStudioTitle } from "@/hooks/use-studio-title";
import { useGlobalAppTheme } from "@/hooks/use-global-app-theme";
import { useSearchParams } from "next/navigation";

type StudioClientProps = { connectionId?: number };

// Boots the studio for the connection given as a prop or as the ?id= query parameter.
export default function StudioClient({ connectionId }: StudioClientProps) {
  const searchParams = useSearchParams();
  const numericId = connectionId ?? Number(searchParams?.get("id") || "");

  const { loading, connection, initialUiState } = useStudioBootstrap(
    Number.isInteger(numericId) && numericId > 0 ? numericId : null,
    searchParams.get("s"),
  );

  useStudioTitle(connection, loading);
  useGlobalAppTheme(false);

  if (loading) return <InitialLoadingScreen />;
  if (!connection) return <main className="min-h-screen p-6">Connection not found.</main>;

  return <StudioInterface connection={connection} initialUiState={initialUiState} />;
}
