import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Dashboard } from "../app/studio/dashboard";
import type { Studio } from "../app/studio/use-studio";
import { getTask } from "../lib/curriculum";
import { advanceMissionStage, createDefaultState, recordMissionAttempt, startOrResumeMission, type LearningState } from "../lib/state";
import { getGrader } from "../public/grading/catalog.js";

const now = new Date("2026-09-11T12:00:00.000Z");
const assistance = { hintsUsed: 0, aiAssisted: false, solutionViewed: false };

function submit(state: LearningState, taskId: string, passed = true) {
  const task = getTask(taskId)!;
  const variant = task.variants[0];
  const grader = getGrader(variant.exerciseId, variant.graderId);
  return recordMissionAttempt(state, state.missionRuns[0].id, taskId, {
    variantId: variant.id,
    sourceFiles: { "main.py": "print('saved project')" },
    assistance,
    response: "I validated each contact before preparing the output.",
    result: grader ? {
      graderVersion: grader.version,
      executionOk: true,
      tests: grader.requiredTests.map((id: string, index: number) => ({ id, name: index ? "Missing email is reported" : "Valid contacts are exported", required: true, passed, detail: "Saved grader result." })),
    } : undefined,
  }, now);
}

function stateWithProjectReview() {
  let state = startOrResumeMission(createDefaultState(), now);
  state = advanceMissionStage(state, state.missionRuns[0].id, now);
  state = submit(state, "csv-instruction");
  state = submit(state, "csv-guided");
  state = advanceMissionStage(state, state.missionRuns[0].id, now);
  state = submit(state, "csv-project");
  state = advanceMissionStage(state, state.missionRuns[0].id, now);
  const project = state.attempts.find(attempt => attempt.taskId === "csv-project")!;
  project.passed = false;
  project.checks[1].passed = false;
  return submit(state, "csv-explain");
}

function assessmentMarkup() {
  const studio = {
    state: stateWithProjectReview(),
    route: { destination: "assessment" },
    navigate: () => undefined,
    start: () => undefined,
  } as unknown as Studio;
  return renderToStaticMarkup(<Dashboard studio={studio} />);
}

describe("project review presentation", () => {
  it("keeps the actionable review before collapsed saved evidence", () => {
    const markup = assessmentMarkup();
    const outcome = markup.indexOf("This saved project needs changes.");
    const strengths = markup.indexOf("Evidence-backed strengths");
    const remaining = markup.indexOf("Remaining practice");
    const reflection = markup.indexOf("Your reflection");
    const action = markup.indexOf("Review saved attempts");
    const artifact = markup.indexOf("Saved artifact");
    const checks = markup.indexOf("Complete verified checks");

    expect(outcome).toBeGreaterThan(-1);
    expect(outcome).toBeLessThan(strengths);
    expect(strengths).toBeLessThan(remaining);
    expect(remaining).toBeLessThan(reflection);
    expect(reflection).toBeLessThan(action);
    expect(action).toBeLessThan(artifact);
    expect(artifact).toBeLessThan(checks);
  });

  it("keeps source and all checks keyboard-reachable disclosures without obscuring failed checks", () => {
    const markup = assessmentMarkup();

    expect(markup).toContain('<details class="review-disclosure saved-artifact-disclosure">');
    expect(markup).toContain('<details class="review-disclosure saved-checks-disclosure">');
    expect(markup).toContain("9 passed, 1 need changes");
    expect(markup).toContain("Needs changes: Missing email is reported");
    expect(markup).not.toContain("<details class=\"review-disclosure saved-artifact-disclosure\" open");
    expect(markup).not.toContain("<details class=\"review-disclosure saved-checks-disclosure\" open");
  });
});
