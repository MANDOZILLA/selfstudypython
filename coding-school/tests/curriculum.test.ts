import { describe, expect, it } from "vitest";
import { curriculum, validateCurriculum } from "../lib/curriculum";
import { DIAGNOSTIC_CORE_SKILLS, DIAGNOSTIC_ITEMS, DIAGNOSTIC_SKILLS } from "../curriculum";

describe("seed curriculum", () => {
  it("exposes complete authored missions through the compatibility lesson view", () => {
    expect(validateCurriculum(curriculum).success).toBe(true);
    expect(curriculum.lessons).toHaveLength(10);
    for (const lesson of curriculum.lessons) {
      expect(lesson.objectives.length).toBeGreaterThan(1);
      expect(lesson.examples.length).toBeGreaterThanOrEqual(2);
      expect(lesson.exercise.hints).toHaveLength(4);
      expect(lesson.exercise).toHaveProperty("graderId");
      expect(lesson.exercise).not.toHaveProperty("hiddenTests");
      expect(lesson.dailyProject).toBeTruthy();
    }
  });

  it("uses stable and unique IDs", () => {
    const ids = [
      ...curriculum.skills.map((skill) => skill.id),
      ...curriculum.lessons.map((lesson) => lesson.id),
      ...curriculum.projects.map((project) => project.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("registers the diagnostic item bank and its skills through the curriculum index", () => {
    expect(DIAGNOSTIC_ITEMS.length).toBeGreaterThanOrEqual(40);
    expect(DIAGNOSTIC_SKILLS.map(s => s.id).sort()).toEqual([...DIAGNOSTIC_CORE_SKILLS].sort());
    for (const skill of DIAGNOSTIC_SKILLS) {
      expect(skill.title.length).toBeGreaterThan(0);
    }
    const known = new Set<string>(DIAGNOSTIC_SKILLS.map(s => s.id));
    for (const item of DIAGNOSTIC_ITEMS) {
      expect(known.has(item.skillId)).toBe(true);
    }
  });
});
