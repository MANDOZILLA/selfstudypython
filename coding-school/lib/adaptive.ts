import type { AttemptRecord, LearningState } from "./state";
import { curriculum } from "./curriculum";

export type EvidenceStatus = "Not started" | "Practicing" | "Demonstrated in project" | "Demonstrated again later" | "Mastered";
export type SkillEvidence = {
  skillId: string; status: EvidenceStatus; independentSuccesses: number; distinctContexts: number;
  attemptCount: number; lastDemonstratedAt: string | null; taughtAt: string | null; evidenceAttemptIds: string[];
};
export type MasteryRecord = SkillEvidence;
export type ReviewSchedule = { skillId: string; dueAt: string; reason: "practice" | "retrieval" | "repair"; intervalDays: 1 | 3 | 7 | 14 };
const DAY = 86400000;
const independent = (a: AttemptRecord) => !a.assistance.hintsUsed && !a.assistance.aiAssisted && !a.assistance.solutionViewed;
const ordered = (attempts: AttemptRecord[]) => [...attempts].sort((a, b) => a.completedAt.localeCompare(b.completedAt));
const unique = (attempts: AttemptRecord[]) => {
  const seen = new Set<string>();
  return ordered(attempts).filter(a => {
    const key = JSON.stringify([a.taskId, a.graderId, a.graderVersion, a.sourceHash, a.resultHash]);
    if (a.duplicateOf || seen.has(key)) return false;
    seen.add(key); return true;
  });
};

/** Derive claims from accepted evidence. No stored numeric mastery score is trusted. */
export function deriveSkillEvidence(attempts: AttemptRecord[], skillId: string): SkillEvidence {
  const relevant = unique(attempts).filter(a => a.skillOutcomes.some(s => s.skillId === skillId) || a.introducedSkillIds.includes(skillId));
  const taughtAt = relevant.find(a => a.purpose === "instruction" && a.passed && a.introducedSkillIds.includes(skillId))?.completedAt ?? null;
  const successes = relevant.filter(a => a.passed && a.executionOk && independent(a) &&
    (a.purpose === "project" || a.purpose === "retrieval") && a.skillOutcomes.some(s => s.skillId === skillId && s.passed));
  const project = successes.find(a => a.purpose === "project");
  // Each qualifying step must add a task, a real context, and a different UTC date.
  const diversity: AttemptRecord[] = [];
  if (project) {
    diversity.push(project);
    for (const attempt of successes) {
      if (attempt.completedAt <= project.completedAt ||
        diversity.some(a => a.taskId === attempt.taskId || a.contextId === attempt.contextId || a.completedAt.slice(0, 10) === attempt.completedAt.slice(0, 10))) continue;
      diversity.push(attempt);
    }
  }
  const delayed = diversity.some(a => a.purpose === "retrieval" && Date.parse(a.completedAt) - Date.parse(project!.completedAt) >= 3 * DAY);
  const status: EvidenceStatus = diversity.length >= 3 && delayed ? "Mastered" :
    diversity.length >= 2 ? "Demonstrated again later" : project ? "Demonstrated in project" : relevant.length ? "Practicing" : "Not started";
  return { skillId, status, independentSuccesses: successes.length, distinctContexts: diversity.length,
    attemptCount: relevant.length, lastDemonstratedAt: successes.at(-1)?.completedAt ?? null,
    taughtAt, evidenceAttemptIds: diversity.map(a => a.id) };
}

/** Exposure schedules the first review; only independent retrieval advances its interval. */
export function deriveReviewSchedule(attempts: AttemptRecord[]): Record<string, ReviewSchedule> {
  const schedules: Record<string, ReviewSchedule> = {};
  const steps: Record<string, number> = {};
  const intervals = [1, 3, 7, 14] as const;
  for (const a of unique(attempts)) {
    if (a.purpose === "reflection") continue;
    const skills = new Set([...a.introducedSkillIds, ...a.skillOutcomes.map(s => s.skillId)]);
    for (const skillId of skills) {
      const exposed = a.purpose === "instruction" && a.passed && a.introducedSkillIds.includes(skillId);
      const success = a.passed && a.executionOk && a.skillOutcomes.some(s => s.skillId === skillId && s.passed);
      const demonstrated = success && independent(a) && (a.purpose === "project" || a.purpose === "retrieval");
      if (!schedules[skillId] && !exposed && !demonstrated) continue;
      let reason: ReviewSchedule["reason"] = "practice";
      if (a.purpose === "instruction") {
        if (schedules[skillId]) continue;
        steps[skillId] = 0;
      } else if (!success) {
        steps[skillId] = 0; reason = "repair";
      } else if (a.purpose === "retrieval" && independent(a)) {
        // Early reruns do not lengthen the schedule.
        if (schedules[skillId] && a.completedAt < schedules[skillId].dueAt) continue;
        steps[skillId] = Math.min(3, (steps[skillId] ?? 0) + 1); reason = "retrieval";
      } else if (!demonstrated) {
        continue;
      }
      const intervalDays = intervals[steps[skillId] ?? 0];
      schedules[skillId] = { skillId, intervalDays, reason, dueAt: new Date(Date.parse(a.completedAt) + intervalDays * DAY).toISOString() };
    }
  }
  return schedules;
}

export type TodaySelection = { kind: "resume" | "mission" | "review" | "complete"; missionId: string | null; runId?: string; reviewTaskIds: string[] };
export function selectToday(state: LearningState, now: Date): TodaySelection {
  const active = state.missionRuns.find(r => r.status !== "completed");
  if (active) return { kind: "resume", missionId: active.missionId, runId: active.id, reviewTaskIds: active.stages[0].taskIds };
  const completed = new Set(state.missionRuns.filter(r => r.status === "completed" && r.mode === "mission").map(r => r.missionId));
  const mission = curriculum.missions.find(m => !completed.has(m.id) && m.prerequisites.every(id => completed.has(id)));
  const relevant = new Set(mission ? [...mission.revisitedSkillIds, ...mission.introducedSkillIds] : curriculum.skills.map(s => s.id));
  const due = Object.values(deriveReviewSchedule(state.attempts)).filter(s => relevant.has(s.skillId) && s.dueAt <= now.toISOString())
    .sort((a, b) => Number(b.reason === "repair") - Number(a.reason === "repair") || a.dueAt.localeCompare(b.dueAt) || a.skillId.localeCompare(b.skillId));
  const reviewTaskIds: string[] = [];
  for (const review of due) {
    if (reviewTaskIds.some(id => curriculum.reviewTasks.find(t => t.id === id)?.skillIds.includes(review.skillId))) continue;
    const options = curriculum.reviewTasks.filter(t => t.skillIds.includes(review.skillId) &&
      t.skillIds.every(id => deriveSkillEvidence(state.attempts, id).status !== "Not started"));
    // Prefer the least recently attempted context, stable authored order breaks ties.
    options.sort((a, b) => {
      const last = (id: string) => state.attempts.filter(x => x.taskId === id).at(-1)?.completedAt ?? "";
      return last(a.id).localeCompare(last(b.id));
    });
    const task = options.find(t => !reviewTaskIds.includes(t.id));
    if (task) reviewTaskIds.push(task.id);
    if (reviewTaskIds.length === 2) break;
  }
  return { kind: mission ? "mission" : reviewTaskIds.length ? "review" : "complete", missionId: mission?.id ?? null, reviewTaskIds };
}

export type DiagnosticPrompt = { id: string; skillId: string; difficulty: number; kind: "concept" | "coding" };
export type DiagnosticResponse = { promptId: string; skillId: string; correct: boolean };

export function chooseDiagnosticPrompt(
  prompts: DiagnosticPrompt[],
  responses: DiagnosticResponse[],
): DiagnosticPrompt | undefined {
  const answered = new Set(responses.map((response) => response.promptId));
  const unanswered = prompts.filter((prompt) => !answered.has(prompt.id));
  if (!unanswered.length) return undefined;

  const skillOrder = [...new Set(prompts.map((prompt) => prompt.skillId))];
  for (const skillId of skillOrder) {
    const evidence = responses.filter((response) => response.skillId === skillId);
    if (!evidence.length) return unanswered.find((prompt) => prompt.skillId === skillId);
    const hasConcept = evidence.some((response) => prompts.find((prompt) => prompt.id === response.promptId)?.kind === "concept");
    const hasCoding = evidence.some((response) => prompts.find((prompt) => prompt.id === response.promptId)?.kind === "coding");
    const allCorrect = evidence.every((response) => response.correct);
    if (!(evidence.length >= 2 && hasConcept && hasCoding && allCorrect)) {
      const nextForSkill = unanswered.find((prompt) => prompt.skillId === skillId);
      if (nextForSkill) return nextForSkill;
    }
  }

  return unanswered[0];
}
