import { createClient, type Client, type InArgs, type Transaction } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";
import { createDefaultState, migrateState, STATE_VERSION, type LearningState } from "../lib/state";
import type { ServerSnapshot } from "../lib/state-sync";
import type { DiagnosticSession } from "../lib/diagnostic";

export type { ServerSnapshot };

export type CodingSchoolDatabase = LibSQLDatabase<typeof schema>;

/**
 * Structural store surface shared by the drizzle database and its
 * transactions, so the same read/write helpers work inside and outside
 * the atomic compare-and-swap transaction.
 */
type StateStore = Pick<CodingSchoolDatabase, "delete" | "insert" | "select">;

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

/**
 * Databases whose schema setup has already run in this process. DDL is
 * idempotent but wasteful per request, so each client migrates once.
 */
const migratedClients = new WeakSet<object>();

/** Run migrateDatabase once per client; subsequent calls are no-ops. */
async function ensureMigrated(client: Client): Promise<void> {
  if (migratedClients.has(client)) return;
  await migrateDatabase(client);
  migratedClients.add(client);
}

function singletonPayload(state: LearningState): Record<string, unknown> {
  return {
    dashboard: state.dashboard,
    portfolio: state.portfolio,
  };
}

/** Write every state table from an already-normalized state. Shared by the plain and CAS writers. */
async function writeStateTables(store: StateStore, normalized: LearningState, updatedAt: string): Promise<void> {
  await store.delete(schema.attempts);
  await store.delete(schema.missionRuns);
  await store.delete(schema.diagnosticSessions);
  await store.delete(schema.reviewState);
  for (const attempt of normalized.attempts) {
    await store.insert(schema.attempts).values({ id: attempt.id, runId: attempt.runId, updatedAt, payload: attempt });
  }
  for (const run of normalized.missionRuns) {
    await store.insert(schema.missionRuns).values({ id: run.id, updatedAt, payload: run });
  }
  for (const session of normalized.diagnosticSessions) {
    await store.insert(schema.diagnosticSessions).values({ id: session.id, updatedAt, payload: session });
  }
  const payload = singletonPayload(normalized);
  await store
    .insert(schema.stateMeta)
    .values({ id: "singleton", updatedAt, payload })
    .onConflictDoUpdate({ target: schema.stateMeta.id, set: { updatedAt, payload } });
}

/**
 * Persist learner state. The state is first re-normalized through migrateState
 * (same path as localStorage) so the database always holds valid payloads;
 * derived fields (mastery, reviewSchedule) are recomputed on load, not stored.
 */
export async function saveStateToDatabase(db: StateStore, state: LearningState): Promise<void> {
  const normalized = migrateState(state);
  await writeStateTables(db, normalized, new Date().toISOString());
}

/** Load learner state. An empty or un-migrated database yields a fresh default state. */
export async function loadStateFromDatabase(db: StateStore): Promise<LearningState> {
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

/** Key in db_meta holding the optimistic-concurrency revision of the learner state. */
const REVISION_KEY = "state_revision";

/**
 * Resolve the durable database path. CODING_SCHOOL_DB_PATH wins when set and
 * non-empty (used by verification and tests for isolation); otherwise the
 * default learner database under <repo>/.data. Pure: never touches the fs.
 */
export function resolveDatabasePath(): string {
  const configured = process.env.CODING_SCHOOL_DB_PATH?.trim();
  if (configured) return configured;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", ".data", "coding-school.db");
}

let serverDatabaseCache: { path: string; client: Client; db: CodingSchoolDatabase } | null = null;

/**
 * Lazily open (+migrate) the server database for the resolved path, cached
 * per path. Nothing is opened or created at import time; the .data directory
 * is only created when the server actually needs the database.
 */
export async function getServerDatabase(): Promise<{ client: Client; db: CodingSchoolDatabase }> {
  const path = resolveDatabasePath();
  if (serverDatabaseCache && serverDatabaseCache.path === path) return serverDatabaseCache;
  if (!path.startsWith("file:")) mkdirSync(dirname(path), { recursive: true });
  const { client, db } = openDatabase(path);
  await migrateDatabase(client);
  serverDatabaseCache = { path, client, db };
  return serverDatabaseCache;
}

/** Clear the singleton cache. Tests only — never call in production code. */
export function resetServerDatabaseForTests(): void {
  serverDatabaseCache = null;
}

/**
 * Drop the cached server database and close its client; the next
 * getServerDatabase() call reopens it. Called by the state route after
 * SQLITE_BUSY: a failed BEGIN IMMEDIATE leaves the libsql connection unable
 * to COMMIT later transactions ("SQL statements in progress") until GC
 * finalizes the dead statement, so recycling the client is the only
 * deterministic recovery. Reopening is cheap and contention is rare.
 */
export function closeServerDatabase(): void {
  const cached = serverDatabaseCache;
  serverDatabaseCache = null;
  if (cached) {
    try {
      cached.client.close();
    } catch {
      // Already closed — nothing to do.
    }
  }
}

/** Current state revision; 0 when the database is fresh or the key is absent. */
export async function getStateRevision(client: Client): Promise<number> {
  try {
    const rs = await client.execute({ sql: "SELECT value FROM db_meta WHERE key = ?", args: [REVISION_KEY] });
    const raw = rs.rows[0]?.["value"];
    const n = typeof raw === "string" || typeof raw === "number" ? Number(raw) : NaN;
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export type RevisionWriteResult =
  | { ok: true; revision: number }
  | { ok: false; revision: number; state: LearningState };

/**
 * In-process write mutex. The server runs as a single Node process, so
 * serializing compare-and-swap writers here avoids needless SQLITE_BUSY
 * retries between the server's own requests. Cross-process writers are
 * handled by the IMMEDIATE transaction inside trySaveStateWithRevision.
 */
let writeMutex: Promise<void> = Promise.resolve();
async function withWriteMutex<T>(fn: () => Promise<T>): Promise<T> {
  const previous = writeMutex;
  let release!: () => void;
  writeMutex = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Write every state table from an already-normalized state using raw SQL
 * inside an open libsql write transaction. This mirrors writeStateTables
 * (the drizzle variant used by the non-CAS path); keep the two in sync with
 * db/schema.ts if the tables ever change.
 */
async function writeStateTablesRaw(
  tx: Pick<Transaction, "execute">,
  normalized: LearningState,
  updatedAt: string,
): Promise<void> {
  const run = (sql: string, args: InArgs = []) => tx.execute({ sql, args });
  await run("DELETE FROM attempts");
  await run("DELETE FROM mission_runs");
  await run("DELETE FROM diagnostic_sessions");
  await run("DELETE FROM review_state");
  for (const attempt of normalized.attempts) {
    await run("INSERT INTO attempts (id, run_id, updated_at, payload) VALUES (?, ?, ?, ?)", [
      attempt.id,
      attempt.runId,
      updatedAt,
      JSON.stringify(attempt),
    ]);
  }
  for (const runState of normalized.missionRuns) {
    await run("INSERT INTO mission_runs (id, updated_at, payload) VALUES (?, ?, ?)", [
      runState.id,
      updatedAt,
      JSON.stringify(runState),
    ]);
  }
  for (const session of normalized.diagnosticSessions) {
    await run("INSERT INTO diagnostic_sessions (id, updated_at, payload) VALUES (?, ?, ?)", [
      session.id,
      updatedAt,
      JSON.stringify(session),
    ]);
  }
  await run(
    `INSERT INTO state_meta (id, updated_at, payload) VALUES ('singleton', ?, ?)
     ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, payload = excluded.payload`,
    [updatedAt, JSON.stringify(singletonPayload(normalized))],
  );
}

/**
 * Atomically write learner state iff the stored revision still equals
 * expectedRevision, bumping it by one. On mismatch NOTHING is written and the
 * current server state + revision are returned so the caller can resolve the
 * conflict without data loss.
 *
 * Concurrency: writers are serialized in-process by withWriteMutex. Across
 * processes the check and the write run inside a single BEGIN IMMEDIATE
 * transaction (libsql "write" mode): a second process that opens its own
 * write transaction while ours is open fails fast with SQLITE_BUSY at BEGIN
 * instead of both passing the revision SELECT and the loser silently
 * overwriting the winner. The route maps SQLITE_BUSY to 503 and the client
 * treats 5xx as transient offline, so the loser retries — no silent
 * corruption, no lost update.
 *
 * Implementation note: this deliberately does NOT use drizzle's
 * db.transaction(fn, { behavior: "immediate" }) — the installed
 * drizzle-orm/libsql driver silently ignores the behavior option, so the
 * compare-and-swap opens the IMMEDIATE transaction through the libsql
 * client directly. (The client's transaction() already defaults to "write"
 * mode, but this pins it explicitly so a future default change cannot
 * silently regress to DEFERRED.)
 *
 * Caller contract on SQLITE_BUSY: a failed BEGIN IMMEDIATE leaves the
 * passed client unable to COMMIT later transactions (libsql/node-sqlite
 * quirk: the dead statement is "in progress" until GC). Reopen the client
 * before further transactional writes — the state route does this via
 * closeServerDatabase() when it returns 503.
 */
export async function trySaveStateWithRevision(
  client: Client,
  state: LearningState,
  expectedRevision: number,
): Promise<RevisionWriteResult> {
  return withWriteMutex(async () => {
    await ensureMigrated(client);
    const tx = await client.transaction("write");
    try {
      const rs = await tx.execute({ sql: "SELECT value FROM db_meta WHERE key = ?", args: [REVISION_KEY] });
      const raw = rs.rows[0]?.["value"];
      const current = typeof raw === "string" || typeof raw === "number" ? Number(raw) : NaN;
      const revision = Number.isInteger(current) && current >= 0 ? current : 0;
      if (revision !== expectedRevision) {
        await tx.rollback();
        // The connection is free again after rollback; read the current copy
        // for the 409 response through the normal drizzle path.
        return { ok: false, revision, state: await loadStateFromDatabase(drizzle(client, { schema })) };
      }
      const updatedAt = new Date().toISOString();
      await writeStateTablesRaw(tx, migrateState(state), updatedAt);
      const next = revision + 1;
      await tx.execute({
        sql: `INSERT INTO db_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [REVISION_KEY, String(next)],
      });
      await tx.commit();
      return { ok: true, revision: next };
    } catch (error) {
      await tx.rollback().catch(() => {});
      throw error;
    }
  });
}

/** Read the durable snapshot for /api/state. No singleton row means no state yet (revision 0). */
export async function readServerSnapshot(client: Client): Promise<ServerSnapshot> {
  await ensureMigrated(client);
  const db = drizzle(client, { schema });
  const revision = await getStateRevision(client);
  const metaRows = await db.select().from(schema.stateMeta).where(eq(schema.stateMeta.id, "singleton"));
  if (metaRows.length === 0) return { revision, state: null, updatedAt: null };
  return { revision, state: await loadStateFromDatabase(db), updatedAt: metaRows[0].updatedAt };
}
