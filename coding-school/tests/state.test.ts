import { afterEach, describe, expect, it } from "vitest";
import {
  getState,
  resetState,
  saveState,
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
      attempts: [{ id: "attempt-1", contentId: "exercise-clean-csv", kind: "exercise", score: 0.8, hintsUsed: 1, aiAssisted: false, independent: true, completedAt: "2026-09-10T12:00:00.000Z" }],
      mastery: {
        "data-cleaning": { skillId: "data-cleaning", score: 62, confidence: 0.5, independentEvidence: 1, totalEvidence: 2, lastDemonstratedAt: "2026-09-10T12:00:00.000Z" },
      },
      reviewSchedule: {
        "data-cleaning": { skillId: "data-cleaning", dueAt: "2026-09-13T12:00:00.000Z", reason: "practice" },
      },
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

    expect(migrated.version).toBe(1);
    expect(migrated.dashboard.activeTab).toBe("learned");
    expect(migrated.diagnostic.completed).toBe(true);
    expect(migrated.mastery["python-functions"]?.score).toBe(78);
    expect(migrated.reviewSchedule["python-functions"]?.reason).toBe("retrieval");
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
});
