# syntax=docker/dockerfile:1.7
# Infinity Studio — one process (`infinity-studio-server`) serving the API and
# the exported SPA. Two final targets:
#   embed : API + SPA only — what the hosting console deploys (no Java/ssh/pg_dump)
#   full  : embed + Java bridge/JRE (JDBC, Oracle), pg_dump backups, ssh tunnels
#
#   docker build --target embed -t infinity-studio:embed .
#   docker build --target full  -t infinity-studio:full  .

ARG BUN_IMAGE=oven/bun:1
ARG BUN_RUNTIME_IMAGE=oven/bun:1-slim
ARG JDK_IMAGE=eclipse-temurin:21-jdk

# ---------------------------------------------------------------------------
# deps — root + server dependencies from the lockfiles (manifests only, so the
# install layer survives source edits). devDependencies are needed by
# `next build`, so NODE_ENV must stay unset here.
# ---------------------------------------------------------------------------
FROM ${BUN_IMAGE} AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY patches ./patches
COPY server/package.json server/bun.lock ./server/
RUN bun install --frozen-lockfile \
 && cd server && bun install --frozen-lockfile

# ---------------------------------------------------------------------------
# web — static export of the Next.js SPA → /app/out
# (next.config.mjs only switches to output:"export" under NODE_ENV=production;
#  app/layout.tsx pulls Google Fonts, so this stage needs network access)
# ---------------------------------------------------------------------------
FROM deps AS web
COPY . .
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# ---------------------------------------------------------------------------
# server — single-file sidecar binary (same flags as scripts/build-server.mjs)
# ---------------------------------------------------------------------------
FROM deps AS server
COPY . .
RUN mkdir -p /out \
 && bun build --compile --target=bun-linux-x64 server/index.ts \
      --outfile=/out/infinity-studio-server

# ---------------------------------------------------------------------------
# java — bridge.jar + jlink'd JRE (same as resources/java-bridge/build.sh,
# plus java.xml + jdk.unsupported which the Oracle ojdbc driver needs)
# ---------------------------------------------------------------------------
FROM ${JDK_IMAGE} AS java
WORKDIR /src
COPY resources/java-bridge/src ./src
RUN javac --release 21 -d /src/out /src/src/Bridge.java \
 && mkdir -p /bridge \
 && jar cfe /bridge/bridge.jar Bridge -C /src/out . \
 && chmod 644 /bridge/bridge.jar \
 && jlink --module-path "$JAVA_HOME/jmods" \
      --add-modules java.base,java.sql,jdk.crypto.ec,java.management,java.naming,java.security.jgss,java.xml,jdk.unsupported \
      --output /bridge/jre \
      --strip-debug --compress=zip-6 --no-header-files --no-man-pages \
 && chmod -R 755 /bridge/jre \
 && (find /bridge/jre/legal -type l -delete 2>/dev/null || true) \
 && /bridge/jre/bin/java -version

# ---------------------------------------------------------------------------
# runtime-base — Debian slim + bun (health probe only), non-root `bun` (uid
# 1000, provided by the image), read-only /app, writable /data volume
# ---------------------------------------------------------------------------
FROM ${BUN_RUNTIME_IMAGE} AS runtime-base
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data && chown bun:bun /data
WORKDIR /app
COPY --from=server /out/infinity-studio-server /app/infinity-studio-server
COPY --from=web /app/out /app/out
ENV NODE_ENV=production \
    INFSTUDIO_BIND=0.0.0.0 \
    INFSTUDIO_SERVER_PORT=3867 \
    INFSTUDIO_USER_DATA_DIR=/data \
    INFSTUDIO_STATIC_DIR=/app/out \
    INFSTUDIO_MCP_DISABLED=1
VOLUME /data
EXPOSE 3867
USER bun
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.INFSTUDIO_SERVER_PORT||3867)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/infinity-studio-server"]

# ---------------------------------------------------------------------------
# embed — what the hosting console deploys: nothing beyond runtime-base
# ---------------------------------------------------------------------------
FROM runtime-base AS embed

# ---------------------------------------------------------------------------
# full — standalone web: JDBC bridge + JRE, vendored drivers, pg_dump, ssh
# ---------------------------------------------------------------------------
FROM runtime-base AS full
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client openssh-client ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
# kubectl lets a local studio reach a database that only answers inside the user's own Kubernetes network.
ARG KUBECTL_VERSION=v1.34.1
RUN arch="$(dpkg --print-architecture)" \
 && curl -fsSLo /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${arch}/kubectl" \
 && chmod 0755 /usr/local/bin/kubectl \
 && kubectl version --client >/dev/null
COPY --from=java /bridge /app/resources
COPY docker/jdbc-drivers /app/jdbc-drivers
ENV RESOURCEDIR=/app/resources \
    INFSTUDIO_JDBC_DRIVERS_DIR=/app/jdbc-drivers \
    INFSTUDIO_PG_DUMP_PATH=/usr/bin/pg_dump
USER bun
