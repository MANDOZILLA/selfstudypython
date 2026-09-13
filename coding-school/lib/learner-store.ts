import { learningStateSchema, MAX_STATE_BYTES, PersistenceError, errorSchema, receiptSchema, snapshotSchema, type SaveRequest, type Snapshot } from "./persistence-contract";
import { StateRecoveryError, type LearningState } from "./state";
type BrowserStorage = Pick<Storage, "getItem" | "setItem">;
type Legacy = { raw: string; state: LearningState; learningMode: boolean };

/** Browser adapter only: no database imports and no offline evidence fork. */
export class LearnerStore {
  snapshot: Snapshot | null = null;
  pending: SaveRequest | null = null;
  legacy: Legacy | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private transport: typeof fetch = fetch, private storage: () => BrowserStorage | null = () => { try { return window.localStorage; } catch { return null; } }) {}
  private async request(path: string, init?: RequestInit) {
    try {
      const transport = this.transport;
      const response = await transport(path, { ...init, cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Coding-School": "local", ...init?.headers }, signal: AbortSignal.timeout(15000) });
      const body: unknown = await response.json();
      if (!response.ok) { const error = errorSchema.safeParse(body); throw new PersistenceError(error.success ? error.data.code : "unavailable"); }
      return body;
    } catch (error) { throw error instanceof PersistenceError ? error : new PersistenceError("unavailable"); }
  }
  async hydrate() {
    const snapshot = snapshotSchema.parse(await this.request("/api/learner"));
    this.snapshot = snapshot;
    this.legacy = null;
    if (!snapshot.initialized) {
      const storage = this.storage();
      const raw = storage?.getItem("coding-school:learner-state");
      if (raw) {
        try {
          if (new TextEncoder().encode(raw).byteLength > MAX_STATE_BYTES) throw new Error();
          const state = learningStateSchema.parse(JSON.parse(raw));
          this.legacy = { raw, state, learningMode: storage?.getItem("coding-school:learning-mode") !== "off" };
        } catch { throw new StateRecoveryError(raw); }
      }
    }
    return { snapshot, legacy: this.legacy };
  }
  private async write(request: SaveRequest) {
    this.pending = request;
    const receipt = receiptSchema.parse(await this.request("/api/learner", { method: "PUT", body: JSON.stringify(request) }));
    if (receipt.requestId !== request.requestId || receipt.revision !== request.revision + 1) throw new PersistenceError("unavailable");
    this.snapshot = { state: request.state, revision: receipt.revision, initialized: true, legacyImported: Boolean(this.snapshot?.legacyImported || request.operation === "import"), learningMode: request.learningMode };
    this.pending = null;
    if (request.operation === "import") {
      // The original and backup stay recoverable even if writing the marker fails.
      try { this.storage()?.setItem("coding-school:sqlite-imported", "true"); } catch { /* Database import flag remains authoritative. */ }
      this.legacy = null;
    }
    return this.snapshot;
  }
  private serialize<T>(operation: () => Promise<T>) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  save(update: (state: LearningState) => LearningState, learningMode?: boolean) {
    return this.serialize(async () => {
      if (!this.snapshot || this.pending || this.legacy) throw new PersistenceError("unavailable");
      return this.write({ operation: "save", requestId: crypto.randomUUID(), revision: this.snapshot.revision, state: update(this.snapshot.state), learningMode: learningMode ?? this.snapshot.learningMode });
    });
  }
  importLegacy() {
    return this.serialize(async () => {
      if (!this.legacy || !this.snapshot || this.snapshot.initialized || this.pending) throw new PersistenceError("conflict");
      const storage = this.storage();
      if (!storage) throw new PersistenceError("unavailable");
      storage.setItem("coding-school:sqlite-import-backup", this.legacy.raw);
      return this.write({ operation: "import", requestId: crypto.randomUUID(), revision: this.snapshot.revision, state: this.legacy.state, learningMode: this.legacy.learningMode });
    });
  }
  startEmpty() {
    const original = this.legacy;
    this.legacy = null;
    return this.save(state => state).catch(error => { this.legacy = original; throw error; });
  }
  retry() {
    return this.serialize(async () => {
      if (!this.pending) throw new PersistenceError("unavailable");
      return this.write(this.pending);
    });
  }
  async exportBackup() {
    return this.request("/api/learner?export=1");
  }
}
