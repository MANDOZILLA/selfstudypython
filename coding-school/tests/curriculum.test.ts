import { describe, expect, it } from "vitest";
import { curriculum, validateCurriculum } from "../lib/curriculum";

describe("seed curriculum", () => {
  it("contains ten complete, schema-valid lessons", () => {
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
});
