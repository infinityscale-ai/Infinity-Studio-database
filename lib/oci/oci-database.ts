/** Marks a saved connection with the Oracle Cloud database it came from, so the list can tell it is already saved. */
export const OCI_DATABASE_PARAM = "infstudio_oci_db";

/** The OCI database services the studio can reach through the user's own cluster. */
export type OciDatabaseKind = "mysql" | "postgres" | "autonomous";

/** One database found in the tenancy by Resource Search. */
export type OciDatabaseSummary = { id: string; kind: OciDatabaseKind; name: string; state: string; compartmentId: string };

/** Where a database's private endpoint lives and how to log in to it. */
export type OciDatabaseTarget = OciDatabaseSummary & {
  engine: "mysql" | "postgres" | "oracle";
  privateIp: string;
  port: number;
  subnetId: string;
  vcnId: string;
  adminUser: string;
  dbName: string;
  version: string;
};

/** A profile from the user's ~/.oci/config. */
export type OciProfile = { name: string; region: string; tenancy: string; sessionAuth: boolean };

/** A profile plus whether its session token is currently usable (null for API-key profiles). */
export type OciProfileStatus = OciProfile & { sessionValid: boolean | null; validUntil: string | null };

/** What the studio knows about the Oracle Cloud sign-in on this computer: the profiles, whether each session is live, and whether kubectl can run here. */
export type OciStatus = { configured: boolean; cliAvailable: boolean; kubectlAvailable: boolean; profiles: OciProfileStatus[] };

/** An Oracle Cloud database typed in like an app's .env: engine, private address, port and the login to use. */
export type OciAddressRequest = { engine: "mysql" | "postgres"; host: string; port: number; database: string; username: string; password: string };

/** The connection string that reaches a typed database through the user's own cluster, and what carries it. */
export type OciAddressResult = { connectionString: string; cluster: string; managedName: string | null };
