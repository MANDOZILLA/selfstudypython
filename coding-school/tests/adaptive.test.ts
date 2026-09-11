import { describe, expect, it } from "vitest";
import {
  chooseDiagnosticPrompt,
  scheduleReview,
  updateMastery,
  type DiagnosticPrompt,
  type MasteryRecord,
} from "../lib/adaptive";

const baseMastery: MasteryRecord = {
  skillId: "python-loops",
  score: 35,
  confidence: 0.25,
  independentEvidence: 0,
  totalEvidence: 0,
  lastDemonstratedAt: null,
};

describe("mastery evidence", () => {
  it("keeps completion separate from mastery and discounts heavy hint use", () => {
    const result = updateMastery(baseMastery, {
      kind: "exercise",
      score: 1,
      hintsUsed: 4,
      aiAssisted: true,
      independent: false,
      completedAt: "2026-09-10T12:00:00.000Z",
    });

    expect(result.score).toBeGreaterThan(35);
    expect(result.score).toBeLessThanOrEqual(45);
    expect(result.totalEvidence).toBe(1);
    expect(result.independentEvidence).toBe(0);
  });

  it("rewards an independent project more than a hint-assisted exercise", () => {
    const result = updateMastery(
      { ...baseMastery, score: 45, totalEvidence: 1 },
      {
        kind: "project",
        score: 0.95,
        hintsUsed: 0,
        aiAssisted: false,
        independent: true,
        completedAt: "2026-09-12T12:00:00.000Z",
      },
    );

    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.independentEvidence).toBe(1);
  });

  it("does not allow a skill past 85 without repeated independent evidence", () => {
    const result = updateMastery(
      { ...baseMastery, score: 84, confidence: 0.8, totalEvidence: 7 },
      {
        kind: "exercise",
        score: 1,
        hintsUsed: 0,
        aiAssisted: false,
        independent: true,
        completedAt: "2026-09-12T12:00:00.000Z",
      },
    );

    expect(result.score).toBeLessThanOrEqual(85);
  });
});

describe("review scheduling", () => {
  it("schedules weak skills sooner than strong recent skills", () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    const weak = scheduleReview({ ...baseMastery, score: 35 }, now);
    const strong = scheduleReview(
      { ...baseMastery, score: 82, confidence: 0.8, lastDemonstratedAt: now.toISOString() },
      now,
    );

    expect(weak.dueAt < strong.dueAt).toBe(true);
    expect(weak.reason).toBe("weak-skill");
  });
});

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
