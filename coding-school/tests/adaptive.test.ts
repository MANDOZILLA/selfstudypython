import { describe, expect, it } from "vitest";
import { chooseDiagnosticPrompt, placementReviewSkills, selectToday, type DiagnosticPrompt } from "../lib/adaptive";
import {
  createDiagnosticSession,
  answerConcept,
  recordCodingOutcome,
  nextDiagnosticItem,
  completeDiagnosticSession,
  type ConceptGrader,
  type DiagnosticSession,
} from "../lib/diagnostic";
import { DIAGNOSTIC_ITEMS } from "../curriculum/diagnostic-items";
import { createDefaultState, replaceDiagnosticSession } from "../lib/state";
import { curriculum } from "../lib/curriculum";

describe("diagnostic selection", () => {
  const prompts: DiagnosticPrompt[] = [
    { id: "loops-q1", skillId: "python-loops", difficulty: 1, kind: "concept" },
    { id: "loops-code", skillId: "python-loops", difficulty: 2, kind: "coding" },
    { id: "loops-q2", skillId: "python-loops", difficulty: 3, kind: "concept" },
    { id: "errors-q1", skillId: "exceptions", difficulty: 1, kind: "concept" },
  ];

  it("moves to an untested skill after confident varied evidence", () => {
    const next = chooseDiagnosticPrompt(prompts, [
      { promptId: "loops-q1", skillId: "python-loops", correct: true },
      { promptId: "loops-code", skillId: "python-loops", correct: true },
    ]);

    expect(next?.skillId).toBe("exceptions");
  });

  it("continues probing a skill when its evidence is uncertain", () => {
    const next = chooseDiagnosticPrompt(prompts, [
      { promptId: "loops-q1", skillId: "python-loops", correct: false },
    ]);

    expect(next?.id).toBe("loops-code");
  });
});

describe("placement evidence", () => {
  const byId = new Map(DIAGNOSTIC_ITEMS.map(item => [item.id, item]));
  let flips = 0;
  const flaky: ConceptGrader = () => ({ correct: flips++ % 2 === 0, detail: "stub" });

  function completedSessionWithUncertain(skillId: string): DiagnosticSession {
    const at = "2026-09-14T12:00:00.000Z";
    const concept = (itemId: string, forSkill: string, correct: boolean) => ({
      itemId, skillId: forSkill, kind: "concept" as const, correct, answer: "x", code: "",
      hintsUsed: 0, graderId: `diagnostic-concept-${itemId}`, graderVersion: "1.0.0",
      legacy: false, respondedAt: at,
    });
    const base = createDiagnosticSession();
    return {
      ...base, status: "completed", completedAt: at, currentItemId: null,
      responses: [
        // Split evidence → uncertain.
        concept("diag-uncertain-1", skillId, true),
        concept("diag-uncertain-2", skillId, false),
        // Decisive evidence → observed.
        concept("diag-observed-1", "python-functions", true),
        concept("diag-observed-2", "python-functions", true),
        concept("diag-observed-3", "data-structures", false),
        concept("diag-observed-4", "data-structures", false),
      ],
      profile: null, recommendation: null,
    };
  }

  function completeFlakySession(): DiagnosticSession {
    flips = 0;
    let session = createDiagnosticSession();
    let guard = 0;
    while (nextDiagnosticItem(session) && guard++ < 60) {
      const item = byId.get(session.currentItemId!)!;
      session = item.kind === "coding"
        ? recordCodingOutcome(session, item, { kind: "graded", passed: true, executionOk: true, graderVersion: "1.0.0" }, "code")
        : answerConcept(session, item, "stub", flaky);
    }
    return completeDiagnosticSession(session);
  }

  it("returns no placement skills without a completed diagnostic", () => {
    expect(placementReviewSkills(createDefaultState())).toEqual([]);
    const inProgress = replaceDiagnosticSession(createDefaultState(), createDiagnosticSession());
    expect(placementReviewSkills(inProgress)).toEqual([]);
  });

  it("flags the skills a completed diagnostic left uncertain", () => {
    const completed = completedSessionWithUncertain("csv-cleaning");
    const state = replaceDiagnosticSession(createDefaultState(), completed);
    expect(placementReviewSkills(state)).toEqual(["csv-cleaning"]);
  });

  it("ignores legacy/unverified responses for placement", () => {
    const completed = completeFlakySession();
    const legacy = { ...completed, responses: completed.responses.map(r => ({ ...r, legacy: true })) };
    const state = replaceDiagnosticSession(createDefaultState(), legacy);
    expect(placementReviewSkills(state)).toEqual([]);
  });

  it("adds placement review tasks to today's selection", () => {
    const state = replaceDiagnosticSession(createDefaultState(), completedSessionWithUncertain("csv-cleaning"));
    const flagged = placementReviewSkills(state);
    expect(flagged).toEqual(["csv-cleaning"]);
    const selection = selectToday(state, new Date("2026-09-14T12:00:00.000Z"));
    expect(selection.kind).toBe("mission");
    // csv-cleaning has review tasks and was probed, so placement yields review work.
    expect(selection.reviewTaskIds.length).toBeGreaterThan(0);
    const covered = selection.reviewTaskIds.flatMap(id => curriculum.reviewTasks.find(t => t.id === id)?.skillIds ?? []);
    expect(covered).toContain("csv-cleaning");
    expect(selection.reviewTaskIds.length).toBeLessThanOrEqual(2);
  });
});
