/** Where the relay must connect once it runs inside the cluster. */
export type RelayTarget = { host: string; port: number };

/** The image that relays one TCP port, pinned by digest so what runs is exactly what was tested, and fully qualified because some runtimes refuse short names. */
export const RELAY_IMAGE = "docker.io/alpine/socat:1.8.0.0@sha256:a6be4c0262b339c53ddad723cdd178a1a13271e1137c65e27f90a08c16de02b8";
/** The port the relay listens on inside the pod. */
export const RELAY_PORT = 15432;
/** The label every relay carries, so the studio can find and remove its own pods and nobody else's. */
export const RELAY_LABEL = { key: "app.kubernetes.io/managed-by", value: "infinity-studio" };
/** The cluster stops the relay itself after this long, so a studio that dies can never leave one running. */
export const RELAY_MAX_LIFETIME_SECONDS = 3600;

// relayPodName names one throwaway relay so it is recognisable and never collides.
export function relayPodName(): string {
  return `infinity-studio-tunnel-${Math.random().toString(36).slice(2, 8)}`;
}

// relayPodManifest is the whole object the studio creates: one pod, no volumes, no service account token, deleted on disconnect.
export function relayPodManifest(name: string, target: RelayTarget): Record<string, unknown> {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name,
      labels: { "app.kubernetes.io/name": "infinity-studio-tunnel", [RELAY_LABEL.key]: RELAY_LABEL.value },
      annotations: { "infinity-studio/target": `${target.host}:${target.port}` },
    },
    spec: {
      restartPolicy: "Never",
      automountServiceAccountToken: false,
      terminationGracePeriodSeconds: 1,
      activeDeadlineSeconds: RELAY_MAX_LIFETIME_SECONDS,
      containers: [
        {
          name: "relay",
          image: RELAY_IMAGE,
          args: [`TCP-LISTEN:${RELAY_PORT},fork,reuseaddr`, `TCP:${target.host}:${target.port}`],
          ports: [{ containerPort: RELAY_PORT }],
          resources: { requests: { cpu: "10m", memory: "16Mi" }, limits: { cpu: "200m", memory: "64Mi" } },
          securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } },
        },
      ],
    },
  };
}
