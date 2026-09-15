import { deriveReviewSchedule, deriveSkillEvidence, selectToday } from "./adaptive";
import { curriculum, getMission, getTask } from "./curriculum";
import { PORTFOLIO_PROJECT_DEFINITIONS } from "../curriculum/portfolio-projects";
import { recordMissionAttempt, type AttemptSubmission, type LearningState, type MissionDraft } from "./state";
import type { GradeResult } from "./runner";

export type Destination = "today" | "lessons" | "learned" | "assessment" | "portfolio";
export const destinations: { id: Destination; label: string }[] = [
  { id: "today", label: "Today" }, { id: "lessons", label: "Lessons" },
  { id: "learned", label: "What I Learned" }, { id: "assessment", label: "Self-Assessment" },
  { id: "portfolio", label: "Portfolio" },
];
export const unassisted = { hintsUsed: 0, aiAssisted: false, solutionViewed: false };
export const workbenchPanels = ["instructions", "code", "checks"] as const;
export type WorkbenchPanel = typeof workbenchPanels[number];
export function nextWorkbenchPanel(current: WorkbenchPanel, key: string): WorkbenchPanel {
  if (key === "Home") return "instructions";
  if (key === "End") return "checks";
  const direction = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  return workbenchPanels[(workbenchPanels.indexOf(current) + direction + workbenchPanels.length) % workbenchPanels.length];
}

export function getDashboardModel(state: LearningState, now = new Date()) {
  const selection = selectToday(state, now);
  const run = state.missionRuns.find(r => r.id === selection.runId);
  const mission = getMission(selection.missionId ?? state.missionRuns.at(-1)?.missionId ?? "");
  return { selection, mission, run,
    completedMissions: state.missionRuns.filter(r => r.mode === "mission" && r.status === "completed").length,
    evidence: curriculum.skills.map(s => ({ ...deriveSkillEvidence(state.attempts, s.id), title: s.title })).filter(s => s.status !== "Not started"),
    reviews: Object.values(deriveReviewSchedule(state.attempts)).sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
  };
}

export function getLibraryRows(state: LearningState) {
  const active = state.missionRuns.find(r => r.mode === "mission" && r.status !== "completed");
  const completed = new Set(state.missionRuns.filter(r => r.mode === "mission" && r.status === "completed").map(r => r.missionId));
  return curriculum.missions.map(mission => {
    const status = active?.missionId === mission.id ? "In progress" : completed.has(mission.id) ? "Completed" : "Not started";
    const prerequisite = mission.prerequisites.find(id => !completed.has(id));
    const blockedReason = prerequisite ? `Complete ${getMission(prerequisite)?.title} first.` : active && active.missionId !== mission.id ? "Finish your current mission before starting another." : null;
    return { mission, status, blockedReason, artifact: mission.stages[2].tasks[0]?.title ?? mission.summary };
  });
}

export function getEvidenceRows(state: LearningState) {
  const reviews = deriveReviewSchedule(state.attempts);
  return [...state.attempts].reverse().map(attempt => {
    const help = [attempt.assistance.hintsUsed ? `${attempt.assistance.hintsUsed} hint${attempt.assistance.hintsUsed === 1 ? "" : "s"}` : "", attempt.assistance.aiAssisted ? "AI assistance" : "", attempt.assistance.solutionViewed ? "Solution viewed" : ""].filter(Boolean);
    const nextReview = [...new Set([...attempt.introducedSkillIds, ...attempt.skillOutcomes.map(s => s.skillId)])].flatMap(id => reviews[id] ? [reviews[id].dueAt] : []).sort()[0] ?? null;
    return { attempt, title: getTask(attempt.taskId)?.title ?? attempt.taskId,
      missionTitle: getMission(attempt.missionId)?.title ?? attempt.missionId,
      assistance: help.join(" · ") || "Independent", nextReview };
  });
}

export function getPortfolioModel(state: LearningState) {
  return PORTFOLIO_PROJECT_DEFINITIONS.map(project => {
    const snapshots = state.portfolio.filter(s => s.projectId === project.id);
    return { project, snapshots, complete: snapshots.length === project.components.length };
  });
}

export function getWorkbenchModel(state: LearningState, runId: string, selectedTaskId?: string) {
  const run = state.missionRuns.find(r => r.id === runId && r.status === "active");
  if (!run) return null;
  const mission = getMission(run.missionId);
  if (!mission) return null;
  const stage = mission.stages[run.stageIndex];
  const tasks = run.stages[run.stageIndex].taskIds.flatMap(id => { const task = getTask(id); return task ? [task] : []; });
  const isComplete = (id: string) => {
    const attempt = state.attempts.filter(a => a.runId === runId && a.taskId === id).at(-1);
    if (stage.advanceRule === "attempt-review") return Boolean(attempt);
    if (!attempt?.passed) return false;
    const draft = run.drafts[id];
    return !draft || (draft.response === attempt.response && Object.keys(draft.sourceFiles).length === Object.keys(attempt.sourceFiles).length && Object.entries(draft.sourceFiles).every(([name, source]) => attempt.sourceFiles[name] === source));
  };
  const pendingTask = tasks.find(t => !isComplete(t.id));
  // History may name a task, but it cannot skip uncompleted instruction/practice.
  const selectedIndex = tasks.findIndex(t => t.id === selectedTaskId);
  const pendingIndex = pendingTask ? tasks.indexOf(pendingTask) : tasks.length;
  const task = selectedIndex >= 0 && selectedIndex <= pendingIndex ? tasks[selectedIndex] : pendingTask ?? tasks.at(-1);
  const draft: MissionDraft | undefined = task ? run.drafts[task.id] ?? { sourceFiles: task.variants[0].starterFiles, response: "", assistance: unassisted, updatedAt: run.updatedAt } : undefined;
  return { run, mission, stage, tasks, task, draft, stageComplete: tasks.every(t => isComplete(t.id)),
    taskComplete: task ? isComplete(task.id) : true,
    latestAttempt: task ? state.attempts.filter(a => a.runId === runId && a.taskId === task.id).at(-1) : undefined };
}

export function persistAttempt(state: LearningState, runId: string, taskId: string, input: AttemptSubmission, persist: (state: LearningState) => LearningState, now = new Date()) {
  if (getTask(taskId)?.kind === "code" && !input.result?.executionOk) return { state, saved: false, error: null };
  try { return { state: persist(recordMissionAttempt(state, runId, taskId, input, now)), saved: true, error: null }; }
  catch (error) { return { state, saved: false, error: error instanceof Error ? error.message : String(error) }; }
}

export function getProjectReview(state: LearningState, runId?: string, now = new Date()) {
  const attempts = state.attempts.filter(a => !runId || a.runId === runId);
  const project = attempts.filter(a => a.purpose === "project" && a.executionOk).at(-1);
  const reflection = project ? attempts.filter(a => a.runId === project.runId && a.purpose === "reflection").at(-1) : undefined;
  const skills = project?.skillOutcomes.map(outcome => ({ ...deriveSkillEvidence(state.attempts, outcome.skillId), title: curriculum.skills.find(s => s.id === outcome.skillId)?.title ?? outcome.skillId })) ?? [];
  const remaining = [...new Set([...(project?.checks.filter(c => !c.passed).map(c => c.name) ?? []), ...Object.values(deriveReviewSchedule(state.attempts)).filter(r => r.dueAt <= now.toISOString()).map(r => `Review ${curriculum.skills.find(s => s.id === r.skillId)?.title ?? r.skillId}`)])];
  return { project, reflection, skills, remaining, title: project ? getTask(project.taskId)?.title : undefined,
    assistance: project ? getEvidenceRows(state).find(row => row.attempt.id === project.id)?.assistance : undefined };
}

export type RunStatus = "Ready" | "Loading Python" | "Loading data-science packages…" | "Running checks" | "Passed" | "Needs changes" | "Timed out" | "Couldn't run";
export function runStatus(result: GradeResult | null): RunStatus {
  if (!result) return "Ready";
  if (result.passed) return "Passed";
  if (!result.executionOk) return /timed out/i.test(result.stderr) ? "Timed out" : "Couldn't run";
  return "Needs changes";
}
