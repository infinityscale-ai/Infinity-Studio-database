import { describe, expect, test } from "bun:test";
import { OciApiError, type OciClient } from "../../server/oci/api";
import type { OciCredentialProfile } from "../../server/oci/profiles";
import { mountOciRoutes, type OciRouteDeps } from "../../server/oci/routes";

type Handler = (req: unknown, res: unknown) => Promise<void>;
type Captured = { status: number; body: { success: boolean; error?: string; code?: string; data?: unknown } };

const PROFILE = { name: "laprophan", region: "af-casablanca-1", tenancy: "t", sessionAuth: true } as unknown as OciCredentialProfile;
const TYPED = { engine: "mysql", host: "10.0.10.56", port: 3306, database: "orderlink_prod", username: "ro", password: "pw" };

// mounted collects the route handlers mountOciRoutes registers, keyed by "METHOD path".
function mounted(deps: OciRouteDeps): Map<string, Handler> {
  const routes = new Map<string, Handler>();
  const app = {
    get: (path: string, h: Handler) => routes.set(`GET ${path}`, h),
    post: (path: string, h: Handler) => routes.set(`POST ${path}`, h),
  };
  mountOciRoutes(app as unknown as Parameters<typeof mountOciRoutes>[0], deps);
  return routes;
}

// call runs one handler with a JSON body and returns the status and body it answered.
async function call(handler: Handler, body: unknown): Promise<Captured> {
  const out: Captured = { status: 200, body: { success: false } };
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(b: Captured["body"]) {
      out.body = b;
    },
  };
  await handler({ body }, res);
  return out;
}

// depsWith builds route dependencies around one fake OCI client.
function depsWith(client: Partial<OciClient>): OciRouteDeps {
  return { profiles: () => [PROFILE], client: () => client as OciClient, cliBinary: () => null, kubectlBinary: () => "/usr/bin/kubectl" };
}

describe("POST /api/oci/address", () => {
  test("an expired Oracle sign-in answers 409 with the command, never the 401 that locks the studio behind its access key", async () => {
    const expired = new OciApiError("session-expired", "Oracle Cloud rejected the sign-in. Run: oci session authenticate --profile-name laprophan --region af-casablanca-1", 401);
    const route = mounted(depsWith({ search: async () => Promise.reject(expired) })).get("POST /api/oci/address")!;
    const answer = await call(route, TYPED);
    expect(answer.status).toBe(409);
    expect(answer.body.code).toBe("oci_session_expired");
    expect(answer.body.error).toContain("oci session authenticate");
  });
  test("a host that is not a private IPv4 address is refused before Oracle Cloud is asked anything", async () => {
    let asked = false;
    const route = mounted(depsWith({ search: async () => ((asked = true), []) })).get("POST /api/oci/address")!;
    const answer = await call(route, { ...TYPED, host: "orderlink.internal" });
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe("oci_host_invalid");
    expect(asked).toBe(false);
  });
  test("the panel-era routes are gone", () => {
    const routes = mounted(depsWith({}));
    expect([...routes.keys()].sort()).toEqual(["GET /api/oci/status", "POST /api/oci/address"]);
  });
});
