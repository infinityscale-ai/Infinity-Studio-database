import { describe, expect, test } from "bun:test";
import { adviseOnFailure, commandIn, rejectedUser } from "../../../lib/db/connection-failure";

const ROUTED = "mysql://root:x@10.0.10.56:3306/?sslmode=require&infstudio_tls_verify=0&infstudio_oci_db=ocid1.mysqldbsystem.prod&infstudio_k8s_mode=k8s";
const LOCAL = "postgresql://postgres:x@127.0.0.1:5432/app";
const SIGN_IN = "Your Oracle Cloud sign-in for laprophan has expired. Run: oci session authenticate --profile-name laprophan --region af-casablanca-1";

describe("rejectedUser", () => {
  test("reads the refused user from MySQL and PostgreSQL wording", () => {
    expect(rejectedUser("Access denied for user 'root'@'10.0.10.91' (using password: YES)")).toBe("root");
    expect(rejectedUser('password authentication failed for user "admin"')).toBe("admin");
  });
  test("a user refused a database is not a wrong password", () => {
    expect(rejectedUser("Access denied for user 'app'@'%' to database 'shop'")).toBeNull();
  });
});

describe("adviseOnFailure", () => {
  test("a refused login through the cluster says the route worked and where the admin name comes from", () => {
    const advice = adviseOnFailure("Access denied for user 'root'@'10.0.10.91' (using password: YES)", ROUTED);
    expect(advice.kind).toBe("login-rejected");
    expect(advice.title).toBe("The database rejected this login");
    expect(advice.summary).toContain("through your cluster");
    expect(advice.summary).toContain('"root"');
    expect(advice.steps.join(" ")).toContain("chosen when this DB system was created");
    expect(advice.command).toBeNull();
  });

  test("a refused local login does not mention the cluster", () => {
    const advice = adviseOnFailure('password authentication failed for user "postgres"', LOCAL);
    expect(advice.kind).toBe("login-rejected");
    expect(advice.summary).not.toContain("cluster");
  });

  test("no user at all says a login is needed rather than naming an empty user", () => {
    const advice = adviseOnFailure("Access denied for user ''@'172.17.0.1' (using password: NO)", "mysql://127.0.0.1:3306");
    expect(advice.kind).toBe("login-rejected");
    expect(advice.summary).toBe("The database answered and needs a login.");
  });

  test("an expired Oracle sign-in names the exact command to run", () => {
    const advice = adviseOnFailure(SIGN_IN, ROUTED);
    expect(advice.kind).toBe("sign-in");
    expect(advice.title).toBe("Sign in to Oracle Cloud");
    expect(advice.command).toBe("oci session authenticate --profile-name laprophan --region af-casablanca-1");
    expect(commandIn(`Oracle Cloud rejected the sign-in; the session has probably expired. Run: oci session authenticate --profile-name p --region r`)).toBe("oci session authenticate --profile-name p --region r");
  });

  test("a missing kubectl is said as such", () => {
    expect(adviseOnFailure("kubectl is not installed where the studio runs, so it cannot open a tunnel into your cluster.", ROUTED).kind).toBe("kubectl");
  });

  test("anything else keeps the general checklist", () => {
    const advice = adviseOnFailure("connect ETIMEDOUT 10.1.2.3:5432", LOCAL);
    expect(advice.kind).toBe("unknown");
    expect(advice.steps).toHaveLength(3);
  });
});

describe("a database that wants a login it was not given", () => {
  test("Redis, MongoDB and PostgreSQL wording all ask for a login", () => {
    for (const error of ["NOAUTH Authentication required.", "MongoServerError: Authentication failed.", "no PostgreSQL user name specified in startup packet"]) {
      const advice = adviseOnFailure(error, LOCAL);
      expect(advice.kind).toBe("login-rejected");
      expect(advice.title).toBe("A login is needed");
    }
  });
});
