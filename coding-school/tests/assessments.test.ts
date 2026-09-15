import { describe, expect, test } from "vitest";
import { ASSESSMENTS } from "../curriculum/assessments";
import { graderCatalog } from "../public/grading/catalog.js";

describe("checkpoint assessment definitions", () => {
  test("three checkpoints, five components each, in read/debug/scratch/project/explain order", () => {
    expect(ASSESSMENTS.map(a => a.id)).toEqual([
      "foundations-checkpoint",
      "data-checkpoint",
      "applied-checkpoint",
    ]);
    for (const assessment of ASSESSMENTS) {
      expect(assessment.tasks.length).toBe(5);
      expect(assessment.tasks.map(t => t.kind)).toEqual([
        "read",
        "debug",
        "scratch",
        "project",
        "explain",
      ]);
    }
  });

  test("task ids are unique across every checkpoint", () => {
    const ids = ASSESSMENTS.flatMap(a => a.tasks.map(t => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(15);
  });

  test("code tasks reference real graders; written tasks reference real written graders", () => {
    const graderIds = new Set(Object.keys(graderCatalog));
    for (const assessment of ASSESSMENTS) {
      for (const task of assessment.tasks) {
        if (task.kind === "debug" || task.kind === "scratch" || task.kind === "project") {
          expect(task.graderId, `${task.id} graderId`).toBeDefined();
          expect(graderIds.has(task.graderId!), `${task.id} grader ${task.graderId}`).toBe(true);
        } else {
          expect(task.exerciseId, `${task.id} exerciseId`).toBeDefined();
          const entry = Object.values(graderCatalog).find(
            g => (g as { exerciseId: string }).exerciseId === task.exerciseId,
          );
          expect(entry, `${task.id} exercise ${task.exerciseId}`).toBeDefined();
        }
        expect(task.prompt.trim().length).toBeGreaterThan(50);
        expect(task.rubric.length).toBeGreaterThan(0);
        expect(task.hints.length).toBeGreaterThan(0);
        expect(task.skillId.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("no solution is visible in the task definitions", () => {
    const serialized = JSON.stringify(ASSESSMENTS).toLowerCase();
    expect(serialized).not.toContain("solution");
    for (const assessment of ASSESSMENTS) {
      for (const task of assessment.tasks) {
        for (const hint of task.hints) {
          // hints guide; they never contain a full reference implementation
          expect(hint.split("\n").length).toBeLessThan(12);
        }
      }
    }
  });

  test("checkpoint groupings match the mission curriculum", () => {
    const groups: Record<string, string> = {
      "foundations-checkpoint": "foundations",
      "data-checkpoint": "data",
      "applied-checkpoint": "applied",
    };
    for (const assessment of ASSESSMENTS) {
      const group = groups[assessment.id];
      for (const task of assessment.tasks) {
        const ref = task.graderId ?? task.exerciseId ?? "";
        expect(ref.startsWith(group), `${task.id} references ${ref}`).toBe(true);
      }
    }
  });
});
