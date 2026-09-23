import http from "node:http";

/** One Docker Engine API record. */
export type EngineRecord = Record<string, unknown>;

/** The two Engine API calls the detector needs; injected so tests never touch a socket. */
export type DockerEngine = { listRunning: () => Promise<string[]>; inspect: (id: string) => Promise<EngineRecord> };

/** Why the engine could not be asked, in terms the UI can explain. */
export type DockerEngineErrorKind = "unavailable" | "forbidden" | "failed";

/** How to reach the engine: a unix socket, or a TCP host and port from DOCKER_HOST. */
export type EngineAddress = { socketPath: string } | { host: string; port: number };

const DEFAULT_SOCKET = "/var/run/docker.sock";
const REQUEST_TIMEOUT_MS = 5000;

// DockerEngineError names why the engine could not be reached.
export class DockerEngineError extends Error {
  constructor(
    public readonly kind: DockerEngineErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "DockerEngineError";
  }
}

// engineAddress reads DOCKER_HOST (unix:// or tcp://), falling back to the default socket.
export function engineAddress(env: Record<string, string | undefined> = process.env): EngineAddress {
  const raw = env.DOCKER_HOST?.trim();
  if (!raw) return { socketPath: DEFAULT_SOCKET };
  if (raw.startsWith("unix://")) return { socketPath: raw.slice("unix://".length) || DEFAULT_SOCKET };
  const tcp = /^tcp:\/\/([^:/]+)(?::(\d+))?/.exec(raw);
  if (tcp) return { host: tcp[1], port: Number(tcp[2] || 2375) };
  return { socketPath: DEFAULT_SOCKET };
}

// classifyEngineFailure maps a socket error to what the user can do about it.
export function classifyEngineFailure(code: string | undefined): DockerEngineErrorKind {
  if (code === "ENOENT" || code === "ECONNREFUSED" || code === "ENOTFOUND") return "unavailable";
  if (code === "EACCES" || code === "EPERM") return "forbidden";
  return "failed";
}

// engineGet performs one GET against the Engine API and parses the JSON answer.
export function engineGet<T>(path: string, address: EngineAddress = engineAddress()): Promise<T> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = { method: "GET", path, timeout: REQUEST_TIMEOUT_MS, headers: { Host: "docker" }, ..."socketPath" in address ? { socketPath: address.socketPath } : { host: address.host, port: address.port } };
    const req = http.request(options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => {
        if ((res.statusCode ?? 500) >= 400) return reject(new DockerEngineError("failed", `Docker answered HTTP ${res.statusCode} for ${path}.`));
        try {
          resolve(JSON.parse(body) as T);
        } catch {
          reject(new DockerEngineError("failed", "Docker returned something that is not JSON."));
        }
      });
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    req.on("error", (err: NodeJS.ErrnoException) => {
      const kind = classifyEngineFailure(err.code);
      const message = kind === "forbidden" ? "The Docker socket is not readable by the studio." : kind === "unavailable" ? "Docker is not running here." : err.message;
      reject(new DockerEngineError(kind, message));
    });
    req.end();
  });
}

// dockerEngine talks to the local Engine API over its socket.
export const dockerEngine: DockerEngine = {
  listRunning: async () => ((await engineGet<Array<{ Id: string }>>("/containers/json")) ?? []).map((c) => c.Id),
  inspect: (id) => engineGet<EngineRecord>(`/containers/${encodeURIComponent(id)}/json`),
};
