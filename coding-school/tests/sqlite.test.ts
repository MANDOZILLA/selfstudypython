import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  createDefaultState,
  replaceDiagnosticSession,
  type LearningState,
} from "../lib/state";
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
      portfolio: [{ projectId: "project-csv-repair", title: "Repair a messy CSV", sourceFiles: { "main.py": "print('ok')" }, tests: [{ name: "removes blank rows", passed: true }], feedback: "ok", score: 0.9, skillIds: ["data-cleaning"], completedAt: "2026-09-10T12:00:00.000Z" }],
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
