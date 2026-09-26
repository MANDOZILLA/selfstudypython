import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client, Transaction } from "@libsql/client";
import { createDefaultState, type LearningState } from "../lib/state";
import {
  getServerDatabase,
  getStateRevision,
  loadStateFromDatabase,
  migrateDatabase,
  openDatabase,
  readServerSnapshot,
  resolveDatabasePath,
  resetServerDatabaseForTests,
  trySaveStateWithRevision,
} from "../db/client";

const ENV_KEY = "CODING_SCHOOL_DB_PATH";
let savedEnv: string | undefined;

function tempDbPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), "coding-school-revision-test-")), name);
}

const openHandles: { close(): void }[] = [];
function trackedOpen(dbPath: string) {
  const handle = openDatabase(dbPath);
  openHandles.push(handle.client);
  return handle;
}

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  resetServerDatabaseForTests();
});

afterEach(() => {
  for (const handle of openHandles.splice(0)) handle.close();
  resetServerDatabaseForTests();
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

function stateWithTab(tab: LearningState["dashboard"]["activeTab"]): LearningState {
  const state = createDefaultState();
  state.dashboard.activeTab = tab;
  return state;
}

describe("sqlite revision protocol", () => {
  it("keeps snapshot content paired with its revision when a writer commits during the read", async () => {
    const path = tempDbPath("snapshot-race.db");
    const reader = trackedOpen(path);
    const writer = trackedOpen(path);
    await trySaveStateWithRevision(reader.client, stateWithTab("learned"), 0);
    let advanced = false;
    const advance = async () => {
      if (advanced) return;
      advanced = true;
      await writer.client.batch([
        { sql: "UPDATE db_meta SET value = '2' WHERE key = 'state_revision'", args: [] },
        { sql: "UPDATE state_meta SET payload = ? WHERE id = 'singleton'", args: [JSON.stringify({ dashboard: { activeTab: "portfolio" }, portfolio: [] })] },
      ], "write");
    };
    const intercepted = new Proxy(reader.client, {
      get(target, property) {
        if (property === "execute") return async (...args: Parameters<Client["execute"]>) => {
          const result = await target.execute(...args);
          const statement: unknown = args[0];
          const sql = typeof statement === "string" ? statement : (statement as { sql: string }).sql;
          if (/SELECT value FROM db_meta/i.test(sql)) await advance();
          return result;
        };
        if (property === "batch") return async (...args: Parameters<Client["batch"]>) => {
          const result = await target.batch(...args);
          await advance();
          return result;
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const snapshot = await readServerSnapshot(intercepted);
    expect(advanced).toBe(true);
    expect(snapshot.revision).toBe(1);
    expect(snapshot.state?.dashboard.activeTab).toBe("learned");
    expect(await getStateRevision(writer.client)).toBe(2);
  });

  it("does not report corrupted durable payloads as successful empty snapshots", async () => {
    const { client } = trackedOpen(tempDbPath("corrupt.db"));
    await trySaveStateWithRevision(client, stateWithTab("learned"), 0);
    await client.execute("INSERT INTO attempts (id, run_id, updated_at, payload) VALUES ('broken', 'run', '2026-09-15', '{broken')");
    await expect(readServerSnapshot(client)).rejects.toThrow();
  });

  it("keeps conflict content paired with the revision checked before releasing the lock", async () => {
    const path = tempDbPath("conflict-race.db");
    const reader = trackedOpen(path);
    const writer = trackedOpen(path);
    await trySaveStateWithRevision(reader.client, stateWithTab("learned"), 0);
    const intercepted = new Proxy(reader.client, {
      get(target, property) {
        if (property === "transaction") return async (...args: Parameters<Client["transaction"]>) => {
          const tx = await target.transaction(...args);
          return new Proxy(tx, {
            get(transaction, key) {
              if (key === "rollback") return async () => {
                await transaction.rollback();
                await writer.client.batch([
                  "UPDATE db_meta SET value = '2' WHERE key = 'state_revision'",
                  { sql: "UPDATE state_meta SET payload = ? WHERE id = 'singleton'", args: [JSON.stringify({ dashboard: { activeTab: "portfolio" }, portfolio: [] })] },
                ], "write");
              };
              const value = Reflect.get(transaction, key);
              return typeof value === "function" ? value.bind(transaction) : value;
            },
          }) as Transaction;
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await trySaveStateWithRevision(intercepted, createDefaultState(), 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.revision).toBe(1);
      expect(result.state.dashboard.activeTab).toBe("learned");
    }
    expect(await getStateRevision(writer.client)).toBe(2);
  });

  it("importing the client module and resolving a path never create a data directory", () => {
    const dataDir = join(mkdtempSync(join(tmpdir(), "coding-school-lazy-test-")), "uncreated");
    process.env[ENV_KEY] = join(dataDir, "state.db");
    expect(existsSync(dataDir)).toBe(false);
    expect(resolveDatabasePath()).toBe(join(dataDir, "state.db"));
    expect(existsSync(dataDir)).toBe(false);
  });

  it("resolveDatabasePath prefers CODING_SCHOOL_DB_PATH and is side-effect free", () => {
    process.env[ENV_KEY] = "/tmp/custom-location/verify.db";
    expect(resolveDatabasePath()).toBe("/tmp/custom-location/verify.db");
    expect(existsSync("/tmp/custom-location")).toBe(false);
    delete process.env[ENV_KEY];
    const fallback = resolveDatabasePath();
    expect(fallback.endsWith(join(".data", "coding-school.db"))).toBe(true);
    expect(fallback).toContain("coding-school");
  });

  it("getStateRevision returns 0 on a fresh migrated database", async () => {
    const { client } = trackedOpen(tempDbPath("fresh.db"));
    await migrateDatabase(client);
    expect(await getStateRevision(client)).toBe(0);
  });

  it("a first write with expected revision 0 succeeds and bumps to 1", async () => {
    const { client } = trackedOpen(tempDbPath("first.db"));
    const result = await trySaveStateWithRevision(client, stateWithTab("learned"), 0);
    expect(result).toEqual({ ok: true, revision: 1 });
    expect(await getStateRevision(client)).toBe(1);
  });

  it("a stale write is rejected without touching stored state", async () => {
    const { client, db } = trackedOpen(tempDbPath("stale.db"));
    const first = await trySaveStateWithRevision(client, stateWithTab("learned"), 0);
    expect(first.ok).toBe(true);
    const stale = await trySaveStateWithRevision(client, stateWithTab("portfolio"), 0);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.revision).toBe(1);
      expect(stale.state.dashboard.activeTab).toBe("learned");
    }
    // The rejected write changed nothing: revision and content are intact.
    expect(await getStateRevision(client)).toBe(1);
    const reloaded = await loadStateFromDatabase(db);
    expect(reloaded.dashboard.activeTab).toBe("learned");
  });

  it("sequential writes with the current revision each succeed", async () => {
    const { client } = trackedOpen(tempDbPath("seq.db"));
    expect(await trySaveStateWithRevision(client, createDefaultState(), 0)).toEqual({ ok: true, revision: 1 });
    expect(await trySaveStateWithRevision(client, stateWithTab("lessons"), 1)).toEqual({ ok: true, revision: 2 });
    expect(await getStateRevision(client)).toBe(2);
  });

  it("two concurrent writers with the same expected revision: exactly one wins", async () => {
    const dbPath = tempDbPath("race.db");
    const a = trackedOpen(dbPath);
    const b = trackedOpen(dbPath);
    const setup = await trySaveStateWithRevision(a.client, createDefaultState(), 0);
    expect(setup).toEqual({ ok: true, revision: 1 });
    const [ra, rb] = await Promise.all([
      trySaveStateWithRevision(a.client, stateWithTab("learned"), 1),
      trySaveStateWithRevision(b.client, stateWithTab("portfolio"), 1),
    ]);
    const winners = [ra, rb].filter(r => r.ok);
    const losers = [ra, rb].filter(r => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(winners[0]).toEqual({ ok: true, revision: 2 });
    if (!losers[0].ok) expect(losers[0].revision).toBe(2);
    expect(await getStateRevision(a.client)).toBe(2);
  });

  it("opens the compare-and-swap in an IMMEDIATE ('write') transaction", async () => {
    const { client } = trackedOpen(tempDbPath("immediate.db"));
    const modes: Array<string | undefined> = [];
    const spied = new Proxy(client, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return (mode?: string) => {
            modes.push(mode);
            return (target.transaction as (mode?: string) => Promise<unknown>)(mode);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const result = await trySaveStateWithRevision(spied as Client, createDefaultState(), 0);
    expect(result.ok).toBe(true);
    // Regression: drizzle-orm's libsql driver silently ignores the transaction
    // behavior option, so the CAS must request the libsql "write" mode
    // (BEGIN IMMEDIATE) directly — a second process must fail fast with
    // SQLITE_BUSY, never silently overwrite the winner.
    expect(modes).toEqual(["write"]);
  });

  it("a second connection cannot slip a write past an open CAS transaction (no lost update)", async () => {
    const dbPath = tempDbPath("busy.db");
    const a = trackedOpen(dbPath);
    const b = trackedOpen(dbPath);
    expect(await trySaveStateWithRevision(b.client, createDefaultState(), 0)).toEqual({ ok: true, revision: 1 });
    // Simulate a second server process mid-CAS: it holds the write lock.
    const holder = await a.client.transaction("write");
    try {
      await expect(trySaveStateWithRevision(b.client, stateWithTab("learned"), 1)).rejects.toThrow(/SQLITE_BUSY/);
    } finally {
      await holder.rollback();
    }
    // The failed write changed nothing: the busy loser never got past BEGIN.
    // NB: the client that hit SQLITE_BUSY is never touched again — a failed
    // BEGIN IMMEDIATE leaves it unable to COMMIT later transactions and any
    // further use can wedge the lock for other connections (driver quirk).
    // Production recovers via closeServerDatabase(); here a fresh client
    // plays that role.
    const c = trackedOpen(dbPath);
    expect((await readServerSnapshot(c.client)).revision).toBe(1);
    // Once the lock is released the same write succeeds on the fresh client.
    expect(await trySaveStateWithRevision(c.client, stateWithTab("learned"), 1)).toEqual({ ok: true, revision: 2 });
  });

  it("getServerDatabase opens the env-configured path and caches per path", async () => {    const dbPath = tempDbPath("singleton.db");
    process.env[ENV_KEY] = dbPath;
    const first = await getServerDatabase();
    const second = await getServerDatabase();
    expect(first.client).toBe(second.client);
    expect(await getStateRevision(first.client)).toBe(0);
    expect(existsSync(dbPath)).toBe(true);
    resetServerDatabaseForTests();
    const otherPath = tempDbPath("singleton-2.db");
    process.env[ENV_KEY] = otherPath;
    const third = await getServerDatabase();
    expect(third.client).not.toBe(first.client);
    expect(existsSync(otherPath)).toBe(true);
    third.client.close();
    first.client.close();
  });
});
