import { describe, expect, it } from "vitest";
import { curriculum } from "../lib/curriculum";

const tasks = [
  ...curriculum.missions.flatMap((m) => m.stages.flatMap((s) => s.tasks)),
  ...curriculum.reviewTasks,
];

describe("contextual nudges on curriculum tasks", () => {
  it("authors at least one hint for every mission task", () => {
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) {
      expect(task.hints.length, `${task.id} has no hints`).toBeGreaterThan(0);
      for (const hint of task.hints) expect(hint.trim().length, `${task.id} empty hint`).toBeGreaterThan(0);
    }
  });

  it("gives explanation and reflection prompts a progressive ladder of at least two rungs", () => {
    const reflections = tasks.filter((t) => t.kind === "explanation");
    expect(reflections.length).toBeGreaterThanOrEqual(10);
    for (const task of reflections) {
      expect(task.hints.length, `${task.id} needs >=2 rungs`).toBeGreaterThanOrEqual(2);
    }
  });

  it("gives every code task at least two rungs, weakest first", () => {
    const codeTasks = tasks.filter((t) => t.kind === "code");
    expect(codeTasks.length).toBeGreaterThan(0);
    for (const task of codeTasks) {
      expect(task.hints.length, `${task.id} needs >=2 rungs`).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps instruction tasks hint-bearing too", () => {
    for (const task of tasks.filter((t) => t.kind === "instruction")) {
      expect(task.hints.length, task.id).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps the lesson contract: each build project still ships exactly four hints", () => {
    for (const mission of curriculum.missions) {
      const build = mission.stages.find((s) => s.kind === "build")!.tasks[0];
      expect(build.hints, mission.id).toHaveLength(4);
    }
  });

  it("never leaks a full solution or claims mastery from a hint", () => {
    for (const task of tasks) {
      for (const hint of task.hints) {
        expect(hint, `${task.id}: ${hint}`).not.toMatch(/def solve\(/);
        expect(hint, `${task.id}: ${hint}`).not.toMatch(/mastered|you now know|guaranteed|will pass|perfect score/i);
      }
    }
  });

  it("never repeats a rung inside one task", () => {
    for (const task of tasks) {
      expect(new Set(task.hints).size, task.id).toBe(task.hints.length);
    }
  });
});
