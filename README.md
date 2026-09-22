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
| **Standalone web** | The same studio served from a Docker image, reachable in any browser. | In progress |
| **Embedded** | The studio mounted inside a hosting console; the host opens an *embed session* scoped to one database. | In progress |

All three share one codebase: a Next.js static-export SPA (`app/`, `components/`, `lib/`,
`hooks/`) and a Bun + Express sidecar (`server/index.ts`) that owns the database drivers,
local settings, and the MCP endpoint.

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

## Project layout

```
app/          Next.js routes (static export)
components/   React UI, grouped by feature
hooks/        React hooks
lib/          drivers (lib/db), AI (lib/ai), MCP (lib/agents/mcp), extensions, workflows
server/       Bun + Express sidecar
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
