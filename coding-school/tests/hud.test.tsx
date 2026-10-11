import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Hud } from "../app/studio/hud";
import type { AttemptRecord } from "../lib/mission-types";
import { createDefaultState } from "../lib/state";

function passingProject(): AttemptRecord {
  return {
    id: "project-pass", runId: "run-1", missionId: "foundations", missionVersion: "1", stageId: "build",
    taskId: "foundations-project-task", variantId: "v1", contextId: "ctx-1", graderId: "grader", graderVersion: "1",
    sourceFiles: {}, sourceHash: "source", resultHash: "result", checks: [], skillOutcomes: [], introducedSkillIds: [],
    assistance: { hintsUsed: 0, aiAssisted: false, solutionViewed: false }, purpose: "project", passed: true,
    executionOk: true, response: "", completedAt: "2026-10-10T12:00:00.000Z", duplicateOf: null,
  };
}

describe("progress HUD", () => {
  it("shows the level-one title for an empty learner", () => {
    const markup = renderToStaticMarkup(<Hud state={createDefaultState()} />);
    expect(markup).toContain("LV 1");
    expect(markup).toContain("Hello World");
  });

  it("shows XP after a passing project", () => {
    const state = createDefaultState();
    state.attempts.push(passingProject());
    const markup = renderToStaticMarkup(<Hud state={state} />);
    expect(markup).toContain("150 / 183 XP");
  });
});
