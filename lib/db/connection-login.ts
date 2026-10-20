/** The login a connection string carries, decoded. */
export type ConnectionLogin = { username: string; password: string };

// loginOf reads the user and password out of a URL-style connection string; empty when it has none or is not a URL.
export function loginOf(connectionString: string): ConnectionLogin {
  try {
    const url = new URL(connectionString);
    return { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
  } catch {
    return { username: "", password: "" };
  }
}

// withLogin returns the connection string with this user and password, everything else (host, database, route) unchanged.
export function withLogin(connectionString: string, login: ConnectionLogin): string {
  const url = new URL(connectionString);
  url.username = encodeURIComponent(login.username.trim());
  url.password = login.password ? encodeURIComponent(login.password) : "";
  return url.toString();
}
