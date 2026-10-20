import { OciApiError } from "./api";
import { signInCommand, type OciCredentialProfile } from "./profiles";
import { isTokenLive, readSessionToken } from "./session-token";

/** Whether a profile's session token is usable right now, and until when. */
export type SessionValidity = { valid: boolean; until: string | null };

// sessionValidity reads the profile's token file; API-key profiles are always usable.
export function sessionValidity(profile: OciCredentialProfile): SessionValidity {
  if (!profile.sessionAuth) return { valid: true, until: null };
  const token = readSessionToken(profile.tokenFile);
  const until = token?.expiresAt ? new Date(token.expiresAt).toISOString().replace("T", " ").slice(0, 16) + " UTC" : null;
  return { valid: isTokenLive(token), until };
}

// requireLiveSession refuses to go on with an expired or missing sign-in, naming the command that fixes it.
export function requireLiveSession(profile: OciCredentialProfile): void {
  if (!profile.sessionAuth) return;
  const token = readSessionToken(profile.tokenFile);
  if (isTokenLive(token)) return;
  const state = token ? `has expired` : `is missing on this computer`;
  throw new OciApiError("not-signed-in", `Your Oracle Cloud sign-in for ${profile.name} ${state}. Run: ${signInCommand(profile)}`);
}
