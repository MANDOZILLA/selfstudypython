import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, lstat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { asc, eq } from "drizzle-orm";
import { createDefaultState, migrateState } from "../lib/state";
import { MAX_STATE_BYTES, PersistenceError, saveRequestSchema, snapshotSchema, type Receipt, type SaveRequest, type Snapshot } from "../lib/persistence-contract";
import * as schema from "./schema";

export async function resolveDatabasePath(override?: string) {
  // Plain absolute local paths only. No URLs, network shares, devices or URI options.
  const path = override ?? resolve(process.cwd(), ".data", "coding-school.db");
  if (!isAbsolute(path) || /[%?#\0]/.test(path) || path.replace(/^[a-z]:/i, "").includes(":") || /^(?:\\\\|\/\/|file:|https?:|libsql:)/i.test(path) || !/\.db$/i.test(path)) throw new PersistenceError("invalid");
  // Runtime learner data must never be traced into the build output.
  const target = resolve(/* turbopackIgnore: true */ path);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  if ((await realpath(dirname(target))).toLowerCase() !== dirname(target).toLowerCase()) throw new PersistenceError("invalid");
  try { if (!(await lstat(target)).isFile()) throw new PersistenceError("invalid"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return target;
}

export async function openRepository(override?: string) {
  const path = await resolveDatabasePath(override);
  // One connection ensures connection-scoped PRAGMAs apply to every transaction.
  // libSQL accepts file:C:/... on Windows; file:///C:/... retains an unwanted slash.
  const client = createClient({ url: `file:${path.replaceAll("\\", "/")}`, concurrency: 1 });
  const db = drizzle(client);
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation).catch(error => { throw error instanceof PersistenceError ? error : new PersistenceError("unavailable"); });
    queue = result.catch(() => {});
    return result;
  }
  try {
    for (const pragma of ["PRAGMA foreign_keys=ON", "PRAGMA journal_mode=WAL", "PRAGMA synchronous=FULL", "PRAGMA busy_timeout=5000"]) await client.execute(pragma);
    await client.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    const sql = await readFile(resolve(process.cwd(), "db/migrations/0001_learner.sql"), "utf8");
    const checksum = createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex");
    const transaction = await client.transaction("write");
    try {
      const applied = await transaction.execute("SELECT version, checksum FROM schema_migrations ORDER BY version");
      if (applied.rows.some(row => row.version !== 1 || row.checksum !== checksum)) throw new PersistenceError("unavailable");
      if (!applied.rows.length) {
        // This initial migration is additive. Future destructive migrations must
        // create a consistent backup before opening their migration transaction.
        for (const statement of sql.split(";").map(part => part.trim()).filter(Boolean)) await transaction.execute(statement);
        await transaction.execute({ sql: "INSERT INTO schema_migrations(version,name,checksum) VALUES (?,?,?)", args: [1, "0001_learner", checksum] });
      }
      await transaction.commit();
    } catch (error) { await transaction.rollback(); throw error; }
    finally { transaction.close(); }
  } catch { client.close(); throw new PersistenceError("unavailable"); }

  async function load(): Promise<Snapshot> {
    return exclusive(() => db.transaction(async tx => {
      const [meta] = await tx.select().from(schema.learnerMeta);
      if (!meta) throw new PersistenceError("unavailable");
      const state = createDefaultState();
      const runs = await tx.select().from(schema.missionRuns).orderBy(asc(schema.missionRuns.position));
      const stages = await tx.select().from(schema.missionStages).orderBy(asc(schema.missionStages.position));
      const drafts = await tx.select().from(schema.missionDrafts);
      const attempts = await tx.select().from(schema.attempts).orderBy(asc(schema.attempts.position));
      const checks = await tx.select().from(schema.attemptChecks).orderBy(asc(schema.attemptChecks.position));
      const outcomes = await tx.select().from(schema.attemptOutcomes).orderBy(asc(schema.attemptOutcomes.position));
      state.missionRuns = runs.map(run => ({ ...JSON.parse(run.payload), stages: stages.filter(s => s.runId === run.id).map(s => JSON.parse(s.payload)), drafts: Object.fromEntries(drafts.filter(d => d.runId === run.id).map(d => [d.taskId, JSON.parse(d.payload)])) }));
      state.attempts = attempts.map(attempt => ({ ...JSON.parse(attempt.payload), checks: checks.filter(c => c.attemptId === attempt.id).map(c => JSON.parse(c.payload)), skillOutcomes: outcomes.filter(o => o.attemptId === attempt.id).map(o => JSON.parse(o.payload)) }));
      state.reviewSchedule = Object.fromEntries((await tx.select().from(schema.reviewSchedules)).map(row => [row.skillId, JSON.parse(row.payload)]));
      state.portfolio = (await tx.select().from(schema.portfolioSnapshots).orderBy(asc(schema.portfolioSnapshots.position))).map(row => JSON.parse(row.payload));
      const [diagnostic] = await tx.select().from(schema.diagnosticSessions).where(eq(schema.diagnosticSessions.id, "local"));
      state.diagnostic = { completed: diagnostic.completed, completedAt: diagnostic.completedAt };
      state.dashboard.activeTab = meta.activeTab as typeof state.dashboard.activeTab;
      // Invalid stored records fail closed. Do not silently reset/drop evidence.
      const parsed = snapshotSchema.parse({ state, revision: meta.revision, initialized: meta.initialized, legacyImported: meta.legacyImported, learningMode: meta.learningMode });
      const normalized = migrateState(parsed.state);
      if (!isDeepStrictEqual(normalized.attempts, state.attempts) || !isDeepStrictEqual(normalized.missionRuns, state.missionRuns)) throw new PersistenceError("unavailable");
      return { ...parsed, state: normalized };
    }, { behavior: "deferred" }));
  }
  async function save(input: SaveRequest): Promise<Receipt> {
    let request: SaveRequest;
    try {
      if (Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_STATE_BYTES) throw new Error();
      request = saveRequestSchema.parse(input);
      const normalized = migrateState(request.state);
      if (!isDeepStrictEqual(normalized.attempts, request.state.attempts) || !isDeepStrictEqual(normalized.missionRuns, request.state.missionRuns)) throw new Error();
      request.state = normalized;
    } catch { throw new PersistenceError("invalid"); }
    const payloadHash = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    return exclusive(() => db.transaction(async tx => {
      const [receipt] = await tx.select().from(schema.saveReceipts).where(eq(schema.saveReceipts.requestId, request.requestId));
      if (receipt) {
        if (receipt.payloadHash !== payloadHash) throw new PersistenceError("conflict");
        return { revision: receipt.revision, requestId: receipt.requestId };
      }
      const [meta] = await tx.select().from(schema.learnerMeta);
      if (meta.revision !== request.revision || (request.operation === "import" && (meta.initialized || meta.legacyImported))) throw new PersistenceError("conflict");
      const state = request.state;
      // Replace one complete aggregate inside BEGIN IMMEDIATE. Readers see either
      // the old or new revision; cascade clears dependent rows atomically.
      await tx.delete(schema.missionRuns);
      await tx.delete(schema.reviewSchedules);
      await tx.delete(schema.portfolioSnapshots);
      for (const [position, run] of state.missionRuns.entries()) {
        const { stages, drafts, ...payload } = run;
        await tx.insert(schema.missionRuns).values({ id: run.id, missionId: run.missionId, missionVersion: run.missionVersion, status: run.status, stageIndex: run.stageIndex, position, payload: JSON.stringify(payload) });
        for (const [position, stage] of stages.entries()) await tx.insert(schema.missionStages).values({ runId: run.id, stageId: stage.stageId, status: stage.status, position, payload: JSON.stringify(stage) });
        for (const [taskId, draft] of Object.entries(drafts)) await tx.insert(schema.missionDrafts).values({ runId: run.id, taskId, payload: JSON.stringify(draft) });
      }
      for (const [position, attempt] of state.attempts.entries()) {
        const { checks, skillOutcomes, ...payload } = attempt;
        await tx.insert(schema.attempts).values({ id: attempt.id, runId: attempt.runId, stageId: attempt.stageId, taskId: attempt.taskId, position, passed: attempt.passed, completedAt: attempt.completedAt, payload: JSON.stringify(payload) });
        for (const [position, check] of checks.entries()) await tx.insert(schema.attemptChecks).values({ attemptId: attempt.id, position, checkId: check.id, passed: check.passed, payload: JSON.stringify(check) });
        for (const [position, outcome] of skillOutcomes.entries()) await tx.insert(schema.attemptOutcomes).values({ attemptId: attempt.id, position, skillId: outcome.skillId, payload: JSON.stringify(outcome) });
      }
      for (const schedule of Object.values(state.reviewSchedule)) await tx.insert(schema.reviewSchedules).values({ skillId: schedule.skillId, dueAt: schedule.dueAt, intervalDays: schedule.intervalDays, payload: JSON.stringify(schedule) });
      for (const [position, snapshot] of state.portfolio.entries()) await tx.insert(schema.portfolioSnapshots).values({ position, projectId: snapshot.projectId, payload: JSON.stringify(snapshot) });
      await tx.update(schema.diagnosticSessions).set({ completed: state.diagnostic.completed, completedAt: state.diagnostic.completedAt }).where(eq(schema.diagnosticSessions.id, "local"));
      const revision = meta.revision + 1;
      await tx.update(schema.learnerMeta).set({ revision, initialized: true, legacyImported: meta.legacyImported || request.operation === "import", activeTab: state.dashboard.activeTab, learningMode: request.learningMode }).where(eq(schema.learnerMeta.id, 1));
      await tx.insert(schema.saveReceipts).values({ requestId: request.requestId, payloadHash, revision });
      return { revision, requestId: request.requestId };
    }, { behavior: "immediate" }));
  }
  async function health() {
    return exclusive(async () => {
      const integrity = await client.execute("PRAGMA integrity_check");
      const foreign = await client.execute("PRAGMA foreign_key_check");
      const mode = await client.execute("PRAGMA journal_mode");
      const keys = await client.execute("PRAGMA foreign_keys");
      const version = await client.execute("SELECT max(version) AS version FROM schema_migrations");
      return { ok: integrity.rows[0]?.integrity_check === "ok" && foreign.rows.length === 0, schemaVersion: Number(version.rows[0].version), journalMode: String(mode.rows[0].journal_mode), foreignKeys: keys.rows[0].foreign_keys === 1 };
    });
  }
  return { load, save, health, exportJson: async () => JSON.stringify({ format: "coding-school-backup-v1", exportedAt: new Date().toISOString(), ...await load() }, null, 2), close: () => client.close() };
}
export type LearnerRepository = Awaited<ReturnType<typeof openRepository>>;
