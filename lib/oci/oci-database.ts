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

/** The Kubernetes cluster that will carry the connection into the database's private network. */
export type OciCarrierCluster = { id: string; name: string; publicEndpoint: string };

/** A profile from the user's ~/.oci/config. */
export type OciProfile = { name: string; region: string; tenancy: string; sessionAuth: boolean };

/** What the connection form receives once the route into the database is settled. */
export type OciTunnelResult = { connectionString: string; target: OciDatabaseTarget; cluster: OciCarrierCluster; namespace: string };

/** A profile plus whether its session token is currently usable (null for API-key profiles). */
export type OciProfileStatus = OciProfile & { sessionValid: boolean | null; validUntil: string | null };

/** What the OCI panel learns before listing anything: sign-in files found, whether the browser sign-in and kubectl can run here, and the profiles. */
export type OciStatus = { configured: boolean; cliAvailable: boolean; kubectlAvailable: boolean; profiles: OciProfileStatus[] };

/** What the panel sends to save a connection that goes through the user's own cluster. */
export type OciConnectRequest = { profile: string; database: OciDatabaseSummary; login: { username: string; password: string; database: string } };

/** What the panel gets back when it asks how a database would be reached. */
export type OciRouteAnswer = { target: OciDatabaseTarget; cluster: OciCarrierCluster | null };
