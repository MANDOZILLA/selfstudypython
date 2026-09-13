import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { openRepository, resolveDatabasePath } from "../db/repository";
import { advanceMissionStage, createDefaultState, recordMissionAttempt, startOrResumeMission } from "../lib/state";
import { getTask } from "../lib/curriculum";
import { getGrader } from "../public/grading/catalog.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function database() {
  const directory = await mkdtemp(join(tmpdir(), "coding-school-db-test-"));
  const path = join(directory, "test.db");
  const repo = await openRepository(path);
  cleanup.push(async () => { repo.close(); await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }).catch(error => { if (error.code !== "EBUSY") throw error; }); });
  return { repo, path };
}
function fullState() {
  const now = new Date("2026-09-11T12:00:00.000Z");
  let state = startOrResumeMission(createDefaultState(), now);
  const runId = state.missionRuns[0].id;
  for (let stage = 0; stage < 4; stage++) {
    for (const taskId of state.missionRuns[0].stages[stage].taskIds) {
      const variant = getTask(taskId)!.variants[0];
      const grader = getGrader(variant.exerciseId, variant.graderId);
      state = recordMissionAttempt(state, runId, taskId, {
        variantId: variant.id, sourceFiles: { "main.py": "'; DROP TABLE attempts; --\nprint('你好')" },
        response: "I validated the record before using its value.",
        assistance: { hintsUsed: 1, aiAssisted: false, solutionViewed: false },
        result: grader ? { graderVersion: grader.version, executionOk: true, tests: grader.requiredTests.map((id: string) => ({ id, name: id, passed: true, required: true, detail: "actual check" })) } : undefined,
      }, now);
    }
    state = advanceMissionStage(state, runId, now);
  }
  state.dashboard.activeTab = "assessment";
  state.diagnostic = { completed: true, completedAt: now.toISOString() };
  state.portfolio = [{ projectId: "csv-project", title: "My export", sourceFiles: { "main.py": "print(1)" }, tests: [{ name: "exports", passed: true }], feedback: "My note", score: 1, skillIds: ["csv-cleaning"], completedAt: now.toISOString() }];
  return state;
}
const request = (state = createDefaultState(), revision = 0, requestId = crypto.randomUUID()) => ({ state, revision, requestId, learningMode: true, operation: "save" as const });

describe("durable learner repository", () => {
  it("rejects remote URLs, network shares, encoded paths and Windows alternate streams", async () => {
    for (const path of ["libsql://remote/db", "file:C:/test.db", "relative.db", "\\\\server\\share\\test.db", "C:/test%2fescape.db", "C:/test.db:stream.db"]) {
      await expect(resolveDatabasePath(path)).rejects.toMatchObject({ code: "invalid" });
    }
  });
  it("migrates fresh databases and reruns without resetting saved evidence", async () => {
    const { repo, path } = await database();
    expect(await repo.load()).toMatchObject({ revision: 0, initialized: false, state: createDefaultState() });
    const state = fullState();
    await repo.save(request(state));
    repo.close();
    const reopened = await openRepository(path);
    cleanup.push(async () => reopened.close());
    expect((await reopened.load()).state).toEqual(state);
    expect(await reopened.health()).toMatchObject({ ok: true, schemaVersion: 1, journalMode: "wal", foreignKeys: true });
    expect(JSON.parse(await reopened.exportJson()).state).toEqual(state);
  });
  it("rejects stale revisions and returns the same receipt for an identical retry", async () => {
    const { repo } = await database();
    const first = request(fullState());
    expect(await repo.save(first)).toEqual({ revision: 1, requestId: first.requestId });
    expect(await repo.save(first)).toEqual({ revision: 1, requestId: first.requestId });
    await expect(repo.save({ ...first, learningMode: false })).rejects.toMatchObject({ code: "conflict" });
    await expect(repo.save(request())).rejects.toMatchObject({ code: "conflict" });
    expect((await repo.load()).revision).toBe(1);
  });
  it("imports legacy state once and cannot overwrite an initialized database", async () => {
    const { repo } = await database();
    const first = { ...request(fullState()), operation: "import" as const };
    await repo.save(first);
    expect((await repo.load()).legacyImported).toBe(true);
    await expect(repo.save({ ...first, requestId: crypto.randomUUID(), revision: 1 })).rejects.toMatchObject({ code: "conflict" });
    expect((await repo.load()).state.attempts).toHaveLength(4);
  });
  it("rolls back related writes when a database constraint rejects an insert", async () => {
    const { repo, path } = await database();
    await repo.save(request());
    const client = createClient({ url: `file:${path.replaceAll("\\", "/")}` });
    await client.execute("CREATE TRIGGER fail_attempt BEFORE INSERT ON attempts BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    await expect(repo.save(request(fullState(), 1))).rejects.toMatchObject({ code: "unavailable" });
    expect(await repo.load()).toMatchObject({ revision: 1, state: createDefaultState() });
    client.close();
  });
  it("enforces relationships, checks and indexed lookups", async () => {
    const { repo, path } = await database();
    await repo.save(request(fullState()));
    const client = createClient({ url: `file:${path.replaceAll("\\", "/")}` });
    await client.execute("PRAGMA foreign_keys=ON");
    await expect(client.execute("UPDATE attempts SET run_id='missing'")).rejects.toThrow();
    await expect(client.execute("UPDATE mission_runs SET stage_index=9")).rejects.toThrow();
    const plan = await client.execute({ sql: "EXPLAIN QUERY PLAN SELECT * FROM attempts WHERE run_id=?", args: ["run"] });
    expect(JSON.stringify(plan.rows)).toMatch(/INDEX/);
    expect((await client.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
    client.close();
  });
  it("rejects malformed and oversized input without mutation", async () => {
    const { repo } = await database();
    await expect(repo.save({ ...request(), state: {} } as never)).rejects.toMatchObject({ code: "invalid" });
    const state = fullState(); state.attempts[0].response = "x".repeat(2_100_000);
    await expect(repo.save(request(state))).rejects.toMatchObject({ code: "invalid" });
    const invalid = fullState(); invalid.missionRuns[0].missionId = "unknown";
    await expect(repo.save(request(invalid))).rejects.toMatchObject({ code: "invalid" });
    expect((await repo.load()).revision).toBe(0);
  });
});
