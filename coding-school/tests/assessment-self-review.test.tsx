import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssessmentWorkbench } from "../app/studio/assessment-workbench";
import {
  advanceMissionStage, createDefaultState, recordMissionAttempt, startOrResumeMission,
  type LearningState,
} from "../lib/state";
import { getMission, getTask } from "../lib/curriculum";
import { getGrader } from "../public/grading/catalog.js";

const day = (n: number) => new Date(`2026-09-${String(n).padStart(2, "0")}T12:00:00.000Z`);
const assistance = { hintsUsed: 0, aiAssisted: false, solutionViewed: false };

// Long enough (>600 chars) to exercise the truncated-visible / full-in-<details> rendering.
const REFLECTION = [
  "I repaired the payments export by parsing with the csv module instead of splitting on commas,",
  "because quoted IDs can contain commas and a naive split corrupts them. Invalid rows never reserve",
  "their IDs, so a later valid row with the same ID still gets imported. Fractional cents are rejected",
  "and money stays exact by working in integer cents throughout. For example, the input",
  "\"\\\"A,1\\\",10.50\" parses as ID A,1 with 1050 cents, while \"B,xyz\" is rejected without reserving B.",
  "One remaining uncertainty: how to stream files too large to fit in memory without losing the",
  "duplicate-ID bookkeeping across chunks. TAIL: my one remaining uncertainty is streaming very large files.",
].join(" ");

function submitTask(state: LearningState, taskId: string): LearningState {
  const run = state.missionRuns.at(-1)!;
  const task = getTask(taskId)!;
  const variant = task.variants[0];
  const grader = getGrader(variant.exerciseId, variant.graderId);
  return recordMissionAttempt(state, run.id, task.id, {
    variantId: variant.id,
    sourceFiles: { "main.py": `source for ${taskId}` },
    assistance,
    result: task.kind === "code" ? {
      graderVersion: grader!.version,
      executionOk: true,
      tests: grader!.requiredTests.map((id: string) => ({ id, name: id, required: true, passed: true, detail: "" })),
    } : undefined,
    response: "A thoughtful written answer with enough characters to pass validation cleanly.",
  }, day(11));
}

function submitProject(state: LearningState, failCheckId: string | null, source: string): LearningState {
  const run = state.missionRuns.at(-1)!;
  const task = getTask("csv-project")!;
  const variant = task.variants[0];
  const grader = getGrader(variant.exerciseId, variant.graderId);
  return recordMissionAttempt(state, run.id, task.id, {
    variantId: variant.id,
    sourceFiles: { "main.py": source },
    assistance,
    result: {
      graderVersion: grader!.version,
      executionOk: true,
      tests: grader!.requiredTests.map((id: string) => ({ id, name: id, required: true, passed: id !== failCheckId, detail: "" })),
    },
  }, day(12));
}

function submitReflection(state: LearningState, response: string): LearningState {
  const run = state.missionRuns.at(-1)!;
  const task = getTask("csv-explain")!;
  const variant = task.variants[0];
  return recordMissionAttempt(state, run.id, task.id, {
    variantId: variant.id, sourceFiles: {}, assistance, response,
  }, day(12));
}

/** Builds a genuinely completed mission run: an older failing project attempt,
 *  then a passing re-attempt, plus a saved reflection. */
function completeFirstMission(): LearningState {
  let state = startOrResumeMission(createDefaultState(), day(11));
  const runId = state.missionRuns.at(-1)!.id;
  for (let stage = 0; stage < 4; stage++) {
    for (const taskId of state.missionRuns.at(-1)!.stages[stage].taskIds) {
      if (taskId === "csv-project") {
        state = submitProject(state, "quoted", "first attempt with a failing check");
        state = submitProject(state, null, "fixed attempt");
      } else if (taskId === "csv-explain") {
        state = submitReflection(state, REFLECTION);
      } else {
        state = submitTask(state, taskId);
      }
    }
    state = advanceMissionStage(state, runId, day(13));
  }
  expect(state.missionRuns.at(-1)!.status).toBe("completed");
  return state;
}

function render(state: LearningState): string {
  const studio = { state } as never;
  return renderToStaticMarkup(<AssessmentWorkbench studio={studio} />);
}

describe("mission self-review in the assessment workbench", () => {
  it("shows an honest empty state when no mission is completed", () => {
    const html = render(createDefaultState());
    expect(html).toContain("Mission self-review");
    expect(html).toContain("Complete a mission and its project checks and reflection will appear here for self-review.");
  });

  it("cites the completed mission's title, date, named project checks, and reflection", () => {
    const state = completeFirstMission();
    const html = render(state);
    const mission = getMission(state.missionRuns.at(-1)!.missionId)!;
    expect(html).toContain(mission.title);
    expect(html).toContain("Sep 13, 2026");
    // Named check outcomes from the latest project attempt.
    expect(html).toContain("sample");
    expect(html).toContain("sample</strong>: passed");
    // The learner's actual reflection text, with the full text available for long reflections.
    expect(html).toContain("TAIL: my one remaining uncertainty is streaming very large files.");
    expect(html).toContain("<details");
  });

  it("renders only the latest project attempt's checks, not stale failing ones", () => {
    const html = render(completeFirstMission());
    expect(html).toContain("quoted</strong>: passed");
    expect(html).not.toContain("quoted</strong>: failed");
  });

  it("labels a failed check as failed when the recorded checks say so", () => {
    let state = completeFirstMission();
    const runId = state.missionRuns.at(-1)!.id;
    const latest = state.attempts.filter(a => a.runId === runId && a.purpose === "project").at(-1)!;
    state = {
      ...state,
      attempts: state.attempts.map(a => a.id === latest.id
        ? { ...a, passed: false, checks: a.checks.map(c => c.id === "quoted" ? { ...c, passed: false } : c) }
        : a),
    };
    const html = render(state);
    expect(html).toContain("quoted</strong>: failed");
  });

  it("is honest when a completed run has no project attempt or no reflection", () => {
    let state = completeFirstMission();
    const runId = state.missionRuns.at(-1)!.id;
    state = {
      ...state,
      attempts: state.attempts.filter(a => !(a.runId === runId && (a.purpose === "project" || a.purpose === "reflection"))),
      missionRuns: state.missionRuns.map(r => r.id === runId
        ? { ...r, attemptIds: r.attemptIds.filter(id => !state.attempts.some(a => a.id === id)) }
        : r),
    };
    const html = render(state);
    expect(html).toContain("No project checks recorded for this mission.");
    expect(html).toContain("No reflection saved.");
  });
});
