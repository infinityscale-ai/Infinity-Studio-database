# Infinity Studio in Docker

One process, `infinity-studio-server`, serves the API and the exported SPA on
port 3867. The `Dockerfile` has two final targets:

| Target  | Contents                                                        | Use                              |
|---------|-----------------------------------------------------------------|----------------------------------|
| `embed` | server + SPA, nothing else                                      | what the hosting console deploys |
| `full`  | `embed` + Java bridge/JRE (JDBC, Oracle), `pg_dump`, `ssh`      | standalone web                   |

## Build

```sh
docker build --target embed -t infinity-studio:embed .
docker build --target full  -t infinity-studio:full  .
```

The `web` stage needs network access (Google Fonts). Intermediate targets
(`web`, `server`, `java`) can be built alone with `--target` for debugging.

## Run

Standalone web, login with an API key:

```sh
docker run -d --name studio -p 3867:3867 -v studio-data:/data \
  -e INFSTUDIO_API_KEY="$(openssl rand -hex 24)" \
  infinity-studio:full
```

Embedded by a console (sessions minted through the admin API, browser
requests allowed from the console origin only):

```sh
docker run -d --name studio -p 3867:3867 -p 127.0.0.1:3868:3868 -v studio-data:/data \
  -e INFSTUDIO_EMBED_MODE=1 \
  -e INFSTUDIO_ADMIN_PORT=3868 -e INFSTUDIO_ADMIN_BIND=0.0.0.0 \
  -e INFSTUDIO_ADMIN_KEY="$(openssl rand -hex 32)" \
  -e INFSTUDIO_EMBED_ALLOWED_ORIGINS=https://console.example.com \
  -e INFSTUDIO_CONSOLE_ORIGIN=https://console.example.com \
  infinity-studio:embed
```

`docker compose up -d` runs the `full` image (set `INFSTUDIO_API_KEY` and
`INFSTUDIO_ADMIN_KEY` in the environment); `--profile demo` adds a Postgres
reachable at `postgres://postgres:demo@postgres:5432/demo`.

## Environment

| Variable                          | Default (image)       | Meaning                                              |
|-----------------------------------|-----------------------|------------------------------------------------------|
| `INFSTUDIO_BIND`                  | `0.0.0.0`             | listen address of the API/SPA                        |
| `INFSTUDIO_SERVER_PORT`           | `3867`                | listen port                                          |
| `INFSTUDIO_STATIC_DIR`            | `/app/out`            | exported SPA served by the server                    |
| `INFSTUDIO_USER_DATA_DIR`         | `/data`               | sqlite + port file (mount a volume)                  |
| `INFSTUDIO_MCP_DISABLED`          | `1`                   | MCP endpoint off in containers                       |
| `INFSTUDIO_API_KEY`               | —                     | login key for standalone web                         |
| `INFSTUDIO_ALLOW_UNAUTHENTICATED` | —                     | `1` skips the API key (local smoke tests only)       |
| `INFSTUDIO_CORS_ORIGINS`          | —                     | extra allowed browser origins, comma-separated       |
| `INFSTUDIO_EMBED_MODE`            | —                     | `1` = console-embedded sessions                      |
| `INFSTUDIO_EMBED_ALLOWED_ORIGINS` | —                     | origins allowed to embed the studio                  |
| `INFSTUDIO_CONSOLE_ORIGIN`        | —                     | the console that mints sessions                      |
| `INFSTUDIO_EMBED_THEME`           | —                     | app theme id every embedded session opens with (`infinityscale`) |
| `INFSTUDIO_EMBED_EDITOR_THEME`    | the app theme's pair  | Monaco theme id paired with it (`infinityscale-dark`, `vs-dark`, …) |
| `INFSTUDIO_ADMIN_PORT`            | —                     | admin API port (embed sessions)                      |
| `INFSTUDIO_ADMIN_BIND`            | —                     | admin API listen address                             |
| `INFSTUDIO_ADMIN_KEY`             | —                     | admin API key, at least 32 chars                     |
| `RESOURCEDIR`                     | `/app/resources` (full) | `bridge.jar` + `jre/` for JDBC                     |
| `INFSTUDIO_JDBC_DRIVERS_DIR`      | `/app/jdbc-drivers` (full) | vendored JDBC drivers (Oracle, PostgreSQL)      |
| `INFSTUDIO_PG_DUMP_PATH`          | `/usr/bin/pg_dump` (full) | `pg_dump` used for backups                      |

Health: `GET /health` returns 200; the image `HEALTHCHECK` probes it.
Everything runs as the non-root `bun` user (uid 1000); `/data` is the only
writable path.

## Not bundled

- **DuckDB**: the native `@duckdb/node-api` addon is not compiled into the
  server binary, so DuckDB connections are unavailable in both images.
- **Oracle / other JDBC databases** need the `full` image: `embed` ships no
  Java. Extra drivers go in `/app/jdbc-drivers/<Name>/` with a
  `manifest.json` (`driver_class`, `jar_paths`).
- `pg_dump` and `ssh` tunnels are also `full`-only.
