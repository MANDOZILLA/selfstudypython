import { describe, expect, it } from "vitest";
import { recommendNext, REVIEW_TASK_CAP } from "../lib/recommend";
import {
  createDefaultState,
  startOrResumeMission,
  type AttemptRecord,
  type LearningState,
  type MissionRun,
} from "../lib/state";
import { createDiagnosticSession, type DiagnosticSession } from "../lib/diagnostic";
import { deriveReviewSchedule } from "../lib/adaptive";

let serial = 0;
function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  serial += 1;
  return {
    id: `attempt-${serial}`,
    runId: "run-1",
    missionId: "csv-foundations",
    missionVersion: "1.0.0",
    stageId: "stage-build",
    taskId: "csv-tags-challenge",
    variantId: "v1",
    contextId: "ctx-1",
    graderId: "csv-tags-v1",
    graderVersion: "1.0.0",
    sourceFiles: { "main.py": `x = ${serial}` },
    sourceHash: `sh-${serial}`,
    resultHash: `rh-${serial}`,
    checks: [],
    skillOutcomes: [{ skillId: "csv-cleaning", passed: true, checkIds: ["csv-tags-row"] }],
    introducedSkillIds: [],
    assistance: { hintsUsed: 0, aiAssisted: false, solutionViewed: false },
    purpose: "project",
    passed: true,
    executionOk: true,
    response: "",
    completedAt: "2026-09-10T12:00:00.000Z",
    duplicateOf: null,
    ...overrides,
  };
}

function diagnosedSession(weakSkill: string): DiagnosticSession {
  const at = "2026-09-09T12:00:00.000Z";
  const response = (itemId: string, skillId: string, correct: boolean) => ({
    itemId, skillId, kind: "concept" as const, correct, answer: "x", code: "",
    hintsUsed: 0, graderId: `diagnostic-concept-${itemId}`, graderVersion: "1.0.0",
    legacy: false, respondedAt: at,
  });
  const base = createDiagnosticSession(new Date(at));
  return {
    ...base, status: "completed", completedAt: at, currentItemId: null,
    responses: [
      response("d1", "python-functions", true),
      response("d2", "python-functions", true),
      response("d3", weakSkill, false),
      response("d4", weakSkill, false),
    ],
    profile: null, recommendation: null,
  };
}

const NOW = new Date("2026-09-14T12:00:00.000Z");

function completedMission(state: LearningState, missionId: string): LearningState {
  const started = startOrResumeMission(state, NOW, missionId);
  const run = started.missionRuns.at(-1) as MissionRun;
  return {
    ...started,
    missionRuns: started.missionRuns.map(r =>
      r.id === run.id ? { ...r, status: "completed", completedAt: NOW.toISOString() } : r),
  };
}

describe("recommendNext", () => {
  it("sends a fresh learner to the placement diagnostic first", () => {
    const rec = recommendNext(createDefaultState(), NOW);
    expect(rec.action).toBe("diagnostic");
    expect(rec.missionId).toBeNull();
    expect(rec.reason).toMatch(/placement baseline/i);
  });

  it("gives a fresh diagnosed learner the placement baseline and the first mission", () => {
    const state = { ...createDefaultState(), diagnosticSessions: [diagnosedSession("data-structures")] };
    const rec = recommendNext(state, NOW);
    expect(rec.action).toBe("start-mission");
    expect(rec.missionId).toBe("csv-foundations");
    expect(rec.reason).toMatch(/diagnostic/i);
    expect(rec.reason).toMatch(/placement/i);
    expect(rec.reason).not.toMatch(/blocked/i);
  });

  it("always resumes the active unfinished mission first", () => {
    const state = startOrResumeMission(createDefaultState(), NOW, "csv-foundations");
    const rec = recommendNext(state, NOW);
    expect(rec.action).toBe("resume");
    expect(rec.runId).toBe(state.missionRuns[0].id);
    expect(rec.missionId).toBe("csv-foundations");
    expect(rec.reason).toMatch(/resume/i);
    expect(rec.reason).toMatch(/From small functions to a clean payments CSV/);
  });

  it("blocks a dependent mission when a prerequisite skill is weak", () => {
    // Learner scraped through data-structures with heavy assistance, then
    // completed csv-foundations. json-api-normalization introduces
    // json-validation, whose prerequisite data-structures is weak.
    let state = completedMission(createDefaultState(), "csv-foundations");
    state = {
      ...state,
      attempts: [
        attempt({ missionId: "transform-records", taskId: "transform-task", purpose: "project",
          assistance: { hintsUsed: 5, aiAssisted: false, solutionViewed: false }, passed: false,
          completedAt: "2026-09-12T12:00:00.000Z",
          skillOutcomes: [{ skillId: "data-structures", passed: false, checkIds: ["ds-1"] }] }),
      ],
    };
    const rec = recommendNext(state, NOW);
    expect(rec.action).toBe("repair");
    expect(rec.blockedMissionId).toBe("json-api-normalization");
    expect(rec.reason).toMatch(/data-structures/i);
    expect(rec.reason).toMatch(/blocked/i);
    expect(rec.reason).toMatch(/2026-09-12/);
  });

  it("schedules repair after a recent failed retrieval", () => {
    let state = completedMission(createDefaultState(), "csv-foundations");
    state = {
      ...state,
      attempts: [
        // Solid independent project evidence for the next mission's skill set
        // keeps it unblocked…
        attempt({ completedAt: "2026-09-08T12:00:00.000Z",
          skillOutcomes: [{ skillId: "data-structures", passed: true, checkIds: ["ds-1"] }] }),
        attempt({ completedAt: "2026-09-08T12:00:00.000Z",
          skillOutcomes: [{ skillId: "financial-data", passed: true, checkIds: ["fd-1"] }] }),
        // …but yesterday's retrieval of financial-data failed.
        attempt({ purpose: "retrieval", taskId: "invoice-cents-retrieval", contextId: "ctx-invoice",
          passed: false, completedAt: "2026-09-13T12:00:00.000Z",
          skillOutcomes: [{ skillId: "financial-data", passed: false, checkIds: ["fd-1"] }] }),
      ],
    };
    const rec = recommendNext(state, NOW);
    expect(rec.action).toBe("repair");
    expect(rec.reason).toMatch(/financial-data/i);
    expect(rec.reason).toMatch(/2026-09-13/);
    expect(rec.reviewTaskIds.length).toBeGreaterThan(0);
  });

  it("recommends due retrieval with the time since demonstration in the reason", () => {
    let state = completedMission(createDefaultState(), "csv-foundations");
    state = {
      ...state,
      attempts: [
        attempt({ completedAt: "2026-09-08T12:00:00.000Z",
          skillOutcomes: [
            { skillId: "python-functions", passed: true, checkIds: ["c1"] },
            { skillId: "data-structures", passed: true, checkIds: ["c2"] },
            { skillId: "csv-cleaning", passed: true, checkIds: ["c3"] },
          ] }),
        attempt({ purpose: "retrieval", taskId: "csv-tags-retrieval", contextId: "ctx-tags",
          completedAt: "2026-09-09T12:00:00.000Z" }),
      ],
    };
    const rec = recommendNext(state, NOW);
    expect(rec.action).toBe("retrieval");
    expect(rec.reason).toMatch(/csv-cleaning/i);
    expect(rec.reason).toMatch(/retrieval/i);
    expect(rec.reviewTaskIds.length).toBeGreaterThan(0);
    expect(rec.reviewTaskIds.length).toBeLessThanOrEqual(REVIEW_TASK_CAP);
  });

  it("never lets the review backlog consume the whole next mission", () => {
    let state = completedMission(createDefaultState(), "csv-foundations");
    // Independent project evidence for four skills on Sep 1: everything is
    // overdue by Sep 14, so the backlog exceeds the cap.
    state = {
      ...state,
      attempts: [
        attempt({ completedAt: "2026-09-01T12:00:00.000Z",
          skillOutcomes: [
            { skillId: "python-functions", passed: true, checkIds: ["c1"] },
            { skillId: "data-structures", passed: true, checkIds: ["c2"] },
            { skillId: "csv-cleaning", passed: true, checkIds: ["c3"] },
            { skillId: "financial-data", passed: true, checkIds: ["c4"] },
          ] }),
      ],
    };
    const rec = recommendNext(state, NOW);
    expect(rec.action).toBe("retrieval");
    expect(rec.reviewTaskIds.length).toBeLessThanOrEqual(REVIEW_TASK_CAP);
    expect(rec.reason).toMatch(/cap/i);
  });

  it("recommends the checkpoint assessment once its mission group is complete", () => {
    let state = createDefaultState();
    state = completedMission(state, "csv-foundations");
    state = completedMission(state, "json-api-normalization");
    state = completedMission(state, "python-recovery");
    state = completedMission(state, "validation-functions");
    const rec = recommendNext(state, NOW);
    expect(rec.action).toBe("assessment");
    expect(rec.assessmentId).toBe("foundations-checkpoint");
    expect(rec.reason).toMatch(/foundations checkpoint/i);
  });

  it("does not let completed review runs mark missions complete for checkpoints", () => {
    let state = createDefaultState();
    state = completedMission(state, "csv-foundations");
    state = completedMission(state, "json-api-normalization");
    state = completedMission(state, "python-recovery");
    state = completedMission(state, "validation-functions");
    // Completed review-mode runs must not count as mission completion.
    const template = startOrResumeMission(createDefaultState(), NOW, "csv-foundations").missionRuns[0];
    const reviewRuns = ["transform-records", "csv-foundations", "json-api-normalization", "pandas-missing-data", "sqlite-transactions"]
      .map((missionId, i) => ({ ...template, id: `review-run-${i}`, mode: "review" as const, missionId, status: "completed" as const, completedAt: NOW.toISOString() }));
    state = { ...state, missionRuns: [...state.missionRuns, ...reviewRuns] };
    const rec = recommendNext(state, NOW);
    expect(rec.action).toBe("assessment");
    expect(rec.assessmentId).toBe("foundations-checkpoint");
  });

  it("never calls an untested skill weak in its reason", () => {
    const state = { ...createDefaultState(), diagnosticSessions: [diagnosedSession("data-structures")] };
    const rec = recommendNext(state, NOW);
    expect(rec.reason).not.toMatch(/needs practice/);
    expect(rec.reason).not.toMatch(/weak/);
  });

  it("keeps every reason traceable to concrete evidence", () => {
    let state = completedMission(createDefaultState(), "csv-foundations");
    state = {
      ...state,
      attempts: [
        attempt({ missionId: "transform-records", taskId: "transform-task", purpose: "project",
          assistance: { hintsUsed: 5, aiAssisted: false, solutionViewed: false }, passed: false,
          completedAt: "2026-09-12T12:00:00.000Z",
          skillOutcomes: [{ skillId: "data-structures", passed: false, checkIds: ["ds-1"] }] }),
      ],
    };
    const rec = recommendNext(state, NOW);
    expect(rec.reason).toContain("data-structures");
    expect(rec.reason).toContain("2026-09-12");
    expect(rec.reason).not.toMatch(/\d+%/);
  });
});

describe("retrieval scheduling", () => {
  it("schedules repair one day out after a failed retrieval", () => {
    const project = attempt({ completedAt: "2026-09-10T12:00:00.000Z" });
    const failed = attempt({ purpose: "retrieval", taskId: "csv-tags-retrieval", contextId: "ctx-1",
      passed: false, completedAt: "2026-09-13T12:00:00.000Z",
      skillOutcomes: [{ skillId: "csv-cleaning", passed: false, checkIds: ["csv-tags-row"] }] });
    const schedule = deriveReviewSchedule([project, failed]);
    expect(schedule["csv-cleaning"]?.reason).toBe("repair");
    expect(schedule["csv-cleaning"]?.dueAt).toBe("2026-09-14T12:00:00.000Z");
    expect(schedule["csv-cleaning"]?.intervalDays).toBe(1);
  });

  it("advances the interval after a successful independent due retrieval", () => {
    const project = attempt({ completedAt: "2026-09-10T12:00:00.000Z" });
    const due = attempt({ purpose: "retrieval", taskId: "csv-tags-retrieval", contextId: "ctx-1",
      completedAt: "2026-09-11T12:00:00.000Z" });
    const schedule = deriveReviewSchedule([project, due]);
    expect(schedule["csv-cleaning"]?.reason).toBe("retrieval");
    expect(schedule["csv-cleaning"]?.intervalDays).toBe(3);
    expect(schedule["csv-cleaning"]?.dueAt).toBe("2026-09-14T12:00:00.000Z");
  });
});
