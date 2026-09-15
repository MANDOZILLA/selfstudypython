import { describe, expect, it } from "vitest";
import { curriculum, validateCurriculum } from "../lib/curriculum";
import { getGrader } from "../public/grading/catalog.js";
import { PORTFOLIO_PROJECTS } from "../curriculum/skills";

const missions = curriculum.missions;
const tasks = missions.flatMap((m) => m.stages.flatMap((s) => s.tasks));
const codeTasks = tasks.filter((t) => t.kind === "code");

describe("task 2 mission arc", () => {
  it("validates the composed ten-mission curriculum", () => {
    expect(validateCurriculum(curriculum).success).toBe(true);
    expect(missions).toHaveLength(10);
  });

  it("keeps every mission inside a coherent 30-60 minute budget", () => {
    for (const mission of missions) {
      expect(mission.estimatedMinutes).toBeGreaterThanOrEqual(30);
      expect(mission.estimatedMinutes).toBeLessThanOrEqual(60);
      const sum = mission.stages.reduce((n, s) => n + s.estimatedMinutes, 0);
      expect(sum).toBe(mission.estimatedMinutes);
      expect(mission.stages[0].estimatedMinutes).toBeLessThanOrEqual(5);
      expect(mission.stages.map((s) => s.kind)).toEqual(["review", "learn", "build", "explain"]);
    }
  });

  it("resolves every coding task to a real grader", () => {
    expect(codeTasks.length).toBeGreaterThan(0);
    for (const task of codeTasks) {
      for (const variant of task.variants) {
        const grader = getGrader(variant.exerciseId, variant.graderId);
        expect(grader, `${task.id} ${variant.id}`).toBeTruthy();
      }
    }
  });

  it("covers every required grader check through skill checks", () => {
    for (const task of codeTasks) {
      for (const variant of task.variants) {
        const grader = getGrader(variant.exerciseId, variant.graderId)!;
        for (const skillId of task.skillIds) {
          expect(variant.skillChecks[skillId]?.length, `${task.id} ${skillId}`).toBeGreaterThan(0);
        }
        for (const [skillId, checks] of Object.entries(variant.skillChecks)) {
          for (const check of checks) {
            expect(grader.requiredTests, `${task.id} ${skillId} ${check}`).toContain(check);
          }
        }
      }
    }
  });

  it("orders prerequisites backward with no cycles", () => {
    const seen = new Set<string>();
    const visiting = new Set<string>();
    const byId = new Map(missions.map((m) => [m.id, m]));
    const visit = (id: string) => {
      expect(visiting.has(id), `cycle at ${id}`).toBe(false);
      if (seen.has(id)) return;
      visiting.add(id);
      for (const pre of byId.get(id)!.prerequisites) visit(pre);
      visiting.delete(id);
      seen.add(id);
    };
    missions.forEach((m) => visit(m.id));
    missions.forEach((m, index) => {
      for (const pre of m.prerequisites) {
        expect(missions.findIndex((x) => x.id === pre)).toBeLessThan(index);
      }
    });
  });

  it("revisits every introduced skill later in another context", () => {
    const introducedAt = new Map<string, number>();
    missions.forEach((m, index) => {
      for (const id of m.introducedSkillIds) if (!introducedAt.has(id)) introducedAt.set(id, index);
    });
    const laterUse = new Map<string, number>();
    missions.forEach((m, index) => {
      for (const id of [...m.revisitedSkillIds, ...m.stages.flatMap((s) => s.tasks.flatMap((t) => t.skillIds))]) {
        if (introducedAt.has(id) && index > introducedAt.get(id)!) laterUse.set(id, index);
      }
    });
    for (const task of curriculum.reviewTasks) {
      for (const id of task.skillIds) if (introducedAt.has(id) && !laterUse.has(id)) laterUse.set(id, missions.length);
    }
    for (const [id, at] of introducedAt) {
      expect(laterUse.has(id), `skill ${id} introduced in mission ${at} never reappears`).toBe(true);
    }
  });

  it("represents all four portfolio projects", () => {
    const ids = new Set(PORTFOLIO_PROJECTS.map((p) => p.id));
    expect(ids.size).toBe(4);
    const used = new Set(
      codeTasks.flatMap((t) => (t.portfolioProjectId ? [t.portfolioProjectId] : [])),
    );
    for (const id of ids) expect(used.has(id), `portfolio ${id} unused`).toBe(true);
  });

  it("has no duplicate instructional or example bodies", () => {
    const bodies = [
      ...tasks.flatMap((t) => [t.explanation]),
      ...tasks.flatMap((t) => t.examples),
    ].map((b) => b.trim()).filter((b) => b.length > 40);
    expect(new Set(bodies).size).toBe(bodies.length);
  });

  it("gives every mission review, learn, build, and explain stages", () => {
    for (const mission of missions) {
      expect(mission.stages.map((s) => s.kind)).toEqual(["review", "learn", "build", "explain"]);
      for (const stage of mission.stages) {
        if (["csv-foundations", "json-api-normalization"].includes(mission.id) && stage.kind === "review") continue;
        expect(stage.tasks.length, `${mission.id} ${stage.kind}`).toBeGreaterThan(0);
      }
      const purposes = mission.stages.flatMap((s) => s.tasks.map((t) => t.purpose));
      expect(purposes).toContain("instruction");
      expect(purposes).toContain("reflection");
      expect(purposes.some((p) => p === "guided-practice" || p === "project")).toBe(true);
    }
  });

  it("keeps retrieval variants on graders with new context ids", () => {
    const retrievals = [...tasks, ...curriculum.reviewTasks].filter((t) => t.purpose === "retrieval");
    expect(retrievals.length).toBeGreaterThan(0);
    for (const task of retrievals) {
      for (const variant of task.variants) {
        expect(getGrader(variant.exerciseId, variant.graderId), task.id).toBeTruthy();
        expect(variant.contextId).toBeTruthy();
      }
    }
  });
});
