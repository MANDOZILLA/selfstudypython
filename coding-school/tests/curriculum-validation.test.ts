import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadPyodide } from "pyodide";
import {
  missions,
  skills,
  DIAGNOSTIC_ITEMS,
  ASSESSMENTS,
} from "../curriculum";
import { PORTFOLIO_PROJECT_DEFINITIONS } from "../curriculum/portfolio-projects";
import { getGrader, graderCatalog } from "../public/grading/catalog.js";
import { hasWrittenGrader } from "../lib/assessment-grading";
import { runSubmission } from "../public/grading/runner.js";

let runtime: Awaited<ReturnType<typeof loadPyodide>>;
beforeAll(async () => { runtime = await loadPyodide({ indexURL: resolve("public/pyodide") }); }, 120000);

describe("curriculum validation", () => {
  it("ships exactly ten missions", () => {
    expect(missions).toHaveLength(10);
  });

  it("ships exactly four portfolio projects", () => {
    expect(PORTFOLIO_PROJECT_DEFINITIONS).toHaveLength(4);
  });

  it("ships exactly three assessment checkpoints", () => {
    expect(ASSESSMENTS).toHaveLength(3);
  });

  it("keeps the skill prerequisite graph acyclic with known prerequisites", () => {
    const ids = new Set(skills.map(s => s.id));
    for (const skill of skills) {
      for (const prereq of skill.prerequisites) {
        expect(ids.has(prereq), `skill ${skill.id} references unknown prerequisite ${prereq}`).toBe(true);
      }
    }
    // Depth-first cycle detection.
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const byId = new Map(skills.map(s => [s.id, s]));
    function visit(id: string, trail: string[]): void {
      if (visited.has(id)) return;
      expect(visiting.has(id), `prerequisite cycle detected: ${[...trail, id].join(" -> ")}`).toBe(false);
      visiting.add(id);
      for (const prereq of byId.get(id)!.prerequisites) visit(prereq, [...trail, id]);
      visiting.delete(id);
      visited.add(id);
    }
    for (const skill of skills) visit(skill.id, []);
  });

  it("registers every grader referenced by missions, diagnostic items, and assessments", () => {
    const refs: { from: string; exerciseId: string; graderId: string }[] = [];
    for (const mission of missions) {
      for (const stage of mission.stages) {
        for (const task of stage.tasks) {
          for (const variant of task.variants ?? []) {
            if (variant.graderId) refs.push({ from: `mission ${mission.id} task ${task.id}`, exerciseId: variant.exerciseId, graderId: variant.graderId });
          }
        }
      }
    }
    for (const item of DIAGNOSTIC_ITEMS) {
      if (item.kind === "coding" && item.coding) {
        refs.push({ from: `diagnostic ${item.id}`, exerciseId: item.coding.exerciseId, graderId: item.coding.graderId });
      }
    }
    for (const assessment of ASSESSMENTS) {
      for (const task of assessment.tasks) {
        if (task.graderId) refs.push({ from: `assessment ${assessment.id} task ${task.id}`, exerciseId: "(catalog)", graderId: task.graderId });
      }
    }
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const entry = (graderCatalog as Record<string, { exerciseId: string } | undefined>)[ref.graderId];
      expect(entry, `${ref.from}: grader ${ref.graderId} missing from the catalog`).toBeDefined();
      if (ref.exerciseId !== "(catalog)") {
        expect(getGrader(ref.exerciseId, ref.graderId),
          `${ref.from}: catalog entry for ${ref.graderId} does not match exercise ${ref.exerciseId}`).toBeDefined();
      }
    }
  });

  it("implements every catalogued grader as a worker suite or a written grader", () => {
    const runnerSource = readFileSync(resolve("public/grading/runner.js"), "utf8");
    const suitesBlock = /const suites = \{([^}]*)\}/.exec(runnerSource);
    expect(suitesBlock, "runner.js must declare a suites map").not.toBeNull();
    const implemented = new Set([...suitesBlock![1].matchAll(/"([^"]+)":/g)].map(m => m[1]));
    for (const [graderId, entry] of Object.entries(graderCatalog) as [string, { exerciseId: string; requiredTests: string[] }][]) {
      if (implemented.has(graderId)) continue;
      // Read/explain tasks are graded semantically, not by the Python worker:
      // every required criterion must have a written predicate.
      const covered = entry.requiredTests.every(criterion => hasWrittenGrader(entry.exerciseId, criterion));
      expect(covered, `grader ${graderId} has neither a worker suite nor written predicates for ${entry.exerciseId}`).toBe(true);
    }
  });

  it("starter code cannot pass its own grader (no solution leaks)", async () => {
    // The real property behind "no solutions in learner-visible fixtures":
    // every shipped starter, graded by its own grader through real Python,
    // must fail. A starter that passes is either a solution leak or an
    // untrustworthy grader — both are curriculum bugs.
    const starters: { from: string; exerciseId: string; graderId: string; files: Record<string, string> }[] = [];
    for (const mission of missions) {
      for (const stage of mission.stages) {
        for (const task of stage.tasks) {
          for (const variant of task.variants ?? []) {
            if (!variant.graderId || Object.keys(variant.starterFiles ?? {}).length === 0) continue;
            starters.push({
              from: `mission ${mission.id} task ${task.id} (${variant.graderId})`,
              exerciseId: variant.exerciseId, graderId: variant.graderId,
              files: { ...variant.starterFiles },
            });
          }
        }
      }
    }
    for (const item of DIAGNOSTIC_ITEMS) {
      if (item.kind === "coding" && item.coding?.starterCode) {
        starters.push({
          from: `diagnostic ${item.id} (${item.coding.graderId})`,
          exerciseId: item.coding.exerciseId, graderId: item.coding.graderId,
          files: { "main.py": item.coding.starterCode },
        });
      }
    }
    expect(starters.length).toBeGreaterThan(0);
    for (const starter of starters) {
      const result = await runSubmission(
        { type: "run", requestId: `starter-check-${starter.graderId}`, exerciseId: starter.exerciseId, graderId: starter.graderId, files: starter.files },
        async () => runtime,
      );
      expect(result.passed, `${starter.from}: starter code passes its own grader — solution leak or weak grader`).toBe(false);
    }
  }, 300000);

  it("never embeds solutions in assessment prompts or hints", () => {
    for (const assessment of ASSESSMENTS) {
      for (const task of assessment.tasks) {
        const text = `${task.prompt}\n${task.hints.join("\n")}`;
        expect(text.includes("def solve("), `assessment ${assessment.id} task ${task.id} leaks a solution`).toBe(false);
      }
    }
  });
});
