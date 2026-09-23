/** The OCI database services the studio can reach through a bastion. */
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

/** A bastion the studio can open port-forwarding sessions on. */
export type OciBastion = { id: string; name: string; state: string; vcnId: string; subnetId: string; compartmentId: string };

/** A profile from the user's ~/.oci/config. */
export type OciProfile = { name: string; region: string; tenancy: string; sessionAuth: boolean };

/** What the connection form receives once a bastion session is open. */
export type OciTunnelResult = { connectionString: string; expiresAt: number; sessionId: string; target: OciDatabaseTarget };

/** A profile plus whether its session token is currently usable (null for API-key profiles). */
export type OciProfileStatus = OciProfile & { sessionValid: boolean | null; validUntil: string | null };

/** What the OCI panel learns about this machine before listing anything. */
export type OciStatus = { installed: boolean; profiles: OciProfileStatus[] };

/** What the panel sends to open a connection through a bastion. */
export type OciConnectRequest = { profile: string; database: OciDatabaseSummary; login: { username: string; password: string; database: string } };

/** What the panel gets back when a bastion is looked up or created for a database. */
export type OciBastionAnswer = { target: OciDatabaseTarget; bastion: OciBastion | null };
