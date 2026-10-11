import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Dashboard } from "../app/studio/dashboard";
import type { Studio } from "../app/studio/use-studio";
import { DIAGNOSTIC_UNKNOWN_ANSWER, DIAGNOSTIC_SESSION_VERSION, type DiagnosticSession } from "../lib/diagnostic";
import { convertLegacyPortfolioSnapshot } from "../lib/portfolio";
import {
  createDefaultState,
  getState,
  migrateState,
  recordAssessmentAttempt,
  replaceDiagnosticSession,
  resetPlacement,
  resetState,
  saveState,
  type AssessmentTaskAttempt,
  type AttemptRecord,
  type LearningState,
  type MissionRun,
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

/** Schema-valid completed placement session: reset must not depend on the
 *  diagnostic engine to fabricate one for this test. */
function completedSession(): DiagnosticSession {
  return {
    id: "session-1",
    formatVersion: DIAGNOSTIC_SESSION_VERSION,
    status: "completed",
    startedAt: "2026-09-20T10:00:00.000Z",
    completedAt: "2026-09-20T10:40:00.000Z",
    responses: [
      {
        itemId: "csp-basic-concept-1",
        skillId: "csp-foundations",
        kind: "concept",
        correct: true,
        answer: "The loop prints each score once.",
        code: "",
        hintsUsed: 0,
        graderId: null,
        graderVersion: null,
        legacy: false,
        dontKnow: false,
        respondedAt: "2026-09-20T10:05:00.000Z",
      },
      {
        itemId: "csp-basic-coding-1",
        skillId: "csp-foundations",
        kind: "coding",
        correct: false,
        answer: "",
        code: "",
        hintsUsed: 0,
        graderId: null,
        graderVersion: null,
        legacy: false,
        dontKnow: true,
        respondedAt: "2026-09-20T10:12:00.000Z",
      },
    ],
    currentItemId: null,
    draftAnswer: "",
    draftCode: "",
    draftHints: 0,
    codingSuccessCount: 0,
    infraError: null,
    profile: { "csp-foundations": "observed" },
    recommendation: "Placement from 2 diagnostic responses.",
  };
}

function assessmentAttempt(): AssessmentTaskAttempt {
  return {
    attemptId: "att-1",
    taskId: "foundations-debug-task",
    assessmentId: "foundations-checkpoint",
    skillId: "debugging",
    result: { passed: true, hintsUsed: 0, aiAssisted: false, solutionViewed: false },
    completedAt: "2026-09-14T10:00:00.000Z",
  };
}

function portfolioSnapshot() {
  return convertLegacyPortfolioSnapshot({
    projectId: "project-csv-repair",
    title: "Repair a messy CSV",
    sourceFiles: { "main.py": "print('ok')" },
    tests: [{ name: "removes blank rows", passed: true }],
    feedback: "Handles malformed rows.",
    score: 0.88,
    skillIds: ["data-cleaning"],
    completedAt: "2026-09-10T12:00:00.000Z",
  });
}

/** Placement state that survives migration: completed session, a real
 *  assessment attempt, a real portfolio snapshot, and a chosen tab. */
function placementState(): LearningState {
  const state = replaceDiagnosticSession(createDefaultState(), completedSession());
  const withAttempt = recordAssessmentAttempt(state, assessmentAttempt(), new Date("2026-09-15T10:00:00.000Z"));
  return {
    ...withAttempt,
    dashboard: { activeTab: "lessons" },
    portfolio: [portfolioSnapshot()],
  };
}

/** Everything the reset must leave alone, including records the migration
 *  layer cannot rebuild from scratch. */
function richState(): LearningState {
  const state = placementState();
  return {
    ...state,
    attempts: [{ id: "attempt-1" } as AttemptRecord],
    missionRuns: [{ id: "run-1", missionId: "python-foundations" } as MissionRun],
    mastery: {
      debugging: {
        skillId: "debugging",
        status: "Practicing",
        independentSuccesses: 1,
        distinctContexts: 1,
        attemptCount: 2,
        lastDemonstratedAt: "2026-09-14T10:00:00.000Z",
        taughtAt: "2026-09-01T10:00:00.000Z",
        evidenceAttemptIds: ["attempt-1"],
      },
    },
    reviewSchedule: { debugging: { skillId: "debugging", dueAt: "2026-09-17T10:00:00.000Z", reason: "retrieval", intervalDays: 3 } },
  };
}

function studioFor(state: LearningState): Studio {
  return {
    state,
    route: { destination: "today" },
    navigate: () => undefined,
    start: () => undefined,
    applyState: () => undefined,
    startDiagnostic: () => undefined,
    openDiagnosticSession: () => undefined,
    retakeDiagnostic: () => undefined,
    resetPlacement: () => undefined,
  } as unknown as Studio;
}

function todayMarkup(state: LearningState) {
  return renderToStaticMarkup(<Dashboard studio={studioFor(state)} />);
}

afterEach(() => {
  resetState();
  browserStorage.removeItem(storageKey);
  Reflect.deleteProperty(globalThis, "window");
});

describe("resetPlacement state", () => {
  it("clears sessions and the placement summary without touching the learning record", () => {
    const seeded = richState();
    const cleared = resetPlacement(seeded);

    expect(cleared.diagnosticSessions).toEqual([]);
    expect(cleared.diagnostic).toEqual({ completed: false, completedAt: null });

    expect(cleared.attempts).toEqual(seeded.attempts);
    expect(cleared.missionRuns).toEqual(seeded.missionRuns);
    expect(cleared.portfolio).toEqual(seeded.portfolio);
    expect(cleared.assessmentAttempts).toEqual(seeded.assessmentAttempts);
    expect(cleared.mastery).toEqual(seeded.mastery);
    expect(cleared.reviewSchedule).toEqual(seeded.reviewSchedule);
    expect(cleared.dashboard).toEqual(seeded.dashboard);
    expect(cleared.version).toBe(seeded.version);
  });

  it("does not mutate the state it was handed", () => {
    const seeded = richState();
    const before = JSON.stringify(seeded);
    resetPlacement(seeded);
    expect(JSON.stringify(seeded)).toBe(before);
  });

  it("stays cleared through the normal persisted commit", () => {
    installBrowserStorage();
    saveState(placementState());
    expect(getState().diagnosticSessions).toHaveLength(1);
    expect(getState().diagnostic.completed).toBe(true);

    saveState(resetPlacement(getState()));

    const stored = JSON.parse(browserStorage.getItem(storageKey)!);
    expect(stored.diagnosticSessions).toEqual([]);
    expect(stored.diagnostic.completed).toBe(false);

    const loaded = getState();
    expect(loaded.diagnosticSessions).toEqual([]);
    expect(loaded.diagnostic).toEqual({ completed: false, completedAt: null });
    expect(loaded.dashboard.activeTab).toBe("lessons");
    expect(loaded.portfolio.map(p => p.projectId)).toEqual(["project-csv-repair"]);
    expect(loaded.assessmentAttempts.map(a => a.attemptId)).toEqual(["att-1"]);
    expect(loaded.attempts).toEqual([]);
  });

  it("keeps a cleared result after migration re-reads the stored payload", () => {
    const migrated = migrateState({
      version: 3,
      diagnosticSessions: [],
      diagnostic: { completed: false, completedAt: null },
      attempts: [],
      missionRuns: [],
      portfolio: [portfolioSnapshot()],
      assessmentAttempts: [assessmentAttempt()],
      dashboard: { activeTab: "overview" },
    } as unknown as LearningState);

    expect(migrated.diagnosticSessions).toEqual([]);
    expect(migrated.diagnostic.completed).toBe(false);
    expect(migrated.portfolio).toHaveLength(1);
    expect(migrated.assessmentAttempts).toHaveLength(1);
  });
});

describe("reset placement presentation", () => {
  it("states the AP CSP framing and flexible coding evidence up front", () => {
    const markup = todayMarkup(createDefaultState());
    expect(markup).toContain("AP Computer Science Principles (AP CSP) foundation tier");
    expect(markup).toContain("Coding evidence is flexible");
    expect(markup).toContain(DIAGNOSTIC_UNKNOWN_ANSWER);
    expect(markup).toContain("never block you");
  });

  it("hides the reset action until there is placement state to clear", () => {
    expect(todayMarkup(createDefaultState())).not.toContain("Reset placement");
  });

  it("offers a confirmed reset that names exactly what is kept", () => {
    const markup = todayMarkup(placementState());
    expect(markup).toContain("Reset placement");
    expect(markup).toContain("Clears your diagnostic sessions and placement summary");
    expect(markup).toContain("Missions, checkpoint assessments, your evidence log, and portfolio snapshots are kept.");
    expect(markup).toContain("START OVER");
    expect(markup).toContain('aria-label="Reset placement"');
  });

  it("requires a confirmation step that counts sessions and repeats the scope", () => {
    // The confirmation branch only renders after a click, so its copy is
    // asserted at the source the same way other interactive states are.
    const source = readFileSync(new URL("../app/studio/dashboard.tsx", import.meta.url), "utf8");
    const start = source.indexOf('aria-label="Confirm placement reset"');
    expect(start).toBeGreaterThan(-1);
    const confirm = source.slice(start);
    expect(confirm).toContain("This permanently clears {sessions.length} saved diagnostic session{sessions.length === 1 ? \"\" : \"s\"}");
    expect(confirm).toContain("Missions, checkpoint assessments, your evidence log, and portfolio snapshots are not affected.");
    expect(confirm).toContain("Yes, reset placement");
    expect(confirm).toContain("Keep my placement");
    expect(confirm).toContain("studio.resetPlacement()");
  });
});
