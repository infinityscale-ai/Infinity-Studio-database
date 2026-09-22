import { useCallback, useEffect, useRef } from "react";
import { API_BASE } from "@/lib/api-base";

interface UseStudioPersistenceProps {
  connectionId: number;
}

export function useStudioPersistence({ connectionId }: UseStudioPersistenceProps) {
  const studioSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastStudioSaveSignatureRef = useRef(new Map<string, string>());
  const pendingSavesRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: BeforeUnloadEvent) => {
      if (pendingSavesRef.current > 0) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const getSignature = useCallback((payload: unknown) => {
    try {
      return JSON.stringify(payload);
    } catch {
      return String(payload);
    }
  }, []);

  const queueStudioSave = useCallback((endpoint: string, payload: unknown, label: string, overrideConnectionId?: number) => {
    const capturedConnectionId = overrideConnectionId ?? connectionId;
    const signatureKey = `${capturedConnectionId}:${endpoint}`;
    const nextSignature = getSignature(payload);

    if (lastStudioSaveSignatureRef.current.get(signatureKey) === nextSignature) {
      return;
    }

    lastStudioSaveSignatureRef.current.set(signatureKey, nextSignature);
    pendingSavesRef.current++;

    studioSaveQueueRef.current = studioSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const response = await fetch(`${API_BASE}/studio/${capturedConnectionId}/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || body?.success === false) {
          console.error(`[rexadb] Failed to save ${label} for connection ${capturedConnectionId}:`, body?.error);
        }
      })
      .catch((error) => {
        console.error(`[rexadb] Unexpected error saving studio ${label}:`, error);
      })
      .finally(() => {
        pendingSavesRef.current--;
      });
  }, [connectionId, getSignature]);

  return { queueStudioSave };
}
