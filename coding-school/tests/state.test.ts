import { afterEach, describe, expect, it } from "vitest";
import {
  getState,
  createDefaultState,
  resetState,
  saveState,
  startOrResumeMission,
  advanceMissionStage,
  saveMissionDraft,
  replaceDiagnosticSession,
  type LearningState,
} from "../lib/state";
import {
  createDiagnosticSession,
  answerConcept,
  recordCodingOutcome,
  nextDiagnosticItem,
  completeDiagnosticSession,
  DIAGNOSTIC_CODING_QUOTA,
  type ConceptGrader,
  type DiagnosticSession,
} from "../lib/diagnostic";
import { gradeDiagnosticConcept } from "../lib/diagnostic-grading";
import { DIAGNOSTIC_ITEMS } from "../curriculum/diagnostic-items";

const storageKey = "coding-school:learner-state";

class StorageDouble {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const browserStorage = new StorageDouble();

function installBrowserStorage() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: browserStorage },
  });
}

afterEach(() => {
  resetState();
  Reflect.deleteProperty(globalThis, "window");
});

describe("learner state", () => {
  it("returns safe, dashboard-first defaults without browser storage", () => {
    const state = getState();

    expect(state.dashboard.activeTab).toBe("overview");
    expect(state.diagnostic.completed).toBe(false);
    expect(state.attempts).toEqual([]);
    expect(state.mastery).toEqual({});
  });

  it("persists learner evidence and returns an isolated copy", () => {
    installBrowserStorage();
    const state: LearningState = {
      ...getState(),
      dashboard: { activeTab: "lessons" },
      diagnostic: { completed: true, completedAt: "2026-09-10T12:00:00.000Z" },
      portfolio: [{ projectId: "project-csv-repair", title: "Repair a messy CSV", sourceFiles: { "main.py": "print('ok')" }, tests: [{ name: "removes blank rows", passed: true }], feedback: "Handles malformed rows.", score: 0.88, skillIds: ["data-cleaning"], completedAt: "2026-09-10T12:00:00.000Z" }],
    };

    saveState(state);
    const loaded = getState();
    loaded.dashboard.activeTab = "assessment";

    expect(getState().dashboard.activeTab).toBe("lessons");
    expect(getState().diagnostic.completed).toBe(true);
    expect(getState().portfolio[0]?.projectId).toBe("project-csv-repair");
  });

  it("migrates a legacy partial payload while preserving valid learner data", () => {
    installBrowserStorage();
    browserStorage.setItem(storageKey, JSON.stringify({
      activeDashboardTab: "learned",
      diagnosticCompleted: true,
      mastery: [{ skillId: "python-functions", score: 78, confidence: 0.7, independentEvidence: 2, totalEvidence: 3, lastDemonstratedAt: null }],
      reviews: [{ skillId: "python-functions", dueAt: "2026-09-12T12:00:00.000Z", reason: "retrieval" }],
    }));

    const migrated = getState();

    expect(migrated.version).toBe(3);
    expect(migrated.dashboard.activeTab).toBe("learned");
    expect(migrated.diagnostic.completed).toBe(true);
    expect(migrated.mastery).toEqual({});
    expect(migrated.reviewSchedule).toEqual({});
  });

  it("preserves malformed JSON and blocks writes until explicit reset", () => {
    installBrowserStorage();
    browserStorage.setItem(storageKey, "not json");

    expect(() => getState()).toThrow(/recover/i);
    expect(() => saveState(createDefaultState())).toThrow(/recover/i);
    expect(browserStorage.getItem(storageKey)).toBe("not json");
    resetState();

    expect(browserStorage.getItem(storageKey)).toBeNull();
    expect(getState().diagnostic.completed).toBe(false);
  });
  it("persists and resumes the mission and its exact draft through browser storage", () => {
    installBrowserStorage();
    let state = startOrResumeMission(getState(), new Date("2026-09-11T12:00:00.000Z"));
    const runId = state.missionRuns[0].id;
    state = advanceMissionStage(state, runId);
    state = saveMissionDraft(state, runId, "csv-guided", { sourceFiles: { "main.py": "def solve(records):\n    return records" }, response: "my note", assistance: { hintsUsed: 1, aiAssisted: false, solutionViewed: false } });
    saveState(state);
    const resumed = startOrResumeMission(getState(), new Date("2026-09-12T12:00:00.000Z"));
    expect(resumed.missionRuns[0].id).toBe(runId);
    expect(resumed.missionRuns[0].drafts["csv-guided"].sourceFiles["main.py"]).toBe("def solve(records):\n    return records");
  });
  it("surfaces unavailable persistence so the UI cannot claim a draft was saved", () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { get localStorage() { throw new Error("blocked"); } } });
    expect(() => saveState(getState())).toThrow(/storage/i);
  });
});

describe("diagnostic session history", () => {
  const byId = new Map(DIAGNOSTIC_ITEMS.map(item => [item.id, item]));
  const alwaysCorrect: ConceptGrader = () => ({ correct: true, detail: "stub" });

  function answerCurrent(session: DiagnosticSession, grader: ConceptGrader = alwaysCorrect): DiagnosticSession {
    const item = byId.get(session.currentItemId!)!;
    if (item.kind === "coding") {
      return recordCodingOutcome(session, item, { kind: "graded", passed: true, executionOk: true, graderVersion: "1.0.0" }, "code");
    }
    return answerConcept(session, item, "stub answer", grader);
  }

  function completeConfidentSession(): DiagnosticSession {
    let session = createDiagnosticSession();
    let guard = 0;
    while (nextDiagnosticItem(session) && guard++ < 40) session = answerCurrent(session);
    return completeDiagnosticSession(session);
  }

  it("migrates a version 2 payload to version 3 without fabricating sessions", () => {
    installBrowserStorage();
    browserStorage.setItem(storageKey, JSON.stringify({
      version: 2,
      diagnostic: { completed: true, completedAt: "2026-09-10T12:00:00.000Z" },
      attempts: [],
      missionRuns: [],
    }));

    const migrated = getState();

    expect(migrated.version).toBe(3);
    expect(migrated.diagnosticSessions).toEqual([]);
    expect(migrated.diagnostic.completed).toBe(true);
  });

  it("persists an in-progress session across save/load exactly", () => {
    installBrowserStorage();
    const session = answerCurrent(createDiagnosticSession());
    saveState(replaceDiagnosticSession(getState(), session));

    const loaded = getState();
    expect(loaded.diagnosticSessions).toHaveLength(1);
    expect(loaded.diagnosticSessions[0].id).toBe(session.id);
    expect(loaded.diagnosticSessions[0].currentItemId).toBe(session.currentItemId);
    expect(loaded.diagnosticSessions[0].responses).toHaveLength(1);
  });

  it("grades concept answers through the real semantic grader", () => {
    const session = createDiagnosticSession();
    const item = byId.get(session.currentItemId!)!;
    expect(item.kind).toBe("concept");
    // A nonsense answer must not earn credit through the real grader path.
    const answered = answerConcept(session, item, "lorem ipsum unrelated", gradeDiagnosticConcept);
    expect(answered.responses).toHaveLength(1);
    expect(answered.responses[0].correct).toBe(false);
  });

  it("keeps prior sessions and upgrades the summary when a session completes", () => {
    installBrowserStorage();
    const older = { ...completeConfidentSession(), completedAt: "2026-09-10T12:00:00.000Z" };
    let state = replaceDiagnosticSession(getState(), older);
    expect(state.diagnostic.completed).toBe(true);
    expect(state.diagnostic.completedAt).toBe("2026-09-10T12:00:00.000Z");

    const newer = completeConfidentSession();
    state = replaceDiagnosticSession(state, newer);
    saveState(state);

    const loaded = getState();
    expect(loaded.diagnosticSessions).toHaveLength(2);
    expect(loaded.diagnosticSessions.map(s => s.id)).toContain(older.id);
    expect(loaded.diagnostic.completed).toBe(true);
    expect(loaded.diagnostic.completedAt).toBe(newer.completedAt);
  });

  it("drops malformed sessions on load instead of fabricating evidence", () => {
    installBrowserStorage();
    const valid = completeConfidentSession();
    saveState(replaceDiagnosticSession(getState(), valid));
    const raw = JSON.parse(browserStorage.getItem(storageKey)!);
    raw.diagnosticSessions.push({ id: "bogus", status: "completed", currentItemId: "nope" });
    browserStorage.setItem(storageKey, JSON.stringify(raw));

    const loaded = getState();
    expect(loaded.diagnosticSessions).toHaveLength(1);
    expect(loaded.diagnosticSessions[0].id).toBe(valid.id);
  });

  it("marks old-format sessions legacy on load without deleting their history", () => {
    installBrowserStorage();
    const answered = answerCurrent(createDiagnosticSession());
    const raw = {
      ...JSON.parse(JSON.stringify({ ...createDefaultState(), diagnosticSessions: [answered] })),
      version: 3,
      diagnosticSessions: [{ ...answered, formatVersion: "0.9.0", codingSuccessCount: 2 }],
    };
    browserStorage.setItem(storageKey, JSON.stringify(raw));

    const loaded = getState();
    expect(loaded.diagnosticSessions).toHaveLength(1);
    const session = loaded.diagnosticSessions[0];
    expect(session.id).toBe(answered.id);
    expect(session.formatVersion).toBe("0.9.0");
    expect(session.responses).toHaveLength(1);
    expect(session.responses.every(r => r.legacy)).toBe(true);
    expect(session.codingSuccessCount).toBe(0);
  });

  it("updating an existing session replaces it instead of duplicating", () => {
    const session = createDiagnosticSession();
    let state = replaceDiagnosticSession(createDefaultState(), session);
    const updated = answerCurrent(session);
    state = replaceDiagnosticSession(state, updated);
    expect(state.diagnosticSessions).toHaveLength(1);
    expect(state.diagnosticSessions[0].responses).toHaveLength(1);
  });

  it("requires a positive coding quota constant", () => {
    expect(DIAGNOSTIC_CODING_QUOTA).toBeGreaterThan(0);
  });
});
