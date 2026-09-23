import { isOciRouted } from "@/lib/discovery/saved-match";

/** Why a connection failed, as far as the error text lets the studio tell. */
export type FailureKind = "sign-in" | "kubectl" | "login-rejected" | "unknown";

/** What the failure dialog says: a title, one sentence, the steps to try, and a command to run when there is one. */
export type FailureAdvice = { kind: FailureKind; title: string; summary: string; steps: string[]; command: string | null };

/** The checklist shown when the error says nothing more specific. */
const GENERIC_STEPS = [
  "The database server is running and reachable.",
  "The host, port, database, username, and password are correct.",
  "Your network, VPN, SSH tunnel, or firewall is not blocking the connection.",
];

// commandIn pulls the command the server asked the user to run out of an error, if it named one.
export function commandIn(error: string): string | null {
  return /Run:\s*(oci session authenticate[^\n]*)/.exec(error)?.[1]?.trim() ?? null;
}

// rejectedUser reads which user the database refused, for MySQL and PostgreSQL wording; null when it was not a refused login.
export function rejectedUser(error: string): string | null {
  const mysql = /Access denied for user '([^']*)'@'[^']*' \(using password/.exec(error);
  if (mysql) return mysql[1];
  return /password authentication failed for user "([^"]*)"/.exec(error)?.[1] ?? null;
}

// loginAdvice explains a refused login, saying plainly that the route itself worked.
function loginAdvice(user: string, routed: boolean): FailureAdvice {
  if (!user) return { kind: "login-rejected", title: "A login is needed", summary: "The database answered and needs a user and password.", steps: ["Edit the connection and enter a user and password."], command: null };
  const summary = routed
    ? `The studio reached the database through your cluster and it answered: user "${user}" or its password is wrong. Oracle Cloud and the tunnel are working.`
    : `The database answered: user "${user}" or its password is wrong.`;
  const steps = routed
    ? ["Use the admin user and password chosen when this DB system was created. Oracle Cloud never shows that name, so it cannot be filled in for you.", "Or use any other database user of yours, such as the one your applications use.", "Edit the connection to change the user or password."]
    : ["Check the user and password.", "Edit the connection to change them."];
  return { kind: "login-rejected", title: "The database rejected this login", summary, steps, command: null };
}

// adviseOnFailure turns a connection error into what the user should do next.
export function adviseOnFailure(error: string, connectionString = ""): FailureAdvice {
  const user = rejectedUser(error);
  if (user !== null) return loginAdvice(user, isOciRouted(connectionString));
  const command = commandIn(error);
  if (command || /Oracle Cloud sign-in|No Oracle Cloud profile|session has probably expired/i.test(error)) {
    return { kind: "sign-in", title: "Sign in to Oracle Cloud", summary: "This connection goes through your Oracle Cloud account, and its sign-in on this computer is missing or has expired.", steps: ["Run the command below in a terminal on this computer; it opens your browser to sign in.", "Then open the connection again."], command };
  }
  if (/kubectl is not installed/i.test(error)) {
    return { kind: "kubectl", title: "kubectl is needed", summary: "This connection reaches the database through your Kubernetes cluster, and kubectl is not installed where the studio runs.", steps: ["Install kubectl, or use the studio's Docker image, which carries it."], command: null };
  }
  return { kind: "unknown", title: "Connection failed", summary: "", steps: GENERIC_STEPS, command: null };
}
