import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultState, type LearningState } from "../lib/state";
import { GET, PUT } from "../app/api/state/route";
import { getServerDatabase, openDatabase, resetServerDatabaseForTests } from "../db/client";

const ENV_KEY = "CODING_SCHOOL_DB_PATH";
let savedEnv: string | undefined;
const openedClients: { close(): void }[] = [];

function tempDbPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), "coding-school-state-api-test-")), name);
}

function putRequest(body: unknown): Request {
  return new Request("http://localhost/api/state", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function learnedState(): LearningState {
  const state = createDefaultState();
  state.dashboard.activeTab = "learned";
  return state;
}

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  process.env[ENV_KEY] = tempDbPath("state-api.db");
  resetServerDatabaseForTests();
});

afterEach(async () => {
  // Close the singleton client so temp files are not left locked.
  try {
    const { client } = await getServerDatabase();
    openedClients.push(client);
  } catch { /* never opened */ }
  for (const handle of openedClients.splice(0)) handle.close();
  resetServerDatabaseForTests();
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

describe("GET /api/state", () => {
  it("returns revision 0 and null state for an empty database", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 0, state: null, updatedAt: null });
  });

  it("returns the stored snapshot after a write", async () => {
    const put = await PUT(putRequest({ revision: 0, state: learnedState() }));
    expect(put.status).toBe(200);
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { revision: number; state: LearningState; updatedAt: string };
    expect(body.revision).toBe(1);
    expect(body.state.dashboard.activeTab).toBe("learned");
    expect(typeof body.updatedAt).toBe("string");
  });
});

describe("PUT /api/state", () => {
  it("creates state at revision 0 and bumps to 1", async () => {
    const response = await PUT(putRequest({ revision: 0, state: createDefaultState() }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 1 });
  });

  it("increments the revision on sequential writes", async () => {
    expect((await PUT(putRequest({ revision: 0, state: createDefaultState() }))).status).toBe(200);
    const second = await PUT(putRequest({ revision: 1, state: learnedState() }));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ revision: 2 });
  });

  it("rejects a stale revision with 409 and the current server copy, writing nothing", async () => {
    await PUT(putRequest({ revision: 0, state: learnedState() }));
    const stale = await PUT(putRequest({ revision: 0, state: createDefaultState() }));
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { error: string; revision: number; state: LearningState };
    expect(body.error).toBe("revision_conflict");
    expect(body.revision).toBe(1);
    expect(body.state.dashboard.activeTab).toBe("learned");
    // Nothing was written: the stored snapshot is untouched.
    const after = (await (await GET()).json()) as { revision: number; state: LearningState };
    expect(after.revision).toBe(1);
    expect(after.state.dashboard.activeTab).toBe("learned");
  });

  it("rejects malformed bodies with 400 and writes nothing", async () => {
    const cases: unknown[] = [
      "{not json",
      { revision: "zero", state: createDefaultState() },
      { revision: -1, state: createDefaultState() },
      { revision: 0, state: "not-an-object" },
      { revision: 0 },
      { state: createDefaultState() },
      [1, 2, 3],
    ];
    for (const body of cases) {
      const response = await PUT(putRequest(body));
      expect(response.status).toBe(400);
    }
    const after = (await (await GET()).json()) as { revision: number; state: null };
    expect(after.revision).toBe(0);
    expect(after.state).toBeNull();
  });

  it("rejects oversized bodies with 413", async () => {
    const state = createDefaultState() as unknown as Record<string, unknown>;
    state.attempts = [{ id: "x".repeat(6 * 1024 * 1024) }];
    const response = await PUT(putRequest({ revision: 0, state }));
    expect(response.status).toBe(413);
    const after = (await (await GET()).json()) as { revision: number };
    expect(after.revision).toBe(0);
  });

  it("returns 503 when another process holds the write lock (SQLITE_BUSY)", async () => {
    const dbPath = process.env[ENV_KEY] as string;
    expect((await PUT(putRequest({ revision: 0, state: createDefaultState() }))).status).toBe(200);
    // Simulate a second server process mid-CAS: it holds BEGIN IMMEDIATE open.
    const other = openDatabase(dbPath);
    const holder = await other.client.transaction("write");
    try {
      const response = await PUT(putRequest({ revision: 1, state: learnedState() }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "temporarily_unavailable" });
    } finally {
      await holder.rollback();
      other.client.close();
    }
    // The rejected attempt wrote nothing.
    const after = (await (await GET()).json()) as { revision: number; state: LearningState };
    expect(after.revision).toBe(1);
    expect(after.state.dashboard.activeTab).toBe("overview");
    // The server recovered deterministically: the busy client was recycled
    // (not left poisoned), so the retry commits instead of failing.
    const retry = await PUT(putRequest({ revision: 1, state: learnedState() }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ revision: 2 });
  });
});
