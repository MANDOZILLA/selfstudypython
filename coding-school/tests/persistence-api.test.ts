import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openRepository, type LearnerRepository } from "../db/repository";
import { handleLearnerRequest } from "../db/http";
import { createDefaultState } from "../lib/state";

let repo: LearnerRepository;
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "coding-school-api-test-")); repo = await openRepository(join(directory, "test.db")); });
afterEach(async () => { repo.close(); await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }).catch(error => { if (error.code !== "EBUSY") throw error; }); });
function request(body?: unknown, method = body ? "PUT" : "GET") {
  return new Request("http://localhost:3000/api/learner", { method, headers: { "content-type": "application/json", "x-coding-school": "local", origin: "http://localhost:3000" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
}
const payload = () => ({ revision: 0, requestId: crypto.randomUUID(), state: createDefaultState(), learningMode: true, operation: "save" });
describe("learner API", () => {
  it("loads and saves validated snapshots with no caching", async () => {
    const get = await handleLearnerRequest(request(), async () => repo);
    expect(get.headers.get("cache-control")).toContain("no-store");
    expect(await get.json()).toMatchObject({ revision: 0, initialized: false });
    const put = await handleLearnerRequest(request(payload()), async () => repo);
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ revision: 1 });
    expect((await handleLearnerRequest(request(payload()), async () => repo)).status).toBe(409);
  });
  it("rejects invalid, corrupt and oversized bodies before mutation", async () => {
    for (const body of ["{", {}, { ...payload(), state: { version: 2 } }, "x".repeat(2_100_000)]) {
      const response = await handleLearnerRequest(request(body), async () => repo);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid" });
    }
    expect((await repo.load()).revision).toBe(0);
  });
  it("blocks cross-origin, missing application headers, unsupported methods, and masks internal errors", async () => {
    const cross = request(payload()); cross.headers.set("origin", "https://attacker.example");
    expect((await handleLearnerRequest(cross, async () => repo)).status).toBe(403);
    expect((await handleLearnerRequest(new Request("http://localhost:3000/api/learner"), async () => repo)).status).toBe(403);
    expect((await handleLearnerRequest(request(undefined, "DELETE"), async () => repo)).status).toBe(405);
    const failure = await handleLearnerRequest(request(), async () => { throw new Error("SQLITE internal secret C:/private"); });
    expect(failure.status).toBe(503);
    expect(JSON.stringify(await failure.json())).not.toMatch(/SQLITE|private|secret/);
  });
});
