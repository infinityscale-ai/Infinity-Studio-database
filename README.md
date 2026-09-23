# Infinity Studio

> Open-source multi-database studio for PostgreSQL, MySQL/MariaDB, MongoDB, Redis, SQLite,
> ClickHouse, SQL Server, DuckDB, Trino, and 90+ more via JDBC (including Oracle).

Infinity Studio is a desktop-grade database workbench: a Monaco SQL editor with completion
and history, a fast data grid, ERD and schema browser, dashboards, backups, SSH tunnels,
AI assistance with your own provider key, and an MCP server so coding agents can work
against your databases with scoped tokens.

## Three ways to run it

| Mode | What it is | Status |
|---|---|---|
| **Desktop app** | Tauri shell around the studio with a bundled Bun sidecar. macOS, Windows, Linux. | Available |
| **Standalone web** | The same studio served from a Docker image, reachable in any browser. | Available |
| **Embedded** | The studio mounted inside a hosting console; the host opens an *embed session* scoped to one database. | Available |

All three share one codebase: a Next.js static-export SPA (`app/`, `components/`, `lib/`,
`hooks/`) and a Bun + Express sidecar (`server/index.ts`) that owns the database drivers,
local settings, and the MCP endpoint.

## Run it locally

```bash
docker compose up -d                  # http://localhost:3867 — no access key on your own machine
docker compose --profile demo up -d   # also starts a demo Postgres (postgres://postgres:demo@postgres:5432/demo)
```

The UI is published on `127.0.0.1` only, so nobody else on the network can reach it and no login
is asked. To open it to other machines, set `INFSTUDIO_API_KEY` (the key the login screen asks
for) and `INFSTUDIO_LISTEN=0.0.0.0` in a `.env` next to the compose file.

To use your own machine's Docker containers and `oci` sign-in from the **Discover** dialog, run
the sidecar natively instead of in Docker (the desktop app does this for you):

```bash
bun install && bun run server:install && bun run build
INFSTUDIO_STATIC_DIR=out bun run server/index.ts     # http://127.0.0.1:3867
```

## Finding databases

The **Add Connection** screen starts with what is already running, and the first-run steps end
with the same list:

- **Found on this machine** — the usual database ports, running Docker containers that publish
  a database port (with the credentials from their environment) or share a network with the
  studio, and `~/.pgpass` / `~/.my.cnf`. Pick one and the connection form opens filled in.
- **Oracle Cloud databases** — uses the sign-in the OCI CLI keeps in `~/.oci` (a session from
  `oci session authenticate`, or an API-key profile) and calls Oracle Cloud's API itself to list
  the MySQL HeatWave, OCI PostgreSQL and Autonomous databases of the tenancy. **Every one of
  those calls is a read: the studio has no code path that creates, changes or deletes anything
  in Oracle Cloud**, and a guard refuses any request that is not a read. When a session has
  expired the studio says so in a dialog and refreshes it in one click.

  Those databases answer only on private addresses. To reach one, the studio uses a Kubernetes
  cluster of yours that sits in the same network: opening the connection starts one small relay
  pod, forwards its port to your machine, and removes the pod when you close the connection. It
  needs `kubectl` where the studio runs, which the Docker image carries. Nothing is added to
  Oracle Cloud and none of your manifests change. Autonomous databases still go through the
  JDBC connection with their wallet (see the two *Oracle Autonomous* templates; the wallet one
  needs `oraclepki.jar` beside `ojdbc11.jar`, which the Docker image already carries).

In Docker, the compose file mounts the Docker socket read-only and maps
`host.docker.internal` to your machine, so the studio in the container sees your other
containers and anything published on your ports. The socket belongs to the `docker` group;
if the list says the socket is not readable, start with your group id:

```bash
DOCKER_GID=$(stat -c %g /var/run/docker.sock) docker compose up -d
```

**Local only.** Both features read things that belong to the machine the studio runs on, so
they are served only by a studio nobody else can reach: one that asks no access key (on
loopback, or the loopback-published compose run). The moment you set `INFSTUDIO_API_KEY` to
share the studio, the section disappears, the first-run step is skipped and the routes are not
mounted. `INFSTUDIO_LOCAL_TOOLS=1` or `0` forces it either way. Neither feature is served in
embed mode. The compose file also shares `~/.oci` read-only with
the container, so the Oracle Cloud list works in Docker too; only the browser sign-in itself
(`oci session authenticate`) runs on your computer, and the panel tells you the exact command
when a session has expired.

## Supported databases

PostgreSQL (and Supabase projects), MySQL, MariaDB, MongoDB, Redis, SQLite / libSQL,
ClickHouse, SQL Server, DuckDB, Trino, and any JDBC driver through the bundled Java bridge
(Oracle, DB2, Snowflake, BigQuery, and more).

## Development

Requirements: [Bun](https://bun.sh) 1.3+, Node 24 (for Next.js tooling), and for the
desktop shell a Rust toolchain plus the Tauri prerequisites for your OS.

```bash
bun install            # install dependencies (bun.lock is the lockfile)
bun run server:install # the sidecar's own deps (express 4) under server/node_modules
bun run dev            # Next.js dev server on http://localhost:3000
bun run server:dev     # Bun sidecar on http://127.0.0.1:3867 (run in a second terminal)
bun test               # unit tests
bun run tauri:dev      # desktop shell (starts both of the above)
```

Other useful commands:

```bash
bunx tsc --noEmit      # type check
bun run lint           # eslint
bun run build          # static export to out/ (the real build gate)
bun run server:build   # compile the sidecar binary for the desktop bundle
```

Data lives under `~/.infinity-studio/` (connections, settings, query history) and is
never sent anywhere. AI features call the provider you configure with your own key.

### Local development outside the desktop shell

`next dev` serves the SPA on port 3000 while the sidecar listens on 3867, so the
browser build must be told where the API is:

```bash
cp .env.development.example .env.development   # NEXT_PUBLIC_INFSTUDIO_API_BASE=http://127.0.0.1:3867
bun run server:dev                              # terminal 1
bun run dev                                     # terminal 2
```

Inside Tauri the port is discovered at runtime and the variable is ignored.

## Embedding in a hosting console

Embed mode turns the sidecar into a single-database studio that a console mounts in an
iframe. The console never hands the browser a database password: it mints a *session*
through a loopback admin API, the browser claims it once, and every query the studio
sends is pinned server-side to that one connection.

### Environment

| Variable | Meaning |
|---|---|
| `INFSTUDIO_EMBED_MODE=1` | Serve only `/embed` (plus `/_next/*`), enable sessions and the request policy, keep no file log. |
| `INFSTUDIO_ADMIN_PORT`, `INFSTUDIO_ADMIN_BIND` | The admin listener. Bind it to a loopback or pod-local address; it must never be routed. |
| `INFSTUDIO_ADMIN_KEY` | Shared secret (≥ 32 chars) the console presents as `Authorization: Bearer`. Required with the admin port. |
| `INFSTUDIO_CONSOLE_ORIGIN` | The console's origin: allowed for CORS and echoed to the page as the `postMessage` target. |
| `INFSTUDIO_EMBED_ALLOWED_ORIGINS` | Comma-separated origins allowed to frame the page (`Content-Security-Policy: frame-ancestors`). |
| `INFSTUDIO_STATIC_DIR` | The `out/` export to serve. |
| `INFSTUDIO_USER_DATA_DIR` | Where `sqlite.db` (studio state, no secrets) lives. |
| `INFSTUDIO_MCP_DISABLED=1` | Recommended: no MCP endpoint on an embedded studio. |
| `INFSTUDIO_BIND`, `INFSTUDIO_SERVER_PORT` | The public listener (default `127.0.0.1:3867`). |
| `INFSTUDIO_EMBED_THEME` | The app theme every embedded session opens with, by id (`infinityscale` carries the InfinityScale console's palette, radius and fonts). Unset: the studio's own look, which the viewer may change. An unknown id refuses to start. |
| `INFSTUDIO_EMBED_EDITOR_THEME` | The Monaco theme to pair with it (`infinityscale-dark`, `studio-dark`, `light`, `vs-dark`, `hc-black`, `auto`). Default: the app theme's pair (`infinityscale-dark` for `infinityscale`, else `auto`). Read only with `INFSTUDIO_EMBED_THEME`. |

### Admin API (console → studio, loopback only)

All routes except health require `Authorization: Bearer <INFSTUDIO_ADMIN_KEY>`.

| Route | Does |
|---|---|
| `GET /admin/v1/health` | `{ ok: true }` — public. |
| `POST /admin/v1/embed-sessions` | Upserts the managed connection and mints a single-use claim token. |
| `DELETE /admin/v1/embed-sessions?db=<dbId>` | Revokes every session on one database. Add `&purge=1` to also delete its studio state. |
| `DELETE /admin/v1/embed-sessions?user=<userId>` | Revokes every session of one user. |
| `DELETE /admin/v1/embed-sessions/<userId>%2F<dbId>` | Revokes one user/database pair. |

Session request body:

```json
{
  "externalId": "<userId>/<dbId>", "userId": "u1", "dbId": "db1", "label": "orders",
  "engine": "postgres | mysql | mongo | redis",
  "host": "db.internal", "port": 5432, "username": "app", "password": "…", "database": "orders",
  "options": { "sslmode": "require", "authSource": "admin" },
  "ttlSeconds": 28800, "tokenTtlSeconds": 60, "displayName": "Jane",
  "theme": { "app": "infinityscale", "editor": "infinityscale-dark" }
}
```

`201 { connectionId, token, tokenExpiresAt }` — `token` is single-use and expires after
`tokenTtlSeconds` (default 60 s, max 300); the session it opens lasts `ttlSeconds`
(default 8 h, max 24 h). The password is kept in process memory only: it is never
written to `sqlite.db`, a log line, or a response. A restart forgets it, and the next
request on that session answers `401 embed_session_revoked` so the console mints again.
`DELETE` answers `{ revoked, purged }`, or 404 when nothing matched.

`theme` is optional and overrides `INFSTUDIO_EMBED_THEME` for that session: `app` is a
built-in app theme id, `editor` a Monaco theme id (default: the app theme's pair). An
unknown id answers `400 invalid_theme`. The claim response and `GET /api/embed/session`
carry the resolved `theme: { app, editor }` (`null` when neither the environment nor the
session named one), the page paints it before the studio renders, and the viewer's
Theme, Editor Theme and Font pickers are hidden: the console owns the look.

### The iframe

```html
<iframe src="https://studio.example/embed#s=<token>" allow="clipboard-write"></iframe>
```

The token rides in the URL fragment, so it never reaches a server log. On load the page
strips the fragment, exchanges the token at `POST /api/embed/claim` for a bearer that
lives in `sessionStorage` for that tab, and boots the studio on the one connection.
Reloading the tab reuses the stored session; a second claim of the same token answers
`410 token_used`.

Messages the page posts to `window.parent` (targeted at `INFSTUDIO_CONSOLE_ORIGIN`):

| `type` | When |
|---|---|
| `infinity-studio:ready` | The session was claimed and the studio is rendering. |
| `infinity-studio:session-expired` | The token was unusable, or the server answered 401 mid-session (expiry, revocation, or a database authentication failure). The page shows "This session has ended"; the console should mint a new session. |

### What a session may do

Requests carrying an embed bearer are matched against an allow-list: the SQL and schema
routes, the per-connection studio state (`/studio/<own id>/…`), the actions marked
`embed: "allow"` in `server/api-actions.ts`, and the read-only appearance settings.
Everything else — the connection list, other connection ids, MCP, agents, backups,
bundles, snapshots, global settings writes — answers `403 embed_forbidden`. The client's
`connectionString` is ignored and replaced with the server-built one, and the row echoed
by `/studio/<id>/bootstrap` is redacted (`connectionString: "embed://<id>"`, no host,
user, port or password). A driver authentication failure revokes the session on the spot.
Only PostgreSQL, MySQL/MariaDB, MongoDB and Redis are served in embed mode.

`scripts/smoke-embed.sh` exercises the whole sequence against a throwaway PostgreSQL.

## Project layout

```
app/          Next.js routes (static export)
components/   React UI, grouped by feature
hooks/        React hooks
lib/          drivers (lib/db), AI (lib/ai), MCP (lib/agents/mcp), extensions, workflows
lib/discovery/  what a found database looks like and the string it prefills
lib/oci/        the OCI database, bastion and profile shapes shared with the sidecar
server/       Bun + Express sidecar
server/discovery/  scans this machine: ports, Docker containers, ~/.pgpass and ~/.my.cnf
server/oci/        drives the local oci CLI: profiles, inventory, bastion sessions
src-tauri/    desktop shell
resources/    Java bridge, sample extension
tests/        bun test suites
```

## Attribution

Infinity Studio is a fork of Rexa DB 1.3.16 (© 2026 Rexa DB,
https://github.com/RexaDB/RexaDB), licensed under GPL-3.0-or-later. This project remains
GPL-3.0-or-later. See `NOTICE` and `LICENSE`.

## License

GNU General Public License v3.0 or later. See [LICENSE](LICENSE).
