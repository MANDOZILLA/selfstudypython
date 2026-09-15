import { describe, expect, it, vi } from "vitest";
import { createDefaultState, type LearningState } from "../lib/state";
import {
  decideBoot,
  fetchSnapshot,
  pushState,
  type FetchImpl,
  type ServerSnapshot,
} from "../lib/state-sync";

function snapshot(overrides: Partial<ServerSnapshot> = {}): ServerSnapshot {
  return { revision: 0, state: null, updatedAt: null, ...overrides };
}

function learnedState(): LearningState {
  const state = createDefaultState();
  state.dashboard.activeTab = "learned";
  return state;
}

function jsonResponse(status: number, body: unknown): { status: number; json(): Promise<unknown> } {
  return { status, json: async () => body };
}

describe("decideBoot", () => {
  it("adopts the server state when the server has one and local is empty", () => {
    const server = snapshot({ revision: 3, state: learnedState() });
    expect(decideBoot(server, null)).toEqual({ action: "adopt-server", revision: 3 });
  });

  it("adopts the server state when local matches the server copy", () => {
    const state = learnedState();
    const server = snapshot({ revision: 2, state });
    // Same content (structured clone keeps key order) -> no backup needed.
    expect(decideBoot(server, JSON.parse(JSON.stringify(state)))).toEqual({ action: "adopt-server", revision: 2 });
  });

  it("backs up differing local state and adopts the server copy", () => {
    const server = snapshot({ revision: 4, state: learnedState() });
    const local = createDefaultState(); // differs from server
    expect(decideBoot(server, local)).toEqual({ action: "adopt-server-with-local-backup", revision: 4 });
  });

  it("migrates local state up when the server is empty", () => {
    expect(decideBoot(snapshot(), learnedState())).toEqual({ action: "migrate-local" });
  });

  it("starts fresh when both server and local are empty", () => {
    expect(decideBoot(snapshot(), null)).toEqual({ action: "fresh" });
  });

  it("surfaces a boot conflict when the server went backwards since the last sync", () => {
    // Server DB replaced while the tab was closed: the server copy is older
    // than what this browser last synced, and local holds newer work.
    const server = snapshot({ revision: 2, state: learnedState() });
    const local = createDefaultState(); // differs — newer offline work
    expect(decideBoot(server, local, 5)).toEqual({ action: "boot-conflict", revision: 2 });
  });

  it("adopts the server when the local copy matches it, even if the revision looks older", () => {
    const state = learnedState();
    const server = snapshot({ revision: 2, state });
    expect(decideBoot(server, JSON.parse(JSON.stringify(state)), 5)).toEqual({ action: "adopt-server", revision: 2 });
  });

  it("adopts the newer server copy with a backup when the server moved ahead", () => {
    const server = snapshot({ revision: 9, state: learnedState() });
    expect(decideBoot(server, createDefaultState(), 5)).toEqual({
      action: "adopt-server-with-local-backup",
      revision: 9,
    });
  });

  it("keeps the legacy behavior when no last-synced revision was recorded", () => {
    const server = snapshot({ revision: 4, state: learnedState() });
    expect(decideBoot(server, createDefaultState(), null)).toEqual({
      action: "adopt-server-with-local-backup",
      revision: 4,
    });
  });

  it("pushes newer local work when the server is unchanged since the last sync", () => {
    // Server at exactly the last-synced revision with differing local state:
    // the difference is strictly newer unsynced work (e.g. written offline),
    // so it is pushed up instead of being superseded.
    const server = snapshot({ revision: 5, state: learnedState() });
    expect(decideBoot(server, createDefaultState(), 5)).toEqual({ action: "sync-local", revision: 5 });
  });
});

describe("pushState", () => {
  const url = "/api/state";

  it("maps 200 to ok with the new revision", async () => {
    const fetchImpl: FetchImpl = async () => jsonResponse(200, { revision: 7 });
    expect(await pushState(fetchImpl, url, 6, createDefaultState())).toEqual({ ok: true, revision: 7 });
  });

  it("maps 409 to a conflict carrying the server copy", async () => {
    const serverState = learnedState();
    const fetchImpl: FetchImpl = async () =>
      jsonResponse(409, { error: "revision_conflict", revision: 9, state: serverState });
    const outcome = await pushState(fetchImpl, url, 6, createDefaultState());
    expect(outcome).toEqual({ conflict: true, revision: 9, state: serverState });
  });

  it("maps a network failure to offline without throwing", async () => {
    const fetchImpl: FetchImpl = async () => { throw new Error("connection refused"); };
    expect(await pushState(fetchImpl, url, 6, createDefaultState())).toEqual({ offline: true });
  });

  it("maps 400/413 to rejected", async () => {
    const bad: FetchImpl = async () => jsonResponse(400, { error: "invalid_request" });
    expect(await pushState(bad, url, 6, createDefaultState())).toEqual({ rejected: true, reason: "http_400" });
    const big: FetchImpl = async () => jsonResponse(413, { error: "too_large" });
    expect(await pushState(big, url, 6, createDefaultState())).toEqual({ rejected: true, reason: "http_413" });
  });

  it("maps 5xx to offline so a server failure never fabricates state", async () => {
    const fetchImpl: FetchImpl = async () => jsonResponse(500, { error: "boom" });
    expect(await pushState(fetchImpl, url, 6, createDefaultState())).toEqual({ offline: true });
  });

  it("sends revision and state as JSON with a PUT", async () => {
    const seen: { url?: string; init?: unknown } = {};
    const fetchImpl: FetchImpl = async (u, init) => {
      seen.url = u; seen.init = init;
      return jsonResponse(200, { revision: 1 });
    };
    const state = learnedState();
    await pushState(fetchImpl, url, 0, state);
    expect(seen.url).toBe(url);
    const init = seen.init as { method: string; body: string };
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ revision: 0, state: JSON.parse(JSON.stringify(state)) });
  });
});

describe("fetchSnapshot", () => {
  const url = "/api/state";

  it("returns the snapshot on 200 with a valid shape", async () => {
    const body = { revision: 2, state: learnedState(), updatedAt: "2026-09-14T00:00:00.000Z" };
    const fetchImpl: FetchImpl = async () => jsonResponse(200, body);
    const result = await fetchSnapshot(fetchImpl, url, 1000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.revision).toBe(2);
      expect(result.snapshot.state?.dashboard.activeTab).toBe("learned");
    }
  });

  it("returns not-ok when the server is unreachable", async () => {
    const fetchImpl: FetchImpl = async () => { throw new Error("down"); };
    expect(await fetchSnapshot(fetchImpl, url, 1000)).toEqual({ ok: false });
  });

  it("times out a hanging server instead of blocking boot forever", async () => {
    vi.useFakeTimers();
    try {
      // Faithful stub: a real fetch rejects when the abort signal fires.
      const fetchImpl: FetchImpl = (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      const pending = fetchSnapshot(fetchImpl, url, 50);
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toEqual({ ok: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns not-ok on malformed payloads", async () => {
    const fetchImpl: FetchImpl = async () => jsonResponse(200, { revision: "nope" });
    expect(await fetchSnapshot(fetchImpl, url, 1000)).toEqual({ ok: false });
  });
});
