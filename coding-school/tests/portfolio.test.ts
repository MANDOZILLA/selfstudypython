import { describe, expect, it } from "vitest";
import {
  createDefaultState,
  startOrResumeMission,
  recordMissionAttempt,
  advanceMissionStage,
  migrateState,
  type LearningState,
  type PortfolioSnapshot as StatePortfolioSnapshot,
} from "../lib/state";
import { CURRICULUM_VERSION, curriculum } from "../lib/curriculum";
import { getGrader } from "../public/grading/catalog.js";
import { PORTFOLIO_PROJECTS } from "../curriculum/skills";
import {
  PORTFOLIO_PROJECT_DEFINITIONS,
  findPortfolioComponent,
  getPortfolioProject,
} from "../curriculum/portfolio-projects";
import {
  createPortfolioSnapshot,
  recordPortfolioSnapshot,
  recordRunPortfolioSnapshots,
  sha256Hex,
  verifyPortfolioSnapshot,
} from "../lib/portfolio";

const CSV_PROJECT_TESTS = [
  "concept-csv", "concept-decimal", "sample", "empty", "header",
  "precision", "invalid", "duplicates", "quoted", "shape",
];

function passedResult(exerciseId: string, graderId: string) {
  const grader = getGrader(exerciseId, graderId);
  if (!grader) throw new Error(`Unknown grader ${graderId}`);
  return {
    graderVersion: grader.version,
    executionOk: true,
    tests: grader.requiredTests.map((id: string) => ({ id, name: `Check ${id}`, required: true, passed: true, detail: "" })),
  };
}

const assistance = { hintsUsed: 2, aiAssisted: false, solutionViewed: false };
const AT = "2026-09-14T12:00:00.000Z";

/** Fresh csv-foundations run moved to the build stage (stage index 2). */
function buildStageState(): { state: LearningState; runId: string } {
  let state = startOrResumeMission(createDefaultState(), new Date(AT), "csv-foundations");
  const runId = state.missionRuns[0].id;
  state = {
    ...state,
    missionRuns: state.missionRuns.map((run) =>
      run.id === runId
        ? { ...run, stageIndex: 2, stages: run.stages.map((s, i) => ({ ...s, status: i < 2 ? "completed" : i === 2 ? "active" : "pending" })) }
        : run,
    ),
  } as LearningState;
  return { state, runId };
}

function recordPassedCsvProject(state: LearningState, runId: string, source = "def solve(csv_text):\n    return []\n"): LearningState {
  return recordMissionAttempt(
    state, runId, "csv-project",
    { variantId: "payments-export-v1", sourceFiles: { "main.py": source }, assistance, result: passedResult("messy-csv-challenge", "payments-csv-v1") },
    new Date(AT),
  );
}

function recordReflection(state: LearningState, runId: string, response = "I normalize first, validate second, and dedupe only after a row is fully valid."): LearningState {
  const moved = {
    ...state,
    missionRuns: state.missionRuns.map((run) =>
      run.id === runId
        ? { ...run, stageIndex: 3, stages: run.stages.map((s, i) => ({ ...s, status: i < 3 ? "completed" : i === 3 ? "active" : "pending" })) }
        : run,
    ),
  } as LearningState;
  return recordMissionAttempt(
    moved, runId, "csv-explain",
    { variantId: "csv-reflection-v1", sourceFiles: {}, response, assistance },
    new Date(AT),
  );
}

describe("portfolio project definitions", () => {
  it("defines all four stable portfolio projects", () => {
    expect(PORTFOLIO_PROJECT_DEFINITIONS).toHaveLength(4);
    expect(new Set(PORTFOLIO_PROJECT_DEFINITIONS.map((p) => p.id))).toEqual(new Set(PORTFOLIO_PROJECTS.map((p) => p.id)));
    for (const project of PORTFOLIO_PROJECT_DEFINITIONS) {
      expect(project.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(project.objective.length).toBeGreaterThan(20);
      expect(project.components.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("covers every mission task tagged with a portfolio project id", () => {
    const tagged = curriculum.missions.flatMap((m) => m.stages.flatMap((s) => s.tasks)).filter((t) => t.portfolioProjectId);
    expect(tagged.length).toBeGreaterThan(0);
    for (const task of tagged) {
      const found = findPortfolioComponent(task.id);
      expect(found, `no portfolio component for task ${task.id}`).toBeDefined();
      expect(found!.project.id).toBe(task.portfolioProjectId);
      expect(found!.component.exerciseId).toBe(task.variants[0].exerciseId);
      expect(found!.component.graderId).toBe(task.variants[0].graderId);
    }
  });

  it("gives every component deterministic fixtures and an exported test module", () => {
    for (const project of PORTFOLIO_PROJECT_DEFINITIONS) {
      for (const component of project.components) {
        expect(Object.keys(component.fixtureFiles).length).toBeGreaterThan(0);
        expect(component.testFileName).toMatch(/^test_[a-z0-9_]+\.py$/);
        expect(component.testFileContent).toContain("unittest");
        expect(component.testFileContent).toContain("from main import solve");
      }
    }
  });
});

describe("portfolio snapshots", () => {
  it("creates a snapshot containing all twelve required fields", () => {
    const { state, runId } = buildStageState();
    const withAttempt = recordPassedCsvProject(state, runId);
    const withReflection = recordReflection(withAttempt, runId);
    const next = recordPortfolioSnapshot(withReflection, runId, "csv-project", new Date(AT));

    expect(next.portfolio).toHaveLength(1);
    const snapshot = next.portfolio[0];
    // Stable project and version IDs
    expect(snapshot.projectId).toBe("portfolio-data-pipeline");
    expect(snapshot.projectVersion).toBe("1.0.0");
    // Objective
    expect(snapshot.objective.length).toBeGreaterThan(20);
    // Source files (learner code, copied by value)
    expect(snapshot.sourceFiles["main.py"]).toContain("def solve");
    // Input fixtures
    expect(Object.keys(snapshot.fixtures).length).toBeGreaterThan(0);
    // Tests and named outcomes
    expect(snapshot.tests.map((t) => t.id).sort()).toEqual([...CSV_PROJECT_TESTS].sort());
    expect(snapshot.tests.every((t) => t.passed)).toBe(true);
    // Score/result
    expect(snapshot.score).toBe(1);
    expect(snapshot.result).toBe("passed");
    // Assistance and hints used
    expect(snapshot.assistance).toEqual({ hintsUsed: 2, aiAssisted: false, solutionViewed: false });
    // Skills demonstrated
    expect(snapshot.skillsDemonstrated.map((s) => s.skillId).sort()).toEqual(
      ["csv-cleaning", "data-structures", "financial-data", "python-functions"].sort(),
    );
    // Reflection
    expect(snapshot.reflection).toContain("normalize first");
    // Completion date
    expect(snapshot.completedAt).toBe(AT);
    // Grader version
    expect(snapshot.graderId).toBe("payments-csv-v1");
    expect(snapshot.graderVersion).toBe("1.2.0");
    // Curriculum version
    expect(snapshot.curriculumVersion).toBe(CURRICULUM_VERSION);
    // Integrity hash verifies
    expect(verifyPortfolioSnapshot(snapshot)).toBe(true);
  });

  it("records a snapshot exactly once per completed component", () => {
    const { state, runId } = buildStageState();
    const once = recordPortfolioSnapshot(recordReflection(recordPassedCsvProject(state, runId), runId), runId, "csv-project");
    const twice = recordPortfolioSnapshot(once, runId, "csv-project");
    expect(twice.portfolio).toHaveLength(1);
    // Repeating the project in a new run does not overwrite the immutable snapshot.
    const rerun = recordPortfolioSnapshot(twice, runId, "csv-project");
    expect(rerun.portfolio[0].sourceFiles["main.py"]).toBe(once.portfolio[0].sourceFiles["main.py"]);
  });

  it("is a no-op for tasks without a portfolio project or without a passed attempt", () => {
    const { state, runId } = buildStageState();
    expect(recordPortfolioSnapshot(state, runId, "csv-project").portfolio).toHaveLength(0);
    expect(recordPortfolioSnapshot(state, runId, "csv-guided").portfolio).toHaveLength(0);
    expect(recordPortfolioSnapshot(state, runId, "no-such-task").portfolio).toHaveLength(0);
  });

  it("deep-copies content so later curriculum edits cannot change the snapshot", () => {
    const { state, runId } = buildStageState();
    const withAttempt = recordPassedCsvProject(state, runId);
    const withReflection = recordReflection(withAttempt, runId);
    const next = recordPortfolioSnapshot(withReflection, runId, "csv-project");
    const snapshot = next.portfolio[0];

    // Mutating the definition's fixture map after the fact must not leak in.
    const component = findPortfolioComponent("csv-project")!;
    const before = JSON.stringify(snapshot.fixtures);
    (component.component.fixtureFiles as Record<string, string>)["fixtures/evil.csv"] = "id\n1\n";
    expect(JSON.stringify(snapshot.fixtures)).toBe(before);
    delete (component.component.fixtureFiles as Record<string, string>)["fixtures/evil.csv"];

    // Mutating the learner's original source object must not leak in either.
    const source = { "main.py": "def solve(csv_text):\n    return []\n" };
    const other = recordPortfolioSnapshot(recordReflection(recordPassedCsvProject(state, runId, source["main.py"]), runId), runId, "csv-project");
    source["main.py"] = "tampered";
    expect(other.portfolio[0].sourceFiles["main.py"]).toContain("def solve");
    expect(verifyPortfolioSnapshot(other.portfolio[0])).toBe(true);
  });

  it("detects tampering through hash verification", () => {
    const { state, runId } = buildStageState();
    const next = recordPortfolioSnapshot(recordReflection(recordPassedCsvProject(state, runId), runId), runId, "csv-project");
    const snapshot = next.portfolio[0];
    expect(verifyPortfolioSnapshot(snapshot)).toBe(true);

    const tampered = { ...snapshot, sourceFiles: { "main.py": "def solve(csv_text):\n    return [{'id':'x'}]\n" } };
    expect(verifyPortfolioSnapshot(tampered)).toBe(false);

    const tamperedScore = { ...snapshot, score: 0.5 };
    expect(verifyPortfolioSnapshot(tamperedScore)).toBe(false);

    // Tampered snapshots are dropped on migration, never repaired.
    const migrated = migrateState({ ...createDefaultState(), version: 3, portfolio: [tampered] });
    expect(migrated.portfolio).toHaveLength(0);
    const migratedValid = migrateState({ ...createDefaultState(), version: 3, portfolio: [snapshot] });
    expect(migratedValid.portfolio).toHaveLength(1);
    expect(verifyPortfolioSnapshot(migratedValid.portfolio[0])).toBe(true);
  });

  it("migrates legacy portfolio entries and backfills the new fields", () => {
    const legacy = {
      projectId: "project-csv-repair", title: "Repair a messy CSV",
      sourceFiles: { "main.py": "print('ok')" },
      tests: [{ name: "removes blank rows", passed: true }],
      feedback: "Handles malformed rows.", score: 0.88,
      skillIds: ["data-cleaning"], completedAt: "2026-09-10T12:00:00.000Z",
    };
    const migrated = migrateState({ ...createDefaultState(), version: 3, portfolio: [legacy] });
    expect(migrated.portfolio).toHaveLength(1);
    const snapshot = migrated.portfolio[0];
    expect(snapshot.projectId).toBe("project-csv-repair");
    expect(snapshot.sourceFiles["main.py"]).toBe("print('ok')");
    expect(snapshot.score).toBe(0.88);
    expect(snapshot.reflection).toBe("");
    expect(verifyPortfolioSnapshot(snapshot)).toBe(true);
  });

  it("creates snapshots for every passed portfolio component when a run completes", () => {
    let state = startOrResumeMission(createDefaultState(), new Date(AT), "csv-foundations");
    const runId = state.missionRuns[0].id;
    // Review stage (no authored tasks here) advances immediately.
    state = advanceMissionStage(state, runId, new Date(AT));
    // Learn stage: instruction + guided practice.
    state = recordMissionAttempt(state, runId, "csv-instruction",
      { variantId: "csv-reading-v1", sourceFiles: {}, response: "I read the lesson and took notes on validation order.", assistance }, new Date(AT));
    state = recordMissionAttempt(state, runId, "csv-guided",
      { variantId: "contacts-v1", sourceFiles: { "main.py": "def solve(records):\n    return []\n" }, assistance, result: passedResult("contacts-challenge", "contacts-v1") }, new Date(AT));
    state = advanceMissionStage(state, runId, new Date(AT));
    // Build stage: the tagged project.
    state = recordPassedCsvProject(state, runId);
    expect(state.portfolio).toHaveLength(0);
    state = advanceMissionStage(state, runId, new Date(AT));
    // Explain stage: reflection.
    state = recordReflection(state, runId);
    state = advanceMissionStage(state, runId, new Date(AT));

    const run = state.missionRuns.find((r) => r.id === runId)!;
    expect(run.status).toBe("completed");
    expect(state.portfolio).toHaveLength(1);
    expect(state.portfolio[0].projectId).toBe("portfolio-data-pipeline");
    expect(state.portfolio[0].reflection).toContain("normalize first");
    expect(verifyPortfolioSnapshot(state.portfolio[0])).toBe(true);
  });

  it("uses SHA-256 for snapshot hashes", () => {
    // Known-answer check against the standard test vector.
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const snapshot = createPortfolioSnapshot({
      projectId: "p", projectVersion: "1.0.0", componentId: "c", title: "t", objective: "o",
      sourceFiles: {}, fixtures: {}, exportFiles: {}, tests: [], score: 1, result: "passed",
      assistance: { hintsUsed: 0, aiAssisted: false, solutionViewed: false },
      skillsDemonstrated: [], reflection: "", completedAt: AT,
      graderId: "g", graderVersion: "1.0.0", curriculumVersion: CURRICULUM_VERSION,
    });
    expect(snapshot.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyPortfolioSnapshot(snapshot)).toBe(true);
  });

  it("records snapshots for all components of a project independently", () => {
    const project = getPortfolioProject("portfolio-data-pipeline")!;
    expect(project.components.length).toBeGreaterThanOrEqual(2);
    // recordRunPortfolioSnapshots is idempotent and additive across components.
    const { state, runId } = buildStageState();
    const withOne = recordRunPortfolioSnapshots(recordReflection(recordPassedCsvProject(state, runId), runId), runId);
    expect(withOne.portfolio).toHaveLength(1);
    const again = recordRunPortfolioSnapshots(withOne, runId);
    expect(again.portfolio).toHaveLength(1);
  });

  it("exposes the portfolio snapshot type through lib/state", async () => {
    await import("../lib/state");
    const { state, runId } = buildStageState();
    const next: ReturnType<typeof recordPortfolioSnapshot> = recordPortfolioSnapshot(
      recordReflection(recordPassedCsvProject(state, runId), runId), runId, "csv-project");
    const snapshots: StatePortfolioSnapshot[] = next.portfolio;
    expect(snapshots[0].id).toBe("portfolio-data-pipeline:csv-project");
  });
});
