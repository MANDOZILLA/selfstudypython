import { describe, expect, test } from "vitest";
import { buildAssessmentRunRequest } from "../app/studio/assessment-workbench";
import { ASSESSMENTS, type AssessmentTask } from "../curriculum/assessments";
import { getGrader } from "../public/grading/catalog.js";

const CODE_KINDS = new Set(["debug", "scratch", "project"]);

function codeTasks(): AssessmentTask[] {
  return ASSESSMENTS.flatMap(a => a.tasks).filter(t => CODE_KINDS.has(t.kind));
}

describe("assessment code-task run requests", () => {
  test("every code task builds a request whose (exerciseId, graderId) resolves in the grader catalog", () => {
    const tasks = codeTasks();
    expect(tasks.length).toBe(9);
    for (const task of tasks) {
      const request = buildAssessmentRunRequest(task, "pass");
      expect(request.type).toBe("run");
      expect(request.graderId).toBe(task.graderId);
      expect(request.files).toEqual({ "main.py": "pass" });
      expect(typeof request.requestId).toBe("string");
      expect(request.requestId.length).toBeGreaterThan(0);
      // The worker's validRequest() rejects any run whose pair is unregistered.
      const grader = getGrader(request.exerciseId, request.graderId);
      expect(grader, `${task.id}: (${request.exerciseId}, ${request.graderId}) must resolve in the grader catalog`).toBeDefined();
    }
  });

  test("the exerciseId sent is the catalog's registered id, not derived from the task id", () => {
    for (const task of codeTasks()) {
      const request = buildAssessmentRunRequest(task, "pass");
      expect(request.exerciseId, `${task.id} exerciseId`).not.toBe(`${task.id}-exercise`);
    }
  });

  test("each build gets a distinct request id", () => {
    const task = codeTasks().find(t => t.kind === "debug")!;
    const a = buildAssessmentRunRequest(task, "x");
    const b = buildAssessmentRunRequest(task, "x");
    expect(a.requestId).not.toBe(b.requestId);
  });

  test("an unregistered graderId fails closed with a clear error, never a guessed id", () => {
    const base = codeTasks().find(t => t.kind === "debug")!;
    const task: AssessmentTask = { ...base, graderId: "no-such-grader-v1" };
    expect(() => buildAssessmentRunRequest(task, "x")).toThrow(/not registered in the grader catalog/);
  });

  test("a missing graderId fails closed", () => {
    const base = codeTasks().find(t => t.kind === "debug")!;
    const task: AssessmentTask = { ...base, graderId: undefined };
    expect(() => buildAssessmentRunRequest(task, "x")).toThrow(/not registered in the grader catalog/);
  });
});
