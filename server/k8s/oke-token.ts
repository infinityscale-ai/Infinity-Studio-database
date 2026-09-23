import { signingIdentity } from "../oci/api";
import type { OciCredentialProfile } from "../oci/profiles";
import { signRequest } from "../oci/signer";

/** How long OKE accepts a minted token; the OCI CLI uses the same window. */
export const OKE_TOKEN_TTL_MS = 4 * 60_000;

// clusterRequestUrl is the URL OKE authenticates a Kubernetes request against.
export function clusterRequestUrl(region: string, clusterId: string, domain = "oraclecloud.com"): string {
  return `https://containerengine.${region}.${domain}/cluster_request/${clusterId}`;
}

// urlSafeBase64 encodes the way Python's urlsafe_b64encode does, padding included, which is what OKE decodes.
export function urlSafeBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

// buildOkeToken turns a signed request into the bearer token OKE expects: the presigned URL, base64url encoded.
export function buildOkeToken(url: string, authorization: string, date: string): string {
  const presigned = new URL(url);
  presigned.searchParams.set("authorization", authorization);
  presigned.searchParams.set("date", date);
  return urlSafeBase64(presigned.toString());
}

// mintOkeToken signs a request for one cluster and returns the Kubernetes bearer token it yields.
export function mintOkeToken(profile: OciCredentialProfile, clusterId: string, domain?: string): string {
  const url = clusterRequestUrl(profile.region, clusterId, domain);
  const headers = signRequest({ method: "GET", url: new URL(url), body: null }, signingIdentity(profile));
  return buildOkeToken(url, headers.authorization, headers.date);
}
