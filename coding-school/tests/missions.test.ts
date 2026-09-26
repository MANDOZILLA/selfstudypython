import { describe, expect, it } from "vitest";
import * as engine from "../lib/state";
import * as adaptive from "../lib/adaptive";
import * as authored from "../lib/curriculum";
import { getGrader } from "../public/grading/catalog.js";

const day = (n: number) => new Date(`2026-09-${String(n).padStart(2, "0")}T12:00:00.000Z`);
const assistance = { hintsUsed: 0, aiAssisted: false, solutionViewed: false };

function start() {
  return engine.startOrResumeMission(engine.createDefaultState(), day(11));
}
function submit(state: engine.LearningState, taskId: string, pass = true, assisted = false, now = day(11), source = "learner source") {
  const run = state.missionRuns.at(-1)!;
  const task = authored.getTask(taskId)!;
  const variant = task.variants[0];
  const grader = getGrader(variant.exerciseId, variant.graderId);
  return engine.recordMissionAttempt(state, run.id, task.id, {
    variantId: variant.id, sourceFiles: { "main.py": source },
    assistance: { ...assistance, hintsUsed: assisted ? 1 : 0 },
    result: task.kind === "code" ? {
      graderVersion: grader!.version, executionOk: true,
      tests: grader!.requiredTests.map((id: string) => ({ id, name: id, required: true, passed: pass, detail: "" })),
    } : undefined,
    response: "I traced the input, explained the validation order, and identified a failing example.",
  }, now);
}
function toBuild() {
  let state = start();
  state = engine.advanceMissionStage(state, state.missionRuns[0].id, day(11));
  for (const id of state.missionRuns[0].stages[1].taskIds) state = submit(state, id);
  return engine.advanceMissionStage(state, state.missionRuns[0].id, day(11));
}

function completeAuthoredMissions() {
  let state = start();
  for (let mission = 0; mission < authored.curriculum.missions.length; mission++) {
    if (mission) state = engine.startOrResumeMission(state, day(11));
    const runId = state.missionRuns.at(-1)!.id;
    for (let stage = state.missionRuns.at(-1)!.stageIndex; stage < 4; stage++) {
      for (const taskId of state.missionRuns.at(-1)!.stages[stage].taskIds) state = submit(state, taskId);
      state = engine.advanceMissionStage(state, runId, day(11));
    }
  }
  return state;
}

describe("continuous missions and honest evidence", () => {
  it("advances later review runs with identical correct source without creating mastery diversity", () => {
    const state = submit(toBuild(), "csv-project");
    const project = state.attempts.at(-1)!;
    const first = { ...project, id: "review-1", runId: "review-run-1", taskId: "csv-tags-retrieval", purpose: "retrieval" as const, contextId: "label-export", completedAt: day(12).toISOString(), duplicateOf: null };
    const later = { ...first, id: "review-2", runId: "review-run-2", completedAt: day(15).toISOString(), duplicateOf: first.id };
    const attempts = [...state.attempts, first, later];
    expect(adaptive.deriveReviewSchedule(attempts)["csv-cleaning"]).toMatchObject({ intervalDays: 7, dueAt: day(22).toISOString() });
    expect(adaptive.deriveSkillEvidence(attempts, "csv-cleaning")).toMatchObject({ status: "Demonstrated again later", distinctContexts: 2, independentSuccesses: 2 });
    expect(adaptive.deriveReviewSchedule([...attempts, { ...later, id: "repeat-in-run", completedAt: day(22).toISOString() }])["csv-cleaning"].dueAt).toBe(day(22).toISOString());
  });
  it("does not let repeated earlier reviews starve a later JSON review", () => {
    const state = completeAuthoredMissions();
    const template = state.attempts.find(attempt => attempt.taskId === "csv-project")!;
    const outcomes = (...skillIds: string[]) => skillIds.map(skillId => ({ skillId, checkIds: ["sample"], passed: true }));
    const csvProject = { ...template, id: "csv-project-evidence", runId: "mission-csv", skillOutcomes: outcomes("csv-cleaning", "python-functions", "data-structures"), completedAt: day(11).toISOString() };
    const financeProject = { ...template, id: "finance-project-evidence", runId: "mission-finance", taskId: "finance-project", contextId: "finance-project", skillOutcomes: outcomes("financial-data"), completedAt: day(11).toISOString() };
    const csvReview = { ...csvProject, id: "csv-review-1", runId: "review-1", taskId: "csv-tags-retrieval", contextId: "label-export", purpose: "retrieval" as const, completedAt: day(12).toISOString(), duplicateOf: null };
    const financeReview = { ...financeProject, id: "finance-review-1", runId: "review-1", taskId: "invoice-cents-retrieval", contextId: "invoice-budget", purpose: "retrieval" as const, completedAt: day(12).toISOString(), duplicateOf: null };
    const jsonInstruction = { ...template, id: "json-instruction-evidence", runId: "mission-json", taskId: "json-instruction", contextId: "json-teaching", purpose: "instruction" as const, introducedSkillIds: ["json-validation"], skillOutcomes: outcomes("json-validation"), completedAt: day(15).toISOString() };
    state.attempts = [
      csvProject,
      financeProject,
      csvReview,
      financeReview,
      { ...csvReview, id: "csv-review-2", runId: "review-2", completedAt: day(15).toISOString(), duplicateOf: csvReview.id },
      { ...financeReview, id: "finance-review-2", runId: "review-2", completedAt: day(15).toISOString(), duplicateOf: financeReview.id },
      jsonInstruction,
      { ...template, id: "reconciliation-draft", runId: "draft", taskId: "settlement-reconciliation-retrieval", purpose: "reflection" as const, introducedSkillIds: [], skillOutcomes: [], completedAt: day(15).toISOString() },
    ];

    const selection = adaptive.selectToday(state, day(16));
    expect(selection.reviewTaskIds.some(taskId => authored.getTask(taskId)?.skillIds.includes("json-validation"))).toBe(true);
  });
  it("finds a qualifying subset even when extra early success uses the later retrieval context", () => {
    const state = submit(toBuild(), "csv-project");
    const project = state.attempts.at(-1)!;
    const early = { ...project, id: "early", taskId: "inventory-retrieval", purpose: "retrieval" as const, contextId: "inventory", completedAt: day(12).toISOString(), duplicateOf: null };
    const transfer = { ...project, id: "transfer", taskId: "json-project", contextId: "api-payments", completedAt: day(13).toISOString(), duplicateOf: null };
    const delayed = { ...early, id: "delayed", runId: "later-run", completedAt: day(15).toISOString(), duplicateOf: null };
    expect(adaptive.deriveSkillEvidence([...state.attempts, transfer, delayed], "data-structures").status).toBe("Mastered");
    expect(adaptive.deriveSkillEvidence([...state.attempts, early, transfer, delayed], "data-structures").status).toBe("Mastered");
  });
  it("starts empty without fabricated skill or review claims", () => {
    const state = engine.createDefaultState();
    expect(state.missionRuns).toEqual([]);
    expect(adaptive.deriveSkillEvidence(state.attempts, "csv-cleaning").status).toBe("Not started");
    expect(adaptive.deriveReviewSchedule(state.attempts)).toEqual({});
    expect(adaptive.selectToday(state, day(11))).toMatchObject({ kind: "mission", missionId: "csv-foundations" });
  });
  it("resumes the same run and draft after serialization and a date change", () => {
    let state = start();
    const id = state.missionRuns[0].id;
    state = engine.advanceMissionStage(state, id, day(11));
    state = engine.saveMissionDraft(state, id, "csv-guided", { sourceFiles: { "main.py": "return records" }, response: "notes", assistance }, day(11));
    state = engine.pauseMission(state, id, day(11));
    state = engine.startOrResumeMission(engine.migrateState(JSON.parse(JSON.stringify(state))), day(12));
    expect(state.missionRuns).toHaveLength(1);
    expect(state.missionRuns[0]).toMatchObject({ id, status: "active", stageIndex: 1 });
    expect(state.missionRuns[0].drafts["csv-guided"].sourceFiles["main.py"]).toBe("return records");
  });
  it("cannot skip teaching, guided practice, or a failing project", () => {
    let state = start();
    const id = state.missionRuns[0].id;
    state = engine.advanceMissionStage(state, id, day(11));
    expect(() => engine.advanceMissionStage(state, id, day(11))).toThrow(/complete/i);
    state = toBuild();
    state = submit(state, "csv-project", false);
    expect(() => engine.advanceMissionStage(state, state.missionRuns[0].id, day(11))).toThrow(/complete/i);
    expect(adaptive.deriveSkillEvidence(state.attempts, "csv-cleaning")).toMatchObject({ independentSuccesses: 0, lastDemonstratedAt: null });
  });
  it("allows assisted project completion without calling it demonstrated", () => {
    let state = submit(toBuild(), "csv-project", true, true);
    state = engine.advanceMissionStage(state, state.missionRuns[0].id, day(11));
    state = submit(state, "csv-explain");
    state = engine.advanceMissionStage(state, state.missionRuns[0].id, day(11));
    expect(state.missionRuns[0].status).toBe("completed");
    expect(adaptive.deriveSkillEvidence(state.attempts, "csv-cleaning").status).toBe("Practicing");
  });
  it("credits an independent project and ignores exact repeat submissions", () => {
    let state = submit(toBuild(), "csv-project");
    state = submit(state, "csv-project");
    const projects = state.attempts.filter(a => a.purpose === "project");
    expect(projects).toHaveLength(2);
    expect(projects[1].duplicateOf).toBe(projects[0].id);
    expect(adaptive.deriveSkillEvidence(state.attempts, "csv-cleaning")).toMatchObject({ status: "Demonstrated in project", independentSuccesses: 1 });
  });
  it("never gains diversity from the same task on different days or changed source", () => {
    let state = submit(toBuild(), "csv-project");
    state = submit(state, "csv-project", true, false, day(12), "changed source");
    state = submit(state, "csv-project", true, false, day(15), "third source");
    expect(adaptive.deriveSkillEvidence(state.attempts, "csv-cleaning")).toMatchObject({ status: "Demonstrated in project", distinctContexts: 1 });
  });
  it("requires distinct later contexts and delayed retrieval for Mastered", () => {
    const state = submit(toBuild(), "csv-project");
    const project = state.attempts.at(-1)!;
    // Historical records use the same persisted contract as the recording API.
    const later = { ...project, id: "later", taskId: "json-project", contextId: "api-payments", completedAt: day(12).toISOString(), sourceHash: "new", duplicateOf: null };
    expect(adaptive.deriveSkillEvidence([...state.attempts, later], "data-structures").status).toBe("Demonstrated again later");
    const retrieval = { ...later, id: "retrieval", taskId: "inventory-retrieval", purpose: "retrieval" as const, contextId: "inventory", completedAt: day(15).toISOString() };
    expect(adaptive.deriveSkillEvidence([...state.attempts, later, retrieval], "data-structures").status).toBe("Mastered");
    expect(adaptive.deriveSkillEvidence([...state.attempts, later, { ...retrieval, completedAt: day(12).toISOString() }], "data-structures").status).toBe("Demonstrated again later");
  });
  it("schedules only exposed skills and shortens failed retrieval to repair", () => {
    const state = submit(toBuild(), "csv-project");
    const project = state.attempts.at(-1)!;
    expect(adaptive.deriveReviewSchedule(state.attempts)["csv-cleaning"]).toMatchObject({ intervalDays: 1, dueAt: day(12).toISOString() });
    const retrieval = { ...project, id: "review", taskId: "inventory-retrieval", purpose: "retrieval" as const, contextId: "inventory", completedAt: day(12).toISOString(), duplicateOf: null };
    const reviews = [...state.attempts, retrieval];
    expect(adaptive.deriveReviewSchedule(reviews)["data-structures"]).toMatchObject({ intervalDays: 3, dueAt: day(15).toISOString() });
    const failed = { ...retrieval, id: "failed", resultHash: "failed-result", completedAt: day(15).toISOString(), passed: false, skillOutcomes: retrieval.skillOutcomes.map(s => ({ ...s, passed: false })) };
    expect(adaptive.deriveReviewSchedule([...reviews, failed])["data-structures"]).toMatchObject({ intervalDays: 1, reason: "repair", dueAt: day(16).toISOString() });
  });
  it("excludes unsuccessful executions from review scheduling", () => {
    const state = submit(toBuild(), "csv-project");
    const before = adaptive.deriveReviewSchedule(state.attempts);
    const infrastructureFailure = {
      ...state.attempts.at(-1)!, id: "worker-failure", runId: "failed-run", executionOk: false, passed: false,
      resultHash: "worker-failure", completedAt: day(15).toISOString(),
      skillOutcomes: state.attempts.at(-1)!.skillOutcomes.map(outcome => ({ ...outcome, passed: false })),
    };
    expect(adaptive.deriveReviewSchedule([...state.attempts, infrastructureFailure])).toEqual(before);
  });
  it("selects active first, rejects locked missions, then adds bounded relevant review", () => {
    expect(() => engine.startOrResumeMission(engine.createDefaultState(), day(11), "json-api-normalization")).toThrow(/prerequisite/i);
    let state = submit(toBuild(), "csv-project");
    expect(adaptive.selectToday(state, day(20))).toMatchObject({ kind: "resume", runId: state.missionRuns[0].id });
    state = engine.advanceMissionStage(state, state.missionRuns[0].id, day(11));
    state = submit(state, "csv-explain");
    state = engine.advanceMissionStage(state, state.missionRuns[0].id, day(11));
    const next = adaptive.selectToday(state, day(15));
    expect(next).toMatchObject({ kind: "mission", missionId: "json-api-normalization" });
    expect(next.reviewTaskIds.length).toBeGreaterThan(0);
    expect(next.reviewTaskIds.length).toBeLessThanOrEqual(2);
  });
  it("drops unsupported legacy mastery while preserving actual artifacts and preferences", () => {
    const state = engine.migrateState({ version: 1, activeDashboardTab: "learned", mastery: [{ skillId: "csv-cleaning", score: 99 }], reviews: [{ skillId: "csv-cleaning", dueAt: day(11).toISOString() }], attempts: [{ id: "legacy", kind: "project", score: 1 }] });
    expect(state.version).toBe(3);
    expect(state.dashboard.activeTab).toBe("learned");
    expect(state.attempts).toEqual([]);
    expect(state.mastery).toEqual({});
    expect(state.reviewSchedule).toEqual({});
  });
  it("keeps assistance sticky after editing or resetting a draft", () => {
    let state = toBuild();
    state = engine.saveMissionDraft(state, state.missionRuns[0].id, "csv-project", { sourceFiles: { "main.py": "draft" }, response: "", assistance: { ...assistance, solutionViewed: true } }, day(11));
    state = submit(state, "csv-project");
    expect(state.attempts.at(-1)!.assistance.solutionViewed).toBe(true);
    expect(adaptive.deriveSkillEvidence(state.attempts, "csv-cleaning").status).toBe("Practicing");
  });
  it("requires the current draft to have passed, not a stale earlier submission", () => {
    let state = submit(toBuild(), "csv-project");
    state = engine.saveMissionDraft(state, state.missionRuns[0].id, "csv-project", { sourceFiles: { "main.py": "broken revision" }, response: "", assistance }, day(11));
    expect(() => engine.advanceMissionStage(state, state.missionRuns[0].id, day(11))).toThrow(/complete/i);
  });
  it("does not turn reflection completion into a failed skill review", () => {
    let state = submit(toBuild(), "csv-project");
    const reviews = state.reviewSchedule;
    state = engine.advanceMissionStage(state, state.missionRuns[0].id, day(11));
    state = submit(state, "csv-explain");
    expect(state.reviewSchedule).toEqual(reviews);
  });
  it("recomputes result fingerprints and repairs completion after malformed saved evidence", () => {
    const state = submit(toBuild(), "csv-project");
    const duplicate = submit(state, "csv-project");
    duplicate.attempts.at(-1)!.resultHash = "tampered";
    duplicate.attempts.at(-1)!.duplicateOf = null;
    const loaded = engine.migrateState(duplicate);
    expect(adaptive.deriveSkillEvidence(loaded.attempts, "csv-cleaning").independentSuccesses).toBe(1);
    const broken = structuredClone(loaded);
    broken.missionRuns[0].status = "completed";
    broken.attempts = [];
    expect(engine.migrateState(broken).missionRuns[0].status).not.toBe("completed");
  });
  it("seats the mission's authored review tasks in the review stage of a new run", () => {
    let state = start();
    for (const missionId of ["csv-foundations", "json-api-normalization"]) {
      if (missionId !== "csv-foundations") state = engine.startOrResumeMission(state, day(11), missionId);
      const runId = state.missionRuns.at(-1)!.id;
      for (let stage = 0; stage < 4; stage++) {
        for (const taskId of state.missionRuns.at(-1)!.stages[stage].taskIds) state = submit(state, taskId);
        state = engine.advanceMissionStage(state, runId, day(11));
      }
    }
    state = engine.startOrResumeMission(state, day(11), "python-recovery");
    const run = state.missionRuns.at(-1)!;
    expect(run.stages[0].taskIds).toContain("recovery-review-functions");
    const migrated = engine.migrateState(JSON.parse(JSON.stringify(state)));
    expect(migrated.missionRuns.at(-1)!.stages[0].taskIds).toContain("recovery-review-functions");
  });
  it("offers a resumable short review after the authored missions are complete", () => {
    let state = start();
    for (let mission = 0; mission < authored.curriculum.missions.length; mission++) {
      if (mission) state = engine.startOrResumeMission(state, day(11));
      const runId = state.missionRuns.at(-1)!.id;
      for (let stage = 0; stage < 4; stage++) {
        for (const taskId of state.missionRuns.at(-1)!.stages[stage].taskIds) state = submit(state, taskId);
        state = engine.advanceMissionStage(state, runId, day(11));
      }
    }
    expect(adaptive.selectToday(state, day(15)).kind).toBe("review");
    state = engine.startOrResumeMission(state, day(15));
    expect(state.missionRuns.at(-1)!.mode).toBe("review");
    const reviewId = state.missionRuns.at(-1)!.id;
    for (const id of state.missionRuns.at(-1)!.stages[0].taskIds) state = submit(state, id, false, false, day(15));
    state = engine.advanceMissionStage(state, reviewId, day(15));
    expect(engine.migrateState(state).missionRuns.at(-1)!.status).toBe("completed");
  });
  it("uses 1/3/7/14-day intervals and does not extend an early retrieval", () => {
    const state = submit(toBuild(), "csv-project");
    const project = state.attempts.at(-1)!;
    const retrieval = { ...project, id: "r1", taskId: "inventory-retrieval", purpose: "retrieval" as const, contextId: "inventory", completedAt: day(12).toISOString(), duplicateOf: null };
    const r2 = { ...retrieval, id: "r2", runId: "review-run-2", sourceHash: "r2", completedAt: day(15).toISOString() };
    const r3 = { ...retrieval, id: "r3", runId: "review-run-3", sourceHash: "r3", completedAt: day(22).toISOString() };
    expect(adaptive.deriveReviewSchedule([...state.attempts, retrieval, r2])["data-structures"]).toMatchObject({ intervalDays: 7, dueAt: day(22).toISOString() });
    expect(adaptive.deriveReviewSchedule([...state.attempts, retrieval, r2, r3])["data-structures"]).toMatchObject({ intervalDays: 14, dueAt: "2026-10-06T12:00:00.000Z" });
    expect(adaptive.deriveReviewSchedule([...state.attempts, retrieval, { ...r2, completedAt: day(13).toISOString() }])["data-structures"].dueAt).toBe(day(15).toISOString());
  });
  it("rejects saved stages that replace authored requirements with empty task lists", () => {
    const state = start();
    state.missionRuns[0].stages[1].taskIds = [];
    expect(engine.migrateState(state).missionRuns).toEqual([]);
  });
});

describe("authored mission contracts", () => {
  it.each(["csv-cleaning", "json-validation"])("provides enough graded contexts for %s to reach mastery after delayed retrieval", skillId => {
    const tasks = [...authored.curriculum.missions.flatMap(m => m.stages.flatMap(s => s.tasks)), ...authored.curriculum.reviewTasks].filter(t => (t.purpose === "project" || t.purpose === "retrieval") && t.skillIds.includes(skillId));
    expect(new Set(tasks.flatMap(t => t.variants.map(v => v.contextId))).size).toBeGreaterThanOrEqual(3);
    const project = tasks.find(task => task.purpose === "project")!;
    const retrievals = tasks.filter(task => task.purpose === "retrieval").slice(0, 2);
    const template = completeAuthoredMissions().attempts.find(attempt => attempt.taskId === project.id)!;
    const evidence = [project, ...retrievals].map((task, index) => ({
      ...template,
      id: `${skillId}-${index}`,
      runId: `${skillId}-run-${index}`,
      taskId: task.id,
      contextId: task.variants[0].contextId,
      purpose: task.purpose,
      skillOutcomes: [{ skillId, checkIds: task.variants[0].skillChecks[skillId], passed: true }],
      completedAt: day([11, 12, 15][index]).toISOString(),
      duplicateOf: null,
    }));
    expect(adaptive.deriveSkillEvidence(evidence, skillId).status).toBe("Mastered");
  });
  it("has a short executable retrieval for every taught skill", () => {
    for (const skill of authored.curriculum.skills) {
      expect(authored.curriculum.reviewTasks.some(task => task.skillIds.includes(skill.id))).toBe(true);
    }
  });
  it("validates references, executable code variants, ordered stages and a 30-60 minute guide", () => {
    expect(authored.curriculum.missions?.length).toBeGreaterThanOrEqual(2);
    expect(authored.validateCurriculum(authored.curriculum).success).toBe(true);
    for (const mission of authored.curriculum.missions) {
      expect(mission.stages.map(stage => stage.kind)).toEqual(["review", "learn", "build", "explain"]);
      expect(mission.estimatedMinutes).toBeGreaterThanOrEqual(30);
      expect(mission.estimatedMinutes).toBeLessThanOrEqual(60);
      expect(mission.stages.reduce((sum, stage) => sum + stage.estimatedMinutes, 0)).toBe(mission.estimatedMinutes);
      expect(mission.stages[0].estimatedMinutes).toBeLessThanOrEqual(5);
      for (const stage of mission.stages) for (const task of stage.tasks) for (const variant of task.variants) {
        if (task.kind === "code") expect(getGrader(variant.exerciseId, variant.graderId)).toBeTruthy();
      }
    }
    const bad = structuredClone(authored.curriculum);
    bad.missions[1].prerequisites = ["missing-mission"];
    expect(authored.validateCurriculum(bad).success).toBe(false);
  });
});
