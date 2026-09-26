import { describe, expect, test } from "vitest";
import {
  createDefaultState,
  recordAssessmentAttempt,
  getAssessmentSkillStatus,
  migrateState,
  type AssessmentTaskAttempt,
} from "../lib/state";

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

describe("assessment attempt recording", () => {
  test("recording is idempotent by attemptId", () => {
    let state = createDefaultState();
    state = recordAssessmentAttempt(state, attempt());
    expect(state.assessmentAttempts.length).toBe(1);
    const again = recordAssessmentAttempt(state, attempt());
    expect(again.assessmentAttempts.length).toBe(1);
    expect(again).toBe(state);
  });

  test("skill status derives from recorded attempts", () => {
    let state = createDefaultState();
    expect(getAssessmentSkillStatus(state, "debugging").status).toBe("not-started");
    state = recordAssessmentAttempt(state, attempt());
    expect(getAssessmentSkillStatus(state, "debugging").status).toBe("completed");
    state = recordAssessmentAttempt(
      state,
      attempt({
        attemptId: "att-2",
        taskId: "data-debug-task",
        assessmentId: "data-checkpoint",
        completedAt: "2026-09-21T10:00:00.000Z",
      }),
    );
    expect(getAssessmentSkillStatus(state, "debugging").status).toBe("mastered");
  });

  test("a failed task schedules a repair review", () => {
    let state = createDefaultState();
    state = recordAssessmentAttempt(
      state,
      attempt({
        result: { passed: false, hintsUsed: 0, aiAssisted: false, solutionViewed: false },
      }),
    );
    const key = "assessment:debugging:foundations-debug-task";
    expect(state.reviewSchedule[key]?.reason).toBe("repair");
    expect(state.reviewSchedule[key]?.dueAt).toBe("2026-09-15T09:00:00.000Z");
  });

  test("migration preserves valid attempts and drops malformed ones", () => {
    const raw = {
      version: 3,
      assessmentAttempts: [
        {
          attemptId: "att-1",
          taskId: "foundations-debug-task",
          assessmentId: "foundations-checkpoint",
          skillId: "debugging",
          result: { passed: true, hintsUsed: 0, aiAssisted: false, solutionViewed: false },
          completedAt: "2026-09-14T10:00:00.000Z",
        },
        { attemptId: "att-1", taskId: "x", assessmentId: "y", skillId: "z" },
        { bogus: true },
      ],
    };
    const migrated = migrateState(raw);
    expect(migrated.assessmentAttempts.length).toBe(1);
    expect(migrated.assessmentAttempts[0].attemptId).toBe("att-1");
    expect(migrated.assessmentAttempts[0].mastered).toBe(true);
  });
});
