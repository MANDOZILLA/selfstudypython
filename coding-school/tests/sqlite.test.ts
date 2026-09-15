import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  createDefaultState,
  recordAssessmentAttempt,
  replaceDiagnosticSession,
  type LearningState,
} from "../lib/state";
import type { AssessmentTaskAttempt } from "../lib/assessment-evidence";
import { convertLegacyPortfolioSnapshot } from "../lib/portfolio";
import {
  createDiagnosticSession,
  answerConcept,
  recordCodingOutcome,
  nextDiagnosticItem,
  completeDiagnosticSession,
  type ConceptGrader,
  type DiagnosticSession,
} from "../lib/diagnostic";
import { DIAGNOSTIC_ITEMS } from "../curriculum/diagnostic-items";
import {
  openDatabase,
  migrateDatabase,
  saveStateToDatabase,
  loadStateFromDatabase,
  trySaveStateWithRevision,
  readServerSnapshot,
  DB_SCHEMA_VERSION,
} from "../db/client";

const alwaysCorrect: ConceptGrader = () => ({ correct: true, detail: "stub" });
const byId = new Map(DIAGNOSTIC_ITEMS.map(item => [item.id, item]));

function answerCurrent(session: DiagnosticSession): DiagnosticSession {
  const item = byId.get(session.currentItemId!)!;
  if (item.kind === "coding") {
    return recordCodingOutcome(session, item, { kind: "graded", passed: true, executionOk: true, graderVersion: "1.0.0" }, "code");
  }
  return answerConcept(session, item, "stub answer", alwaysCorrect);
}

function completeConfidentSession(): DiagnosticSession {
  let session = createDiagnosticSession();
  let guard = 0;
  while (nextDiagnosticItem(session) && guard++ < 40) session = answerCurrent(session);
  return completeDiagnosticSession(session);
}

const tempDirs: string[] = [];
const openHandles: { close(): void }[] = [];

function tempDbPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "coding-school-sqlite-test-"));
  tempDirs.push(dir);
  return join(dir, name);
}

function fileStats(path: string) {
  const stat = statSync(path);
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  return { size: stat.size, mtimeMs: stat.mtimeMs, sha256 };
}

afterEach(() => {
  for (const handle of openHandles.splice(0)) handle.close();
});

describe("sqlite learner-state persistence", () => {
  it("creates the expected tables and records the schema version", async () => {
    const dbPath = tempDbPath("schema.db");
    const { client } = openDatabase(dbPath);
    openHandles.push(client);
    await migrateDatabase(client);

    const tables = await client.execute(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`);
    const names = tables.rows.map(row => String(row.name));
    for (const expected of ["attempts", "mission_runs", "diagnostic_sessions", "review_state", "state_meta", "db_meta"]) {
      expect(names).toContain(expected);
    }
    const version = await client.execute({ sql: `SELECT value FROM db_meta WHERE key = 'schema_version'`, args: [] });
    expect(String(version.rows[0]?.value)).toBe(String(DB_SCHEMA_VERSION));

    // Idempotent: safe to run again on an existing database.
    await migrateDatabase(client);
  });

  it("returns a fresh default state from an empty, un-migrated database", async () => {
    const dbPath = tempDbPath("empty.db");
    const { client, db } = openDatabase(dbPath);
    openHandles.push(client);

    const loaded = await loadStateFromDatabase(db);
    expect(loaded.diagnosticSessions).toEqual([]);
    expect(loaded.attempts).toEqual([]);
    expect(loaded.diagnostic.completed).toBe(false);
  });

  it("round-trips diagnostic sessions, dashboard, and portfolio", async () => {
    const dbPath = tempDbPath("roundtrip.db");
    const { client, db } = openDatabase(dbPath);
    openHandles.push(client);
    await migrateDatabase(client);

    const session = completeConfidentSession();
    let state: LearningState = {
      ...createDefaultState(),
      dashboard: { activeTab: "assessment" },
      portfolio: [convertLegacyPortfolioSnapshot({ projectId: "project-csv-repair", title: "Repair a messy CSV", sourceFiles: { "main.py": "print('ok')" }, tests: [{ name: "removes blank rows", passed: true }], feedback: "ok", score: 0.9, skillIds: ["data-cleaning"], completedAt: "2026-09-10T12:00:00.000Z" })],
    };
    state = replaceDiagnosticSession(state, session);
    await saveStateToDatabase(db, state);

    const loaded = await loadStateFromDatabase(db);
    expect(loaded.dashboard.activeTab).toBe("assessment");
    expect(loaded.diagnostic.completed).toBe(true);
    expect(loaded.diagnostic.completedAt).toBe(session.completedAt);
    expect(loaded.diagnosticSessions).toHaveLength(1);
    expect(loaded.diagnosticSessions[0].id).toBe(session.id);
    expect(loaded.diagnosticSessions[0].responses).toHaveLength(session.responses.length);
    expect(loaded.portfolio[0]?.projectId).toBe("project-csv-repair");
  });

  it("keeps session history across multiple saves without duplicating", async () => {
    const dbPath = tempDbPath("history.db");
    const { client, db } = openDatabase(dbPath);
    openHandles.push(client);
    await migrateDatabase(client);

    const first = completeConfidentSession();
    await saveStateToDatabase(db, replaceDiagnosticSession(createDefaultState(), first));
    const second = completeConfidentSession();
    const reloaded = await loadStateFromDatabase(db);
    await saveStateToDatabase(db, replaceDiagnosticSession(reloaded, second));

    const loaded = await loadStateFromDatabase(db);
    expect(loaded.diagnosticSessions).toHaveLength(2);
    expect(new Set(loaded.diagnosticSessions.map(s => s.id)).size).toBe(2);
  });

  it("isolates test databases from each other", async () => {
    const pathA = tempDbPath("a.db");
    const pathB = tempDbPath("b.db");
    const a = openDatabase(pathA);
    const b = openDatabase(pathB);
    openHandles.push(a.client, b.client);
    await migrateDatabase(a.client);
    await migrateDatabase(b.client);

    await saveStateToDatabase(a.db, replaceDiagnosticSession(createDefaultState(), completeConfidentSession()));
    const loadedB = await loadStateFromDatabase(b.db);
    expect(loadedB.diagnosticSessions).toEqual([]);
  });

  it("records before/after database file stats around a write", async () => {
    const dbPath = tempDbPath("stats.db");
    const { client, db } = openDatabase(dbPath);
    openHandles.push(client);
    await migrateDatabase(client);

    const before = fileStats(dbPath);
    await saveStateToDatabase(db, replaceDiagnosticSession(createDefaultState(), completeConfidentSession()));
    const after = fileStats(dbPath);

    expect(after.size).toBeGreaterThan(before.size);
    expect(after.sha256).not.toBe(before.sha256);
    expect(after.mtimeMs).toBeGreaterThanOrEqual(before.mtimeMs);
  });
});

function assessmentAttempt(overrides: Partial<AssessmentTaskAttempt> = {}): AssessmentTaskAttempt {
  return {
    attemptId: "attempt-1",
    taskId: "foundations-debug-task",
    assessmentId: "foundations",
    skillId: "debugging",
    result: { passed: true, hintsUsed: 0, aiAssisted: false, solutionViewed: false },
    completedAt: "2026-09-14T12:00:00.000Z",
    ...overrides,
  };
}

function stateWithAssessmentAttempts(...attempts: AssessmentTaskAttempt[]): LearningState {
  let state = createDefaultState();
  for (const attempt of attempts) state = recordAssessmentAttempt(state, attempt);
  return state;
}

describe("assessment attempts persistence", () => {
  it("creates the assessment_attempts table", async () => {
    const dbPath = tempDbPath("assessment-schema.db");
    const { client } = openDatabase(dbPath);
    openHandles.push(client);
    await migrateDatabase(client);

    const tables = await client.execute(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`);
    const names = tables.rows.map(row => String(row.name));
    expect(names).toContain("assessment_attempts");
  });

  it("round-trips one assessment attempt through the plain save/load path", async () => {
    const dbPath = tempDbPath("assessment-roundtrip.db");
    const { client, db } = openDatabase(dbPath);
    openHandles.push(client);
    await migrateDatabase(client);

    await saveStateToDatabase(db, stateWithAssessmentAttempts(assessmentAttempt()));

    const loaded = await loadStateFromDatabase(db);
    expect(loaded.assessmentAttempts).toHaveLength(1);
    const record = loaded.assessmentAttempts[0]!;
    expect(record.attemptId).toBe("attempt-1");
    expect(record.taskId).toBe("foundations-debug-task");
    expect(record.assessmentId).toBe("foundations");
    expect(record.skillId).toBe("debugging");
    expect(record.passed).toBe(true);
    expect(record.completedAt).toBe("2026-09-14T12:00:00.000Z");
  });

  it("round-trips assessment attempts through the CAS revision path (raw SQL writer)", async () => {
    const dbPath = tempDbPath("assessment-cas.db");
    const { client } = openDatabase(dbPath);
    openHandles.push(client);

    const written = await trySaveStateWithRevision(client, stateWithAssessmentAttempts(assessmentAttempt()), 0);
    expect(written.ok).toBe(true);

    const snapshot = await readServerSnapshot(client);
    expect(snapshot.state).not.toBeNull();
    expect(snapshot.state!.assessmentAttempts).toHaveLength(1);
    expect(snapshot.state!.assessmentAttempts[0]!.attemptId).toBe("attempt-1");
    expect(snapshot.state!.assessmentAttempts[0]!.taskId).toBe("foundations-debug-task");
  });

  it("round-trips an empty assessment-attempts list", async () => {
    const dbPath = tempDbPath("assessment-empty.db");
    const { client, db } = openDatabase(dbPath);
    openHandles.push(client);
    await migrateDatabase(client);

    await saveStateToDatabase(db, createDefaultState());
    const loaded = await loadStateFromDatabase(db);
    expect(loaded.assessmentAttempts).toEqual([]);
  });

  it("updates across saves without duplicating attempt rows", async () => {
    const dbPath = tempDbPath("assessment-history.db");
    const { client, db } = openDatabase(dbPath);
    openHandles.push(client);
    await migrateDatabase(client);

    await saveStateToDatabase(db, stateWithAssessmentAttempts(assessmentAttempt()));
    const reloaded = await loadStateFromDatabase(db);
    const withSecond = recordAssessmentAttempt(
      reloaded,
      assessmentAttempt({ attemptId: "attempt-2", taskId: "foundations-scratch-task", skillId: "scratch-coding" }),
    );
    await saveStateToDatabase(db, withSecond);

    const loaded = await loadStateFromDatabase(db);
    expect(loaded.assessmentAttempts).toHaveLength(2);
    expect(new Set(loaded.assessmentAttempts.map(a => a.attemptId)).size).toBe(2);

    const rows = await client.execute(`SELECT id FROM assessment_attempts`);
    expect(rows.rows).toHaveLength(2);
  });
});
