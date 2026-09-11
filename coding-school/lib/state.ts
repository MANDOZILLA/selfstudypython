import { z } from "zod";
import { deriveReviewSchedule, deriveSkillEvidence, selectToday, type SkillEvidence, type ReviewSchedule } from "./adaptive";
import { curriculum, getMission, getTask } from "./curriculum";
import { assistanceSchema, attemptSchema, missionRunSchema, type AttemptRecord, type AttemptSubmission, type MissionDraft, type MissionRun } from "./mission-types";
import { aggregateResult } from "../public/grading/protocol.js";
import { getGrader } from "../public/grading/catalog.js";
export type { AttemptRecord, AttemptSubmission, MissionDraft, MissionRun } from "./mission-types";

const STORAGE_KEY = "coding-school:learner-state";
const STATE_VERSION = 2 as const;
export type DashboardTab = "overview" | "lessons" | "learned" | "assessment" | "portfolio";
export type ScheduledReview = ReviewSchedule;
const portfolioSchema = z.object({
  projectId: z.string(), title: z.string(), sourceFiles: z.record(z.string(), z.string()),
  tests: z.array(z.object({ name: z.string(), passed: z.boolean() })), feedback: z.string(),
  score: z.number().min(0).max(1), skillIds: z.array(z.string()), completedAt: z.string(),
});
export type PortfolioSnapshot = z.infer<typeof portfolioSchema>;
export type LearningState = {
  version: typeof STATE_VERSION; dashboard: { activeTab: DashboardTab };
  diagnostic: { completed: boolean; completedAt: string | null };
  attempts: AttemptRecord[]; missionRuns: MissionRun[];
  mastery: Record<string, SkillEvidence>; reviewSchedule: Record<string, ScheduledReview>;
  portfolio: PortfolioSnapshot[];
};
export function createDefaultState(): LearningState {
  return { version: STATE_VERSION, dashboard: { activeTab: "overview" }, diagnostic: { completed: false, completedAt: null },
    attempts: [], missionRuns: [], mastery: {}, reviewSchedule: {}, portfolio: [] };
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function canonicalFiles(files: Record<string, string>) { return JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))); }
/** Stable local fingerprint, not a cryptographic signature. Full snapshots are retained. */
function hash(value: string) {
  let n = 2166136261;
  for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return (n >>> 0).toString(16).padStart(8, "0");
}
function refresh(state: LearningState): LearningState {
  state.mastery = Object.fromEntries(curriculum.skills.map(s => deriveSkillEvidence(state.attempts, s.id)).filter(s => s.status !== "Not started").map(s => [s.skillId, s]));
  state.reviewSchedule = deriveReviewSchedule(state.attempts);
  return state;
}
function locate(state: LearningState, runId: string, taskId?: string) {
  const run = state.missionRuns.find(r => r.id === runId);
  const mission = run && getMission(run.missionId);
  if (!run || !mission || run.missionVersion !== mission.version) throw new Error("Mission run or version is unavailable.");
  if (run.status !== "active") throw new Error("Resume an active mission before editing.");
  const stage = run.stages[run.stageIndex];
  const task = taskId ? getTask(taskId) : undefined;
  if (taskId && (!task || !stage.taskIds.includes(taskId))) throw new Error("Task is not in the active stage.");
  return { run, mission, stage, task };
}
function mergeAssistance(a: MissionDraft["assistance"] | undefined, b: MissionDraft["assistance"]) {
  assistanceSchema.parse(b);
  return { hintsUsed: Math.max(a?.hintsUsed ?? 0, b.hintsUsed), aiAssisted: Boolean(a?.aiAssisted || b.aiAssisted), solutionViewed: Boolean(a?.solutionViewed || b.solutionViewed) };
}

export function startOrResumeMission(state: LearningState, now = new Date(), missionId?: string): LearningState {
  const next = clone(state);
  const active = next.missionRuns.find(r => r.status !== "completed");
  if (active) { active.status = "active"; active.updatedAt = now.toISOString(); return next; }
  const selection = selectToday(next, now);
  const reviewOnly = !missionId && selection.kind === "review";
  const mission = getMission(missionId ?? selection.missionId ?? (reviewOnly ? next.missionRuns.at(-1)?.missionId ?? "" : ""));
  if (!mission) throw new Error("No unlocked mission is available.");
  const completed = new Set(next.missionRuns.filter(r => r.status === "completed" && r.mode === "mission").map(r => r.missionId));
  if (mission.prerequisites.some(id => !completed.has(id))) throw new Error("Complete the prerequisite mission first.");
  const time = now.toISOString();
  const reviewTaskIds = reviewOnly || selection.missionId === mission.id ? selection.reviewTaskIds : [];
  const run: MissionRun = {
    id: crypto.randomUUID(), mode: reviewOnly ? "review" : "mission", missionId: mission.id, missionVersion: mission.version, status: "active", stageIndex: 0,
    stages: mission.stages.map((s, i) => ({ stageId: s.id, status: i === 0 ? "active" : "pending", taskIds: i === 0 ? reviewTaskIds : s.tasks.map(t => t.id), attemptIds: [], completedAt: null })),
    drafts: {}, attemptIds: [], startedAt: time, updatedAt: time, completedAt: null,
  };
  next.missionRuns.push(run);
  return next;
}
export function pauseMission(state: LearningState, runId: string, now = new Date()): LearningState {
  const next = clone(state); const { run } = locate(next, runId);
  run.status = "paused"; run.updatedAt = now.toISOString(); return next;
}
export function saveMissionDraft(state: LearningState, runId: string, taskId: string, draft: Omit<MissionDraft, "updatedAt">, now = new Date()): LearningState {
  const next = clone(state); const { run } = locate(next, runId, taskId);
  run.drafts[taskId] = { ...clone(draft), assistance: mergeAssistance(run.drafts[taskId]?.assistance, draft.assistance), updatedAt: now.toISOString() };
  run.updatedAt = now.toISOString(); return next;
}
export function recordMissionAttempt(state: LearningState, runId: string, taskId: string, input: AttemptSubmission, now = new Date()): LearningState {
  const next = clone(state); const { run, mission, stage, task } = locate(next, runId, taskId);
  const variant = task!.variants.find(v => v.id === input.variantId);
  if (!variant) throw new Error("Unknown task variant.");
  const assistance = mergeAssistance(run.drafts[taskId]?.assistance, input.assistance);
  const response = input.response ?? "";
  const request = { type: "run", requestId: "evidence", exerciseId: variant.exerciseId, graderId: variant.graderId, files: input.sourceFiles };
  const grader = getGrader(variant.exerciseId, variant.graderId);
  const result = aggregateResult(request, input.result);
  if (task!.kind === "code" && input.result?.graderVersion !== grader?.version) throw new Error("Grader version does not match this task.");
  const passed = task!.kind === "code" ? result.passed : task!.kind === "instruction" ? true : response.trim().length >= 20;
  const checks: AttemptRecord["checks"] = task!.kind === "code" ? result.tests : [];
  const executionOk = task!.kind === "code" ? result.executionOk : true;
  const sourceHash = hash(canonicalFiles(input.sourceFiles));
  const resultHash = hash(JSON.stringify({ passed, executionOk, checks: checks.map(c => [c.id, c.required, c.passed]).sort(), response: task!.kind === "code" ? "" : response }));
  const attempt: AttemptRecord = {
    id: crypto.randomUUID(), runId, missionId: mission.id, missionVersion: mission.version, stageId: stage.stageId, taskId, variantId: variant.id, contextId: variant.contextId,
    graderId: variant.graderId, graderVersion: task!.kind === "code" ? result.graderVersion : "ungraded",
    sourceFiles: clone(input.sourceFiles), sourceHash, resultHash, checks,
    skillOutcomes: task!.skillIds.map(skillId => {
      const checkIds = variant.skillChecks[skillId] ?? [];
      return { skillId, checkIds, passed: task!.kind === "code" && executionOk && checkIds.length > 0 && checkIds.every(id => checks.some(c => c.id === id && c.passed)) };
    }),
    introducedSkillIds: task!.introducedSkillIds, assistance, purpose: task!.purpose, passed, executionOk, response, completedAt: now.toISOString(), duplicateOf: null,
  };
  const duplicate = next.attempts.find(a => a.taskId === taskId && a.graderId === attempt.graderId && a.graderVersion === attempt.graderVersion &&
    a.sourceHash === sourceHash && a.resultHash === resultHash && canonicalFiles(a.sourceFiles) === canonicalFiles(attempt.sourceFiles));
  attempt.duplicateOf = duplicate?.id ?? null;
  next.attempts.push(attempt); run.attemptIds.push(attempt.id); stage.attemptIds.push(attempt.id);
  run.drafts[taskId] = { sourceFiles: clone(input.sourceFiles), response, assistance, updatedAt: now.toISOString() };
  run.updatedAt = now.toISOString();
  return refresh(next);
}
export function advanceMissionStage(state: LearningState, runId: string, now = new Date()): LearningState {
  const next = clone(state); const { run, mission, stage } = locate(next, runId);
  const rule = mission.stages[run.stageIndex].advanceRule;
  const complete = stage.taskIds.every(id => {
    const attempts = next.attempts.filter(a => a.runId === runId && a.stageId === stage.stageId && a.taskId === id);
    const latest = attempts.at(-1);
    const draft = run.drafts[id];
    return rule === "attempt-review" ? attempts.length > 0 : Boolean(latest?.passed && (!draft || (canonicalFiles(draft.sourceFiles) === canonicalFiles(latest.sourceFiles) && draft.response === latest.response)));
  });
  if (!complete) throw new Error("Complete the required tasks before advancing.");
  stage.status = "completed"; stage.completedAt = now.toISOString(); run.updatedAt = now.toISOString();
  if (run.stageIndex === 3 || run.mode === "review") { run.status = "completed"; run.completedAt = now.toISOString(); }
  else { run.stageIndex++; run.stages[run.stageIndex].status = "active"; }
  return next;
}

/** Old scores and aggregate mastery cannot establish evidence. Preserve artifacts, never invent attempts. */
export function migrateState(value: unknown): LearningState {
  const next = createDefaultState();
  if (!object(value)) return next;
  const dashboard = object(value.dashboard) ? value.dashboard : {};
  const tab = dashboard.activeTab ?? value.activeDashboardTab;
  if (["overview", "lessons", "learned", "assessment", "portfolio"].includes(String(tab))) next.dashboard.activeTab = tab as DashboardTab;
  const diagnostic = object(value.diagnostic) ? value.diagnostic : {};
  next.diagnostic = { completed: diagnostic.completed === true || value.diagnosticCompleted === true, completedAt: typeof diagnostic.completedAt === "string" ? diagnostic.completedAt : null };
  const portfolio = Array.isArray(value.portfolio) ? value.portfolio : Array.isArray(value.completedProjects) ? value.completedProjects : [];
  next.portfolio = portfolio.flatMap(item => { const parsed = portfolioSchema.safeParse(item); return parsed.success ? [parsed.data] : []; });
  if (value.version !== STATE_VERSION) return next;
  next.missionRuns = (Array.isArray(value.missionRuns) ? value.missionRuns : []).flatMap(item => {
    const parsed = missionRunSchema.safeParse(item);
    if (!parsed.success) return [];
    const run = parsed.data; const mission = getMission(run.missionId);
    if (!mission || run.missionVersion !== mission.version || run.stages.some((s, i) => s.stageId !== mission.stages[i].id ||
      (i === 0 ? s.taskIds.length > 2 || new Set(s.taskIds).size !== s.taskIds.length || s.taskIds.some(id => !curriculum.reviewTasks.some(t => t.id === id)) :
        s.taskIds.join() !== mission.stages[i].tasks.map(t => t.id).join()))) return [];
    return [run];
  });
  const seenIds = new Set<string>();
  next.attempts = (Array.isArray(value.attempts) ? value.attempts : []).flatMap(item => {
    const parsed = attemptSchema.safeParse(item);
    if (!parsed.success || seenIds.has(parsed.data.id)) return [];
    const a = parsed.data; const run = next.missionRuns.find(r => r.id === a.runId); const task = getTask(a.taskId);
    const variant = task?.variants.find(v => v.id === a.variantId);
    if (!run || !task || !variant || a.missionId !== run.missionId || a.missionVersion !== run.missionVersion ||
      !run.stages.some(s => s.stageId === a.stageId && s.taskIds.includes(a.taskId)) ||
      a.contextId !== variant.contextId || a.purpose !== task.purpose || a.graderId !== variant.graderId) return [];
    // Re-aggregate current-version checks. Partial success never becomes project evidence.
    if (task.kind === "code") {
      const grader = getGrader(variant.exerciseId, variant.graderId);
      if (a.graderVersion !== grader?.version) return [];
      const result = aggregateResult({ requestId: "hydrate", exerciseId: variant.exerciseId, graderId: variant.graderId }, { executionOk: a.executionOk, tests: a.checks });
      a.passed = result.passed; a.executionOk = result.executionOk; a.checks = result.tests;
      a.skillOutcomes = task.skillIds.map(skillId => {
        const checkIds = variant.skillChecks[skillId] ?? [];
        return { skillId, checkIds, passed: a.executionOk && checkIds.length > 0 && checkIds.every(id => a.checks.some(c => c.id === id && c.passed)) };
      });
    } else {
      a.passed = task.kind === "instruction" || a.response.trim().length >= 20;
      a.skillOutcomes = task.skillIds.map(skillId => ({ skillId, passed: false, checkIds: [] }));
    }
    a.introducedSkillIds = task.introducedSkillIds;
    a.sourceHash = hash(canonicalFiles(a.sourceFiles));
    a.resultHash = hash(JSON.stringify({ passed: a.passed, executionOk: a.executionOk, checks: a.checks.map(c => [c.id, c.required, c.passed]).sort(), response: task.kind === "code" ? "" : a.response }));
    seenIds.add(a.id);
    return [a];
  });
  for (const run of next.missionRuns) {
    run.attemptIds = next.attempts.filter(a => a.runId === run.id).map(a => a.id);
    for (const stage of run.stages) stage.attemptIds = next.attempts.filter(a => a.runId === run.id && a.stageId === stage.stageId).map(a => a.id);
    // Missing/malformed attempts cannot unlock a later mission through a saved completion flag.
    const mission = getMission(run.missionId)!;
    const incomplete = run.stages.findIndex((stage, index) => stage.status === "completed" && stage.taskIds.some(id => {
      const attempts = next.attempts.filter(a => a.runId === run.id && a.stageId === stage.stageId && a.taskId === id);
      return mission.stages[index].advanceRule === "attempt-review" ? !attempts.length : !attempts.some(a => a.passed);
    }));
    if (incomplete >= 0 || (run.status === "completed" && (run.mode === "review" ? run.stages[0].status !== "completed" : run.stages.some(s => s.status !== "completed")))) {
      run.stageIndex = incomplete >= 0 ? incomplete : run.stages.findIndex(s => s.status !== "completed");
      run.status = "paused"; run.completedAt = null;
      run.stages.forEach((s, i) => { if (i >= run.stageIndex) { s.status = i === run.stageIndex ? "active" : "pending"; s.completedAt = null; } });
    }
  }
  return refresh(next);
}
function storage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try { return window.localStorage; } catch { return undefined; }
}
export function getState(): LearningState {
  try { const serialized = storage()?.getItem(STORAGE_KEY); return serialized ? migrateState(JSON.parse(serialized)) : createDefaultState(); }
  catch { return createDefaultState(); }
}
export function saveState(state: LearningState): LearningState {
  const normalized = migrateState(state);
  // Surface a failed write to the caller; a UI must not claim an unsaved draft persisted.
  const browserStorage = storage();
  if (typeof window !== "undefined" && !browserStorage) throw new Error("Browser storage is unavailable; your changes have not been saved.");
  browserStorage?.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return clone(normalized);
}
export function resetState(): LearningState {
  storage()?.removeItem(STORAGE_KEY);
  return createDefaultState();
}
