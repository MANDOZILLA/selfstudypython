import { afterEach, describe, expect, it } from "vitest";
import {
  getState,
  resetState,
  saveState,
  startOrResumeMission,
  advanceMissionStage,
  saveMissionDraft,
  type LearningState,
} from "../lib/state";

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

    expect(migrated.version).toBe(2);
    expect(migrated.dashboard.activeTab).toBe("learned");
    expect(migrated.diagnostic.completed).toBe(true);
    expect(migrated.mastery).toEqual({});
    expect(migrated.reviewSchedule).toEqual({});
  });

  it("recovers to defaults when stored JSON is malformed and reset clears storage", () => {
    installBrowserStorage();
    browserStorage.setItem(storageKey, "not json");

    expect(getState().dashboard.activeTab).toBe("overview");
    saveState({ ...getState(), dashboard: { activeTab: "portfolio" } });
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
