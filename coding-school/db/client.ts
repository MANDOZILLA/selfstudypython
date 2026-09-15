import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { createDefaultState, migrateState, STATE_VERSION, type LearningState } from "../lib/state";
import type { DiagnosticSession } from "../lib/diagnostic";

export type CodingSchoolDatabase = LibSQLDatabase<typeof schema>;

export const DB_SCHEMA_VERSION = 1;

const DDL = [
  `CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS mission_runs (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, payload TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS diagnostic_sessions (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, payload TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS review_state (skill_id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, payload TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS state_meta (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, payload TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS db_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

/** Open a SQLite database at an explicit path. Tests must pass isolated temp paths. */
export function openDatabase(dbPath: string): { client: Client; db: CodingSchoolDatabase } {
  const url = dbPath.startsWith("file:") ? dbPath : `file:${dbPath}`;
  const client = createClient({ url });
  return { client, db: drizzle(client, { schema }) };
}

/** Idempotent schema setup; safe to run on every open. */
export async function migrateDatabase(client: Client): Promise<void> {
  for (const statement of DDL) await client.execute(statement);
  await client.execute({
    sql: `INSERT INTO db_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [String(DB_SCHEMA_VERSION)],
  });
}

function singletonPayload(state: LearningState): Record<string, unknown> {
  return {
    dashboard: state.dashboard,
    portfolio: state.portfolio,
  };
}

/**
 * Persist learner state. The state is first re-normalized through migrateState
 * (same path as localStorage) so the database always holds valid payloads;
 * derived fields (mastery, reviewSchedule) are recomputed on load, not stored.
 */
export async function saveStateToDatabase(db: CodingSchoolDatabase, state: LearningState): Promise<void> {
  const normalized = migrateState(state);
  const updatedAt = new Date().toISOString();
  await db.delete(schema.attempts);
  await db.delete(schema.missionRuns);
  await db.delete(schema.diagnosticSessions);
  await db.delete(schema.reviewState);
  for (const attempt of normalized.attempts) {
    await db.insert(schema.attempts).values({ id: attempt.id, runId: attempt.runId, updatedAt, payload: attempt });
  }
  for (const run of normalized.missionRuns) {
    await db.insert(schema.missionRuns).values({ id: run.id, updatedAt, payload: run });
  }
  for (const session of normalized.diagnosticSessions) {
    await db.insert(schema.diagnosticSessions).values({ id: session.id, updatedAt, payload: session });
  }
  await db
    .insert(schema.stateMeta)
    .values({ id: "singleton", updatedAt, payload: singletonPayload(normalized) })
    .onConflictDoUpdate({ target: schema.stateMeta.id, set: { updatedAt, payload: singletonPayload(normalized) } });
}

/** Load learner state. An empty or un-migrated database yields a fresh default state. */
export async function loadStateFromDatabase(db: CodingSchoolDatabase): Promise<LearningState> {
  try {
    const [attemptRows, runRows, sessionRows, metaRows] = await Promise.all([
      db.select().from(schema.attempts),
      db.select().from(schema.missionRuns),
      db.select().from(schema.diagnosticSessions),
      db.select().from(schema.stateMeta),
    ]);
    const singleton = metaRows.find(row => row.id === "singleton")?.payload;
    const assembled = {
      version: STATE_VERSION,
      dashboard: (singleton?.dashboard as LearningState["dashboard"]) ?? { activeTab: "overview" as const },
      diagnostic: { completed: false, completedAt: null },
      attempts: attemptRows.map(row => row.payload),
      missionRuns: runRows.map(row => row.payload),
      diagnosticSessions: sessionRows.map(row => row.payload as DiagnosticSession),
      mastery: {},
      reviewSchedule: {},
      portfolio: (singleton?.portfolio as LearningState["portfolio"]) ?? [],
    };
    const migrated = migrateState(assembled);
    const completed = migrated.diagnosticSessions
      .filter(session => session.status === "completed")
      .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));
    const latest = completed[completed.length - 1];
    migrated.diagnostic = { completed: completed.length > 0, completedAt: latest?.completedAt ?? null };
    return migrated;
  } catch {
    return createDefaultState();
  }
}
