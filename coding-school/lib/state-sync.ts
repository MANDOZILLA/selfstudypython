import type { LearningState } from "./state";

/**
 * Client/server state synchronization for the durable SQLite store.
 *
 * Pure logic only (no React, no DOM): the useStudio hook drives these
 * functions. SQLite on the server is the durable source of truth; browser
 * localStorage is a write-through cache and offline fallback. Optimistic
 * concurrency via revisions: a push that loses a race gets a 409 with the
 * current server copy, and the local copy is never silently discarded.
 */

export type ServerSnapshot = { revision: number; state: LearningState | null; updatedAt: string | null };

export type BootDecision =
  | { action: "adopt-server"; revision: number }
  | { action: "migrate-local" }
  | { action: "fresh" }
  | { action: "adopt-server-with-local-backup"; revision: number }
  | { action: "boot-conflict"; revision: number }
  | { action: "sync-local"; revision: number };

/**
 * Decide how to boot given the durable server snapshot, the local cache,
 * and the revision this browser last synced (null when unknown — e.g. the
 * pre-revision localStorage era or a cleared key).
 *
 * The server normally wins, but it must never visibly reset work that is
 * provably newer: when the server revision is OLDER than the browser's last
 * acknowledged write (server restored from an older backup), or UNCHANGED
 * while the local copy differs (offline work written after the last sync),
 * the local copy is kept and surfaced instead of being superseded.
 */
export function decideBoot(
  server: ServerSnapshot,
  local: LearningState | null,
  lastSyncedRevision: number | null = null,
): BootDecision {
  if (server.state) {
    const differs = !!local && JSON.stringify(local) !== JSON.stringify(server.state);
    if (differs && lastSyncedRevision !== null) {
      if (server.revision < lastSyncedRevision) {
        return { action: "boot-conflict", revision: server.revision };
      }
      if (server.revision === lastSyncedRevision) {
        return { action: "sync-local", revision: server.revision };
      }
    }
    if (differs) return { action: "adopt-server-with-local-backup", revision: server.revision };
    return { action: "adopt-server", revision: server.revision };
  }
  if (local) return { action: "migrate-local" };
  return { action: "fresh" };
}

export type PushOutcome =
  | { ok: true; revision: number }
  | { conflict: true; revision: number; state: LearningState }
  | { offline: true }
  | { rejected: true; reason: string };

/** Minimal fetch surface so tests can inject a stub. */
export type FetchImpl = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal; keepalive?: boolean },
) => Promise<{ status: number; json(): Promise<unknown> }>;

async function readJson(response: { json(): Promise<unknown> }): Promise<Record<string, unknown> | null> {
  try {
    const body = await response.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Push local state to the durable store. Never throws: network failures and
 * server errors become {offline:true} so the caller keeps working locally
 * instead of fabricating or resetting state.
 */
export async function pushState(
  fetchImpl: FetchImpl,
  url: string,
  revision: number,
  state: LearningState,
): Promise<PushOutcome> {
  let response: { status: number; json(): Promise<unknown> };
  try {
    response = await fetchImpl(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision, state }),
    });
  } catch {
    return { offline: true };
  }
  if (response.status === 200) {
    const body = await readJson(response);
    return typeof body?.revision === "number"
      ? { ok: true, revision: body.revision }
      : { rejected: true, reason: "bad_response" };
  }
  if (response.status === 409) {
    const body = await readJson(response);
    const serverRevision = body?.revision;
    const serverState = body?.state;
    if (typeof serverRevision === "number" && typeof serverState === "object" && serverState !== null) {
      return { conflict: true, revision: serverRevision, state: serverState as LearningState };
    }
    return { rejected: true, reason: "bad_conflict" };
  }
  if (response.status === 400 || response.status === 413) {
    return { rejected: true, reason: `http_${response.status}` };
  }
  // 5xx and anything unexpected: transient — stay offline and retry later.
  return { offline: true };
}

export type SnapshotResult = { ok: true; snapshot: ServerSnapshot } | { ok: false };

function isSnapshot(body: Record<string, unknown> | null): body is Record<string, unknown> {
  if (!body || typeof body.revision !== "number") return false;
  const state = body.state;
  return state === null || (typeof state === "object" && state !== null);
}

/** Fetch the durable snapshot, timing out instead of blocking boot forever. */
export async function fetchSnapshot(
  fetchImpl: FetchImpl,
  url: string,
  timeoutMs: number,
): Promise<SnapshotResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (response.status !== 200) return { ok: false };
    const body = await readJson(response);
    if (!isSnapshot(body)) return { ok: false };
    return {
      ok: true,
      snapshot: {
        revision: body.revision as number,
        state: (body.state as LearningState | null) ?? null,
        updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : null,
      },
    };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
