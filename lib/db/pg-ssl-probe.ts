import net from "node:net";

/** libpq's SSLRequest packet: a length of 8, then the protocol code 80877103. */
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);
/** The server's one-byte answers: S speaks SSL, N does not. */
const ANSWER_YES = 0x53;
/** How long one probe may take; an unreachable server is reported by the real connect, not here. */
const PROBE_TIMEOUT_MS = 5000;
/** How long a server's answer is remembered; resetPgSslProbeCache() forgets it sooner. */
const PROBE_TTL_MS = 10 * 60 * 1000;

/** One remembered answer for a host:port. */
type ProbeAnswer = { supportsSsl: boolean; expiresAt: number };

/** Answers by host:port; entries expire by TTL or through resetPgSslProbeCache(). */
const probeAnswers = new Map<string, ProbeAnswer>();

// probePgSslSupport asks a Postgres server whether it speaks SSL, the way libpq does before deciding for "prefer".
export async function probePgSslSupport(host: string, port: number): Promise<boolean | null> {
  const key = `${host}:${port}`;
  const cached = probeAnswers.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.supportsSsl;
  const answer = await askServer(host, port);
  if (answer !== null) probeAnswers.set(key, { supportsSsl: answer, expiresAt: Date.now() + PROBE_TTL_MS });
  return answer;
}

// askServer sends one SSLRequest and reads the reply byte; null means the probe itself failed.
function askServer(host: string, port: number): Promise<boolean | null> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (answer: boolean | null) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(null));
    socket.once("error", () => finish(null));
    socket.once("connect", () => socket.write(SSL_REQUEST));
    socket.once("data", (chunk) => finish(chunk[0] === ANSWER_YES));
  });
}

// resetPgSslProbeCache forgets every remembered answer, for tests and for a server whose TLS setup changed.
export function resetPgSslProbeCache(): void {
  probeAnswers.clear();
}
