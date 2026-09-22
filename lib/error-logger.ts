"use client";

import { API_BASE } from "@/lib/api-base";

export interface ErrorLogPayload {
  errorType: string;
  message: string | null;
  stack: string | null;
  url: string | null;
  componentStack: string | null;
  metadata: Record<string, unknown>;
  appVersion: string | null;
  os: string | null;
}

const MAX_BODY_BYTES = 50_000;
const MAX_STACK_CHARS = 10_000;

// Posts a client error to the local sidecar log; never throws.
export async function logAppError(payload: ErrorLogPayload): Promise<void> {
  if (JSON.stringify(payload).length > MAX_BODY_BYTES) {
    console.warn("[error-logger] payload exceeds 50KB, truncating stack");
    payload.stack = payload.stack?.slice(0, MAX_STACK_CHARS) ?? null;
  }
  try {
    await fetch(`${API_BASE}/api/errors/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    console.error("[error-logger] failed to send error to server", payload.message);
  }
}
