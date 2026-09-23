"use client";

import { CardBadge, ConnectionCardButton, ProviderMark } from "@/components/connections/connection-card";
import type { CandidateEngine, DatabaseCandidate } from "@/lib/discovery/database-candidate";
import type { OciDatabaseKind, OciDatabaseSummary } from "@/lib/oci/oci-database";

/** A database the studio found but the user has not necessarily saved yet. */
export type FoundDatabase = { kind: "local"; candidate: DatabaseCandidate } | { kind: "cloud"; database: OciDatabaseSummary };

/** What one found card needs: the database, whether it is already saved, and what clicking does. */
export type FoundDatabaseCardProps = { found: FoundDatabase; saved: boolean; onActivate: () => void };

/** How each local engine is named and which logo it uses. */
const LOCAL_ENGINES: Record<CandidateEngine, { label: string; logo: string }> = {
  postgres: { label: "PostgreSQL", logo: "postgres" },
  mysql: { label: "MySQL", logo: "mysql" },
  mariadb: { label: "MariaDB", logo: "mariadb" },
  mongodb: { label: "MongoDB", logo: "mongodb" },
  redis: { label: "Redis", logo: "redis" },
  mssql: { label: "SQL Server", logo: "mssql" },
  clickhouse: { label: "ClickHouse", logo: "clickhouse" },
  oracle: { label: "Oracle", logo: "jdbc" },
};

/** How each Oracle Cloud service is named and which logo it uses. */
const CLOUD_KINDS: Record<OciDatabaseKind, { label: string; logo: string }> = {
  mysql: { label: "MySQL HeatWave", logo: "mysql" },
  postgres: { label: "OCI PostgreSQL", logo: "postgres" },
  autonomous: { label: "Autonomous Database", logo: "jdbc" },
};

/** Where a local database was found, said the way a person would. */
const LOCAL_SOURCES: Record<DatabaseCandidate["source"], string> = { port: "This machine", docker: "Docker", pgpass: "Config file", mycnf: "Config file" };

/** The words, logo and state one card shows. */
type CardView = { title: string; subtitle: string; logo: string; source: string; target: string; status: string; disabled: boolean };

// localView describes a database found on this machine.
function localView(c: DatabaseCandidate, saved: boolean): CardView {
  const engine = LOCAL_ENGINES[c.engine];
  const title = c.container || (c.source === "port" ? `${engine.label} on port ${c.port}` : c.label);
  const status = saved ? "Saved, opens it" : c.password ? "Ready to open" : "Needs a login";
  return { title, subtitle: engine.label, logo: engine.logo, source: LOCAL_SOURCES[c.source], target: `${c.host}:${c.port}`, status, disabled: false };
}

// cloudView describes a database found in the user's Oracle Cloud tenancy.
function cloudView(db: OciDatabaseSummary, saved: boolean): CardView {
  const kind = CLOUD_KINDS[db.kind];
  const active = db.state === "ACTIVE" || db.state === "AVAILABLE";
  const status = saved ? "Saved, opens it" : active ? "Private, reached through your cluster" : `${db.state.toLowerCase()}, not reachable now`;
  return { title: db.name, subtitle: kind.label, logo: kind.logo, source: "Oracle Cloud", target: db.state.toLowerCase(), status, disabled: !active && !saved };
}

// FoundDatabaseCard shows a found database exactly like a saved connection card, with where it was found.
export function FoundDatabaseCard({ found, saved, onActivate }: FoundDatabaseCardProps) {
  const view = found.kind === "local" ? localView(found.candidate, saved) : cloudView(found.database, saved);
  return (
    <ConnectionCardButton
      logo={<ProviderMark provider={view.logo} label={view.subtitle} />}
      title={view.title}
      subtitle={view.subtitle}
      badges={saved ? <CardBadge>Saved</CardBadge> : null}
      actions={<CardBadge>{view.source}</CardBadge>}
      footer={
        <>
          {found.kind === "local" ? <span className="truncate font-mono">{view.target}</span> : null}
          <span className="truncate">{view.status}</span>
        </>
      }
      onActivate={onActivate}
      disabled={view.disabled}
      ariaLabel={`${view.title}, ${view.subtitle}, ${view.source}. ${view.status}`}
    />
  );
}
