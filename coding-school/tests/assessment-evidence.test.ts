import { describe, expect, test } from "vitest";
import {
  deriveTaskRecord,
  deriveSkillStatus,
  planFocusedReviews,
  type AssessmentTaskAttempt,
} from "../lib/assessment-evidence";

function attempt(overrides: Partial<AssessmentTaskAttempt> = {}): AssessmentTaskAttempt {
  return {
    attemptId: "att-1",
    taskId: "foundations-debug-task",
    assessmentId: "foundations-checkpoint",
    skillId: "debugging",
    result: { passed: true, hintsUsed: 0, aiAssisted: false, solutionViewed: false },
    completedAt: "2026-09-14T10:00:00.000Z",
    ...overrides,
  };
}

describe("assessment task evidence", () => {
  test("completion and mastery are separate: hints make success practice, not mastery", () => {
    const assisted = deriveTaskRecord(
      attempt({ result: { passed: true, hintsUsed: 1, aiAssisted: false, solutionViewed: false } }),
    );
    expect(assisted.independent).toBe(false);
    expect(assisted.mastered).toBe(false);

    const clean = deriveTaskRecord(attempt());
    expect(clean.independent).toBe(true);
    expect(clean.mastered).toBe(true);
  });

  test("four hints weakens a task to practice even when its checks pass", () => {
    const result = deriveTaskRecord(
      attempt({ result: { passed: true, hintsUsed: 4, aiAssisted: false, solutionViewed: false } }),
    );
    expect(result.weakenedByHints).toBe(true);
    expect(result.independent).toBe(false);
    expect(result.mastered).toBe(false);
  });

  test("AI assistance or a revealed solution makes success practice, not independent mastery", () => {
    const ai = deriveTaskRecord(
      attempt({ attemptId: "att-ai", result: { passed: true, hintsUsed: 0, aiAssisted: true, solutionViewed: false } }),
    );
    expect(ai.independent).toBe(false);
    expect(ai.mastered).toBe(false);

    const revealed = deriveTaskRecord(
      attempt({ attemptId: "att-reveal", result: { passed: true, hintsUsed: 0, aiAssisted: false, solutionViewed: true } }),
    );
    expect(revealed.independent).toBe(false);
    expect(revealed.mastered).toBe(false);
  });

  test("a failed task is not mastered but schedules a focused repair review", () => {
    const result = deriveTaskRecord(
      attempt({ result: { passed: false, hintsUsed: 0, aiAssisted: false, solutionViewed: false } }),
    );
    expect(result.mastered).toBe(false);
    const reviews = planFocusedReviews(result);
    expect(reviews.length).toBe(1);
    expect(reviews[0].taskId).toBe("foundations-debug-task");
    expect(reviews[0].skillId).toBe("debugging");
    expect(reviews[0].reason).toBe("repair");
    expect(reviews[0].scheduledFor).toBe("2026-09-15");
  });

  test("a passed task schedules no repair review", () => {
    expect(planFocusedReviews(deriveTaskRecord(attempt()))).toEqual([]);
  });
});

describe("assessment skill status", () => {
  const masteredTask = (taskId: string, assessmentId: string, completedAt: string, attemptId = `att-${taskId}`) =>
    deriveTaskRecord(attempt({ attemptId, taskId, assessmentId, completedAt }));

  test("later independent work in another context and date promotes completed to mastered", () => {
    const first = masteredTask("foundations-debug-task", "foundations-checkpoint", "2026-09-14T10:00:00.000Z");
    expect(deriveSkillStatus("debugging", [first]).status).toBe("completed");
    const second = masteredTask("data-debug-task", "data-checkpoint", "2026-09-21T10:00:00.000Z");
    const status = deriveSkillStatus("debugging", [first, second]);
    expect(status.status).toBe("mastered");
    expect(status.independentTasks).toBe(2);
  });

  test("the identical task cannot add diversity toward mastery", () => {
    const first = masteredTask("foundations-debug-task", "foundations-checkpoint", "2026-09-14T10:00:00.000Z");
    const repeat = masteredTask("foundations-debug-task", "foundations-checkpoint", "2026-09-21T10:00:00.000Z", "att-repeat");
    expect(deriveSkillStatus("debugging", [first, repeat]).status).toBe("completed");
  });

  test("same date and same context is not diverse enough for mastery", () => {
    const first = masteredTask("foundations-debug-task", "foundations-checkpoint", "2026-09-14T10:00:00.000Z");
    const second = masteredTask("data-debug-task", "foundations-checkpoint", "2026-09-14T15:00:00.000Z");
    expect(deriveSkillStatus("debugging", [first, second]).status).toBe("completed");
  });

  test("different context on the same date counts as diverse", () => {
    const first = masteredTask("foundations-debug-task", "foundations-checkpoint", "2026-09-14T10:00:00.000Z");
    const second = masteredTask("data-debug-task", "data-checkpoint", "2026-09-14T15:00:00.000Z");
    expect(deriveSkillStatus("debugging", [first, second]).status).toBe("mastered");
  });

  test("assisted tasks never count toward mastery", () => {
    const first = masteredTask("foundations-debug-task", "foundations-checkpoint", "2026-09-14T10:00:00.000Z");
    const assisted = deriveTaskRecord(
      attempt({
        attemptId: "att-assisted",
        taskId: "data-debug-task",
        assessmentId: "data-checkpoint",
        completedAt: "2026-09-21T10:00:00.000Z",
        result: { passed: true, hintsUsed: 2, aiAssisted: false, solutionViewed: false },
      }),
    );
    expect(deriveSkillStatus("debugging", [first, assisted]).status).toBe("completed");
  });

  test("status is monotonic: later poor results never regress mastery", () => {
    const first = masteredTask("foundations-debug-task", "foundations-checkpoint", "2026-09-14T10:00:00.000Z");
    const second = masteredTask("data-debug-task", "data-checkpoint", "2026-09-21T10:00:00.000Z");
    expect(deriveSkillStatus("debugging", [first, second]).status).toBe("mastered");
    const failed = deriveTaskRecord(
      attempt({
        attemptId: "att-failed",
        taskId: "applied-debug-task",
        assessmentId: "applied-checkpoint",
        completedAt: "2026-09-28T10:00:00.000Z",
        result: { passed: false, hintsUsed: 0, aiAssisted: false, solutionViewed: false },
      }),
    );
    expect(deriveSkillStatus("debugging", [first, second, failed]).status).toBe("mastered");
  });

  test("no tasks means not started", () => {
    expect(deriveSkillStatus("debugging", []).status).toBe("not-started");
  });
});
