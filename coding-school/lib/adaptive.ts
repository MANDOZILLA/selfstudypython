import type { AttemptRecord, LearningState } from "./state";
import { curriculum } from "./curriculum";
import { deriveDiagnosticProfile, latestCompletedDiagnosticSession } from "./diagnostic";

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
  const eligible = (a: AttemptRecord) => a.passed && a.executionOk && independent(a) &&
    (a.purpose === "project" || a.purpose === "retrieval") && a.skillOutcomes.some(s => s.skillId === skillId && s.passed);
  const successes = relevant.filter(eligible);
  // Identical later work cannot add a context, but its actual later date can establish
  // delayed retrieval. Retain these occurrences when choosing the qualifying subset.
  const candidates = ordered(attempts).filter(eligible);
  const distinct = (a: AttemptRecord, b: AttemptRecord) => a.taskId !== b.taskId && a.contextId !== b.contextId && a.completedAt.slice(0, 10) !== b.completedAt.slice(0, 10);
  let diversity: AttemptRecord[] = [];
  let mastered = false;
  // Only three witnesses are required. Search for a valid subset instead of greedily
  // reserving the first date/context; adding evidence cannot invalidate an old subset.
  projectSearch: for (const project of candidates.filter(a => a.purpose === "project")) {
    if (!diversity.length) diversity = [project];
    const later = candidates.filter(a => a.completedAt > project.completedAt && distinct(a, project));
    for (const first of later) {
      if (diversity.length < 2) diversity = [project, first];
      for (const second of later) {
        if (!distinct(first, second)) continue;
        const delayed = [first, second].some(a => a.purpose === "retrieval" && Date.parse(a.completedAt) - Date.parse(project.completedAt) >= 3 * DAY);
        if (delayed) { diversity = [project, first, second]; mastered = true; break projectSearch; }
      }
    }
  }
  const status: EvidenceStatus = mastered ? "Mastered" :
    diversity.length >= 2 ? "Demonstrated again later" : diversity.length ? "Demonstrated in project" : relevant.length ? "Practicing" : "Not started";
  return { skillId, status, independentSuccesses: successes.length, distinctContexts: diversity.length,
    attemptCount: relevant.length, lastDemonstratedAt: successes.at(-1)?.completedAt ?? null,
    taughtAt, evidenceAttemptIds: diversity.map(a => a.id) };
}

/** Exposure schedules the first review; only independent retrieval advances its interval. */
export function deriveReviewSchedule(attempts: AttemptRecord[]): Record<string, ReviewSchedule> {
  const schedules: Record<string, ReviewSchedule> = {};
  const steps: Record<string, number> = {};
  const intervals = [1, 3, 7, 14] as const;
  const processed = new Set<string>();
  const creditedRuns = new Set<string>();
  for (const a of ordered(attempts)) {
    // Review events belong to their run, unlike globally deduplicated mastery credit.
    const eventKey = JSON.stringify([a.runId, a.taskId, a.graderId, a.graderVersion, a.sourceHash, a.resultHash]);
    if (processed.has(eventKey)) continue;
    processed.add(eventKey);
    if (a.purpose === "reflection" || !a.executionOk) continue;
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
        const runSkill = JSON.stringify([a.runId, skillId]);
        if (creditedRuns.has(runSkill)) continue;
        // Early reruns do not lengthen the schedule.
        if (schedules[skillId] && a.completedAt < schedules[skillId].dueAt) continue;
        creditedRuns.add(runSkill);
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
  if (active) return { kind: "resume", missionId: active.missionId, runId: active.id, reviewTaskIds: active.stages[0].taskIds.filter(id => curriculum.reviewTasks.some(t => t.id === id)) };
  const completed = new Set(state.missionRuns.filter(r => r.status === "completed" && r.mode === "mission").map(r => r.missionId));
  const mission = curriculum.missions.find(m => !completed.has(m.id) && m.prerequisites.every(id => completed.has(id)));
  const relevant = new Set(mission ? [...mission.revisitedSkillIds, ...mission.introducedSkillIds] : curriculum.skills.map(s => s.id));
  const due = Object.values(deriveReviewSchedule(state.attempts)).filter(s => relevant.has(s.skillId) && s.dueAt <= now.toISOString())
    .sort((a, b) => Number(b.reason === "repair") - Number(a.reason === "repair") || a.dueAt.localeCompare(b.dueAt) || a.skillId.localeCompare(b.skillId));
  // Placement evidence: skills the diagnostic left uncertain get review
  // priority even before any mission attempt exists for them.
  const latestDiagnostic = latestCompletedDiagnosticSession(state.diagnosticSessions);
  const probedSkills = new Set((latestDiagnostic?.responses ?? []).filter(r => !r.legacy).map(r => r.skillId));
  for (const skillId of placementReviewSkills(state)) {
    if (relevant.has(skillId) && !due.some(s => s.skillId === skillId)) {
      due.push({ skillId, dueAt: now.toISOString(), reason: "practice", intervalDays: 1 });
    }
  }
  const reviewTaskIds: string[] = [];
  for (const review of due) {
    if (reviewTaskIds.some(id => curriculum.reviewTasks.find(t => t.id === id)?.skillIds.includes(review.skillId))) continue;
    const options = curriculum.reviewTasks.filter(t => t.skillIds.includes(review.skillId) &&
      t.skillIds.every(id => deriveSkillEvidence(state.attempts, id).status !== "Not started" || probedSkills.has(id)));
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

/**
 * Skill IDs the latest completed diagnostic left uncertain. This is placement
 * evidence only: it can prioritize review, never fabricate mastery or unlocks.
 */
export function placementReviewSkills(state: LearningState): string[] {
  const session = latestCompletedDiagnosticSession(state.diagnosticSessions);
  if (!session) return [];
  const { profile } = deriveDiagnosticProfile(session);
  return Object.entries(profile)
    .filter(([, skillState]) => skillState === "uncertain")
    .map(([skillId]) => skillId);
}
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
