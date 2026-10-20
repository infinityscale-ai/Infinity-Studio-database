"use client";

import { CardBadge, ConnectionCardButton, ProviderMark } from "@/components/connections/connection-card";
import { engineLabel, type CandidateEngine, type DatabaseCandidate } from "@/lib/discovery/database-candidate";

/** A database the studio found on this machine but the user has not necessarily saved yet. */
export type FoundDatabase = { kind: "local"; candidate: DatabaseCandidate };

/** What one found card needs: the database, whether it is already saved, and what clicking does. */
export type FoundDatabaseCardProps = { found: FoundDatabase; saved: boolean; onActivate: () => void };

/** Which logo each local engine uses. */
const LOGOS: Record<CandidateEngine, string> = {
  postgres: "postgres", mysql: "mysql", mariadb: "mariadb", mongodb: "mongodb",
  redis: "redis", mssql: "mssql", clickhouse: "clickhouse", oracle: "jdbc",
};

/** Where a local database was found, said the way a person would. */
const LOCAL_SOURCES: Record<DatabaseCandidate["source"], string> = { port: "This machine", docker: "Docker", pgpass: "Config file", mycnf: "Config file" };

/** The words, logo and state one card shows. */
type CardView = { title: string; subtitle: string; logo: string; source: string; target: string; status: string; disabled: boolean };

// localView describes a database found on this machine.
function localView(c: DatabaseCandidate, saved: boolean): CardView {
  const label = engineLabel(c.engine);
  const title = c.container || (c.source === "port" ? `${label} on port ${c.port}` : c.label);
  const status = saved ? "Saved, opens it" : c.password ? "Ready to open" : "Needs a login";
  return { title, subtitle: label, logo: LOGOS[c.engine], source: LOCAL_SOURCES[c.source], target: `${c.host}:${c.port}`, status, disabled: false };
}

// FoundDatabaseCard shows a found database exactly like a saved connection card, with where it was found.
export function FoundDatabaseCard({ found, saved, onActivate }: FoundDatabaseCardProps) {
  const view = localView(found.candidate, saved);
  return (
    <ConnectionCardButton
      logo={<ProviderMark provider={view.logo} label={view.subtitle} />}
      title={view.title}
      subtitle={view.subtitle}
      badges={saved ? <CardBadge>Saved</CardBadge> : null}
      actions={<CardBadge>{view.source}</CardBadge>}
      footer={
        <>
          <span className="truncate font-mono">{view.target}</span>
          <span className="truncate">{view.status}</span>
        </>
      }
      onActivate={onActivate}
      disabled={view.disabled}
      ariaLabel={`${view.title}, ${view.subtitle}, ${view.source}. ${view.status}`}
    />
  );
}
