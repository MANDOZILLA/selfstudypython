import { describe, expect, it } from "vitest";
import { getDashboardModel, getLibraryRows, getEvidenceRows, getWorkbenchModel, persistAttempt, runStatus, nextWorkbenchPanel } from "../lib/studio";
import { createDefaultState, startOrResumeMission, advanceMissionStage, recordMissionAttempt, saveMissionDraft, migrateState, type LearningState } from "../lib/state";
import { getTask } from "../lib/curriculum";
import { getGrader } from "../public/grading/catalog.js";
import { aggregateResult, failureResult } from "../public/grading/protocol.js";

const now = new Date("2026-09-11T12:00:00.000Z");
const assistance = { hintsUsed: 0, aiAssisted: false, solutionViewed: false };
const start = () => startOrResumeMission(createDefaultState(), now);
function submission(taskId: string, passed = true) {
  const variant = getTask(taskId)!.variants[0];
  const grader = getGrader(variant.exerciseId, variant.graderId);
  return { variantId: variant.id, sourceFiles: { "main.py": "learner code" }, assistance,
    response: "A concrete explanation of my validation decisions.",
    result: grader ? { graderVersion: grader.version, executionOk: true, tests: grader.requiredTests.map((id: string) => ({ id, name: id, required: true, passed, detail: "" })) } : undefined };
}
function learn() { const state = start(); return advanceMissionStage(state, state.missionRuns[0].id, now); }
function submit(state: LearningState, id: string, pass = true) { return recordMissionAttempt(state, state.missionRuns[0].id, id, submission(id, pass), now); }

describe("persisted studio views", () => {
  it("does not store infrastructure failures or alter their review schedule", () => {
    const state = submit(learn(), "csv-instruction");
    for (const message of ["Worker failed", "Timed out after 15 seconds."]) {
      const task = getTask("csv-guided")!;
      const variant = task.variants[0];
      const result = failureResult({ requestId: "failure", exerciseId: variant.exerciseId, graderId: variant.graderId }, message);
      const saved = persistAttempt(state, state.missionRuns[0].id, task.id, { ...submission(task.id), result }, migrateState, now);
      expect(saved.saved).toBe(false);
      expect(saved.error).toBeNull();
      expect(saved.state).toBe(state);
      expect(saved.state.reviewSchedule).toEqual(state.reviewSchedule);
      expect(recordMissionAttempt(state, state.missionRuns[0].id, task.id, { ...submission(task.id), result }, now)).toEqual(state);
    }
  });
  it("stores executed failed checks as negative practice, never positive evidence", () => {
    const state = submit(learn(), "csv-instruction");
    const saved = persistAttempt(state, state.missionRuns[0].id, "csv-guided", submission("csv-guided", false), migrateState, now);
    expect(saved.saved).toBe(true);
    expect(saved.state.attempts.at(-1)).toMatchObject({ passed: false, executionOk: true });
    expect(saved.state.mastery["csv-cleaning"].independentSuccesses).toBe(0);
    expect(getWorkbenchModel(saved.state, state.missionRuns[0].id)?.stageComplete).toBe(false);
    expect(saved.state.reviewSchedule[saved.state.attempts.at(-1)!.skillOutcomes[0].skillId].reason).toBe("repair");
  });
  it("review-only activity never downgrades a completed library mission", () => {
    const state = start();
    state.missionRuns[0].status = "completed";
    state.missionRuns.push({ ...structuredClone(state.missionRuns[0]), id: "review", mode: "review", status: "active" });
    expect(getLibraryRows(state)[0].status).toBe("Completed");
    expect(getLibraryRows(state)[1].blockedReason).toBeNull();
  });
  it("moves keyboard focus through mobile panels with wrapping and Home/End", () => {
    expect(nextWorkbenchPanel("instructions", "ArrowRight")).toBe("code");
    expect(nextWorkbenchPanel("instructions", "ArrowLeft")).toBe("checks");
    expect(nextWorkbenchPanel("checks", "ArrowRight")).toBe("instructions");
    expect(nextWorkbenchPanel("code", "Home")).toBe("instructions");
    expect(nextWorkbenchPanel("code", "End")).toBe("checks");
    expect(nextWorkbenchPanel("code", "Enter")).toBe("code");
  });
  it("shows no evidence or review claims for a fresh learner", () => {
    const model = getDashboardModel(createDefaultState(), now);
    expect(model.evidence).toEqual([]);
    expect(model.reviews).toEqual([]);
    expect(model.completedMissions).toBe(0);
    expect(model.selection.kind).toBe("mission");
    expect(model.mission?.id).toBe("csv-foundations");
  });
  it("resumes the current stage and begins Learn with instruction before practice", () => {
    const state = learn();
    const resumed = startOrResumeMission(state, now);
    const model = getWorkbenchModel(resumed, resumed.missionRuns[0].id);
    expect(resumed.missionRuns).toHaveLength(1);
    expect(model?.stage.kind).toBe("learn");
    expect(model?.task?.id).toBe("csv-instruction");
    expect(getWorkbenchModel(submit(state, "csv-instruction"), resumed.missionRuns[0].id)?.task?.id).toBe("csv-guided");
  });
  it("keeps draft code and assistance after a saved-state roundtrip", () => {
    let state = submit(learn(), "csv-instruction");
    state = saveMissionDraft(state, state.missionRuns[0].id, "csv-guided", { sourceFiles: { "main.py": "unsaved-looking but saved code" }, response: "", assistance: { ...assistance, hintsUsed: 2 } }, now);
    const loaded = migrateState(JSON.parse(JSON.stringify(state)));
    expect(getWorkbenchModel(loaded, state.missionRuns[0].id)?.draft).toMatchObject({ sourceFiles: { "main.py": "unsaved-looking but saved code" }, assistance: { hintsUsed: 2 } });
  });
  it("failed checks remain practice and never enable advancement", () => {
    const state = submit(submit(learn(), "csv-instruction"), "csv-guided", false);
    expect(getWorkbenchModel(state, state.missionRuns[0].id)?.stageComplete).toBe(false);
    expect(getWorkbenchModel(state, state.missionRuns[0].id)?.task?.id).toBe("csv-guided");
    expect(getDashboardModel(state, now).evidence.every(s => s.status === "Practicing")).toBe(true);
  });
  it("passed guided work completes Learn while project success provides project evidence", () => {
    let state = submit(submit(learn(), "csv-instruction"), "csv-guided");
    expect(getWorkbenchModel(state, state.missionRuns[0].id)?.stageComplete).toBe(true);
    expect(getDashboardModel(state, now).evidence.every(s => s.status === "Practicing")).toBe(true);
    state = advanceMissionStage(state, state.missionRuns[0].id, now);
    state = submit(state, "csv-project");
    expect(getDashboardModel(state, now).evidence.find(s => s.skillId === "csv-cleaning")?.status).toBe("Demonstrated in project");
  });
  it("does not treat stale passed code as a completed task", () => {
    let state = submit(submit(learn(), "csv-instruction"), "csv-guided");
    state = saveMissionDraft(state, state.missionRuns[0].id, "csv-guided", { sourceFiles: { "main.py": "changed code" }, response: "", assistance }, now);
    expect(getWorkbenchModel(state, state.missionRuns[0].id)?.stageComplete).toBe(false);
  });
  it("derives library status and evidence rows from real attempts", () => {
    expect(getLibraryRows(createDefaultState()).map(r => r.status)).toEqual(["Not started", "Not started"]);
    expect(getEvidenceRows(createDefaultState())).toEqual([]);
    let state = submit(submit(learn(), "csv-instruction"), "csv-guided");
    expect(getLibraryRows(state).map(r => r.status)).toEqual(["In progress", "Not started"]);
    const rows = getEvidenceRows(state);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "Guided practice: clean a contact list", attempt: { passed: true }, assistance: "Independent", nextReview: "2026-09-12T12:00:00.000Z" });
    state = advanceMissionStage(state, state.missionRuns[0].id, now);
    state = submit(state, "csv-project");
    state = advanceMissionStage(state, state.missionRuns[0].id, now);
    state = submit(state, "csv-explain");
    state = advanceMissionStage(state, state.missionRuns[0].id, now);
    expect(getLibraryRows(state).map(r => r.status)).toEqual(["Completed", "Not started"]);
  });
  it("captures hints and external assistance on persisted attempts", () => {
    const state = submit(learn(), "csv-instruction");
    const saved = persistAttempt(state, state.missionRuns[0].id, "csv-guided", { ...submission("csv-guided"), assistance: { ...assistance, hintsUsed: 2, aiAssisted: true } }, migrateState, now);
    expect(saved.saved).toBe(true);
    expect(getEvidenceRows(saved.state)[0].assistance).toContain("2 hints");
    expect(getEvidenceRows(saved.state)[0].assistance).toContain("AI assistance");
  });
  it("never exposes new evidence when the storage write fails", () => {
    const state = submit(learn(), "csv-instruction");
    const saved = persistAttempt(state, state.missionRuns[0].id, "csv-guided", submission("csv-guided"), () => { throw Error("Storage full"); }, now);
    expect(saved.saved).toBe(false);
    expect(saved.error).toContain("Storage full");
    expect(saved.state).toBe(state);
    expect(saved.state.attempts).toHaveLength(1);
  });
  it("uses verified pass and execution outcomes for distinct run states", () => {
    const request = { requestId: "ui", exerciseId: "contacts-challenge", graderId: "contacts-v1" };
    expect(runStatus(null)).toBe("Ready");
    expect(runStatus(failureResult(request, "Timed out after 15 seconds."))).toBe("Timed out");
    expect(runStatus(failureResult(request, "Worker failed"))).toBe("Couldn't run");
    const result = aggregateResult(request, submission("csv-guided", false).result);
    expect(runStatus(result)).toBe("Needs changes");
    expect(runStatus(aggregateResult(request, submission("csv-guided").result))).toBe("Passed");
  });
});
