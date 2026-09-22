import { parseSupabaseMgmtConnectionString } from "@/lib/db/supabase-mgmt-client";
import { getMgmtAccounts } from "@/lib/supabase-mgmt/token-store";

export interface SupabaseProjectConnection {
  /** supabase-mgmt connections carry their embedded token */
  kind: "mgmt" | "postgres";
  projectRef: string;
  /** embedded token for mgmt connections; null until resolved for postgres */
  token: string | null;
}

// Extracts the project ref from a direct `db.<ref>.supabase.co` Postgres URL, or null.
export function inferSupabaseRefFromPostgresUrl(
  connectionString: string,
): string | null {
  try {
    const url = new URL(connectionString.trim());
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      return null;
    }
    const host = url.hostname.toLowerCase();
    const match = host.match(/^db\.([a-z0-9-]{1,64})\.supabase\.co$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

// Resolves which Supabase project a connection targets, or null for other engines.
export function resolveSupabaseProjectConnection(
  connectionType: string | undefined,
  connectionString: string | undefined,
): SupabaseProjectConnection | null {
  if (!connectionString) return null;
  if (connectionType === "supabase-mgmt") {
    const parsed = parseSupabaseMgmtConnectionString(connectionString);
    if (!parsed) return null;
    return { kind: "mgmt", projectRef: parsed.projectRef, token: parsed.token };
  }
  if (connectionType === "postgres" || connectionType === "postgresql") {
    const ref = inferSupabaseRefFromPostgresUrl(connectionString);
    if (!ref) return null;
    return { kind: "postgres", projectRef: ref, token: null };
  }
  return null;
}

const tokenCache = new Map<string, string>();

// Finds a linked Management API token that can see `ref`, cached per ref; null when none can.
export async function resolveMgmtTokenForRef(
  ref: string,
  listProjects: (token: string) => Promise<Array<{ ref: string }>>,
): Promise<string | null> {
  const cached = tokenCache.get(ref);
  if (cached) return cached;
  let accounts: Array<{ token: string }> = [];
  try {
    accounts = getMgmtAccounts();
  } catch {
    accounts = [];
  }
  for (const account of accounts) {
    try {
      const projects = await listProjects(account.token);
      if (Array.isArray(projects) && projects.some((p) => p?.ref === ref)) {
        tokenCache.set(ref, account.token);
        return account.token;
      }
    } catch {
      // invalid/expired token or missing scope — try the next account
    }
  }
  return null;
}

// Forgets every cached token, e.g. after an account is unlinked.
export function clearMgmtTokenCache(): void {
  tokenCache.clear();
}
