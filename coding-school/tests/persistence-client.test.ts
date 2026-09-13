import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openRepository } from "../db/repository";
import { handleLearnerRequest } from "../db/http";
import { LearnerStore } from "../lib/learner-store";
import { createDefaultState, startOrResumeMission } from "../lib/state";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "coding-school-client-test-"));
  const repo = await openRepository(join(directory, "test.db"));
  cleanup.push(async () => { repo.close(); await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }).catch(error => { if (error.code !== "EBUSY") throw error; }); });
  let unavailable = false, loseReceipt = false;
  const transport: typeof fetch = async (input, init) => {
    if (unavailable) throw new TypeError("Failed to fetch");
    const headers = new Headers(init?.headers); headers.set("origin", "http://localhost:3000");
    const response = await handleLearnerRequest(new Request(`http://localhost:3000${input}`, { ...init, headers }), async () => repo);
    if (loseReceipt && init?.method === "PUT") { loseReceipt = false; throw new TypeError("Connection lost after commit"); }
    return response;
  };
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  return { repo, transport, storage, values, offline: (value: boolean) => { unavailable = value; }, loseReceipt: () => { loseReceipt = true; } };
}
describe("SQLite client adapter", () => {
  it("requires hydration and serializes changes against the last acknowledged revision", async () => {
    const { transport, storage } = await setup();
    const store = new LearnerStore(transport, () => storage);
    await expect(store.save(state => state)).rejects.toThrow();
    await store.hydrate();
    await Promise.all([store.save(state => startOrResumeMission(state)), store.save(state => ({ ...state, dashboard: { activeTab: "lessons" } }))]);
    const reload = new LearnerStore(transport, () => storage);
    const result = await reload.hydrate();
    expect(result.snapshot).toMatchObject({ revision: 2, state: { dashboard: { activeTab: "lessons" } } });
    expect(result.snapshot.state.missionRuns).toHaveLength(1);
  });
  it("offers valid legacy state, retains a backup and imports only with explicit action", async () => {
    const { transport, storage, repo, values } = await setup();
    const legacy = startOrResumeMission(createDefaultState());
    const raw = JSON.stringify(legacy); storage.setItem("coding-school:learner-state", raw);
    const store = new LearnerStore(transport, () => storage);
    expect((await store.hydrate()).legacy?.state).toEqual(legacy);
    expect((await repo.load()).initialized).toBe(false);
    await store.importLegacy();
    expect((await repo.load()).legacyImported).toBe(true);
    expect(values.get("coding-school:sqlite-import-backup")).toBe(raw);
    expect((await new LearnerStore(transport, () => storage).hydrate()).legacy).toBeNull();
  });
  it("keeps corrupt browser state recoverable and never imports its fabricated default", async () => {
    const { transport, storage, repo } = await setup();
    storage.setItem("coding-school:learner-state", "{ broken");
    await expect(new LearnerStore(transport, () => storage).hydrate()).rejects.toMatchObject({ raw: "{ broken" });
    expect((await repo.load()).initialized).toBe(false);
  });
  it("does not fabricate a state on server failure or advance a failed save; retries a lost receipt once", async () => {
    const { transport, storage, repo, offline, loseReceipt } = await setup();
    const store = new LearnerStore(transport, () => storage);
    offline(true);
    await expect(store.hydrate()).rejects.toThrow(/unavailable/i);
    expect(store.snapshot).toBeNull();
    offline(false); await store.hydrate();
    loseReceipt();
    await expect(store.save(state => startOrResumeMission(state))).rejects.toThrow(/unavailable/i);
    expect(store.snapshot?.state.missionRuns).toHaveLength(0);
    expect(store.pending).not.toBeNull();
    await expect(store.save(state => state)).rejects.toThrow();
    await store.retry();
    expect(store.snapshot?.state.missionRuns).toHaveLength(1);
    expect((await repo.load()).revision).toBe(1);
  });
  it("retains pending work when another tab wins and never overwrites it", async () => {
    const { transport, storage, repo } = await setup();
    const a = new LearnerStore(transport, () => storage), b = new LearnerStore(transport, () => storage);
    await a.hydrate(); await b.hydrate();
    await a.save(state => startOrResumeMission(state));
    await expect(b.save(state => ({ ...state, diagnostic: { completed: true, completedAt: null } }))).rejects.toMatchObject({ code: "conflict" });
    expect(b.pending?.state.diagnostic.completed).toBe(true);
    expect((await repo.load()).state.diagnostic.completed).toBe(false);
  });
});
