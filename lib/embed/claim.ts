// The claim step of the embed boot: the console's single-use token becomes this tab's session.
import { apiFetch } from "@/lib/api-base";
import { parseEmbedSession, type EmbedSessionInfo } from "./session";

export type EmbedEndReason =
  | "missing"
  | "expired"
  | "token_used"
  | "token_expired"
  | "rate_limited"
  | "revoked"
  | "unreachable"
  | "rejected";

export type ClaimOutcome = { ok: true; session: EmbedSessionInfo } | { ok: false; reason: EmbedEndReason };
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

type ClaimEnvelope = { success?: unknown; data?: unknown; error?: unknown };

const CLAIM_REASONS: ReadonlySet<EmbedEndReason> = new Set(["token_used", "token_expired", "rate_limited"]);

// Reads the `s` token out of a URL fragment such as `#s=tok_…`, or null when there is none.
export function readTokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const token = params.get("s")?.trim();
  return token ? token : null;
}

// Maps a claim failure to the reason the page reports.
export function reasonFromClaimError(status: number, error: unknown): EmbedEndReason {
  if (typeof error === "string" && CLAIM_REASONS.has(error as EmbedEndReason)) return error as EmbedEndReason;
  return status === 0 ? "unreachable" : "rejected";
}

// Builds the tab session from a successful claim payload, or null when the payload is malformed.
export function sessionFromClaim(data: unknown, token: string): EmbedSessionInfo | null {
  if (typeof data !== "object" || data === null) return null;
  const { session, ...rest } = data as Record<string, unknown>;
  return parseEmbedSession({ ...rest, bearer: session, claimedToken: token });
}

// Exchanges the token for a session over the claim route; every failure is a typed reason, never a throw.
export async function claimEmbedSession(token: string, fetcher: Fetcher = apiFetch): Promise<ClaimOutcome> {
  let res: Response;
  try {
    res = await fetcher("/api/embed/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  const body = (await res.json().catch(() => null)) as ClaimEnvelope | null;
  if (!res.ok || body?.success !== true) return { ok: false, reason: reasonFromClaimError(res.status, body?.error) };
  const session = sessionFromClaim(body.data, token);
  return session ? { ok: true, session } : { ok: false, reason: "rejected" };
}

// The one line under "This session has ended." for each reason.
export function describeEmbedEnd(reason: EmbedEndReason): string {
  switch (reason) {
    case "missing":
      return "No session was provided for this page.";
    case "expired":
      return "The session reached its time limit.";
    case "token_used":
      return "This link was already used to open the studio.";
    case "token_expired":
      return "This link expired before it was opened.";
    case "rate_limited":
      return "Too many attempts to open the studio; wait a minute and try again.";
    case "revoked":
      return "The server closed the session: it expired, was revoked, or the database rejected its credentials.";
    case "unreachable":
      return "The studio server could not be reached.";
    case "rejected":
      return "The studio server did not accept the session.";
  }
}
