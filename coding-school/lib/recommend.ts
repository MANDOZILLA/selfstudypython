/**
 * Adaptive recommendation engine: one ordered rule chain that turns learner
 * state into a single next action plus a human-readable, evidence-traceable
 * reason. Pure TypeScript — no DOM, no I/O, no state mutation.
 *
 * Rule priority (spec lines 444-486):
 *  1. Active unfinished mission always resumes first.
 *  2. A fresh learner gets the placement baseline: diagnostic first, then the
 *     first curriculum mission with the placement cited in the reason.
 *  3. Diagnostic placement evidence shapes the reason but never grants
 *     status and never blocks (placement is not attempt evidence).
 *  4. Prerequisite readiness: a weak prerequisite of a skill the next mission
 *     *introduces* (revisiting does not reteach) blocks that mission — the
 *     action is repair, with the blocked mission named.
 *  5. Recent failed criteria / targeted repair: due repair entries from the
 *     spaced-retrieval schedule become the repair action.
 *  6. Due retrieval: scheduled reviews ride along with the next mission,
 *     capped so they never consume it.
 *  7. Evidence confidence: uncertain placement is settled by mission attempts;
 *     the reason says so instead of guessing.
 *  8. Time since demonstration: retrieval reasons cite the last demonstration
 *     date and how long ago it was.
 *  9. Curriculum order: the next mission is the first unlocked one.
 *  10. Review-time cap and current track: REVIEW_TASK_CAP is a hard cap, and
 *      the reason names the learner's current track (the checkpoint group of
 *      the first incomplete mission).
 *
 * Checkpoint assessments are recommended after repair/retrieval and before a
 * plain mission start: retrieval and repair are time-sensitive (due now),
 * while a checkpoint does not expire. The assessment fires once per
 * checkpoint — the first checkpoint, in track order, whose mission group is
 * complete and which has no recorded attempts.
 *
 * The returned reviewTaskIds are exactly what the "start" call should seat
 * into stage 0; the caller passes them through so the reason and the run
 * cannot disagree.
 */
import { ASSESSMENTS } from "../curriculum/assessments";
import { deriveReviewSchedule, selectToday } from "./adaptive";
import { curriculum, getMission, getTask } from "./curriculum";
import { deriveDiagnosticProfile, latestCompletedDiagnosticSession } from "./diagnostic";
import { buildSkillGraph } from "./skill-graph";
import { clone, refresh, type LearningState } from "./state";

/** Hard cap: seated reviews may never take more than this many stage-0 slots,
 *  so a review backlog cannot consume the whole next mission. */
export const REVIEW_TASK_CAP = 2;

export type RecommendationAction =
  | "resume"
  | "diagnostic"
  | "start-mission"
  | "repair"
  | "retrieval"
  | "assessment"
  | "complete";

export interface Recommendation {
  action: RecommendationAction;
  missionId: string | null;
  runId: string | null;
  /** Exact task list the start call should seat into stage 0. */
  reviewTaskIds: string[];
  assessmentId: string | null;
  /** Set only when a weak prerequisite blocks the next mission. */
  blockedMissionId: string | null;
  /** Human-readable, traceable to the evidence it cites. Never a percentage. */
  reason: string;
}

/**
 * Checkpoint → mission groups, read off the checkpoint descriptions in
 * curriculum/assessments.ts (foundations = python recovery + validation
 * functions; data = record transforms, CSV, JSON, pandas, SQLite; applied =
 * money, HTTP, LLM guardrails).
 */
const CHECKPOINT_GROUPS: { assessmentId: string; track: string; missionIds: string[] }[] = [
  { assessmentId: "foundations-checkpoint", track: "foundations", missionIds: ["python-recovery", "validation-functions"] },
  { assessmentId: "data-checkpoint", track: "data", missionIds: ["transform-records", "csv-foundations", "json-api-normalization", "pandas-missing-data", "sqlite-transactions"] },
  { assessmentId: "applied-checkpoint", track: "applied", missionIds: ["money-reconciliation", "http-resilience", "llm-guardrails"] },
];

const DAY = 86_400_000;
const dayLabel = (iso: string) => iso.slice(0, 10);
const daysAgo = (iso: string, now: Date) => Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / DAY));
const skillName = (id: string) => curriculum.skills.find(s => s.id === id)?.title ?? id;
const taskTitle = (id: string) => getTask(id)?.title ?? id;

function isFresh(state: LearningState): boolean {
  return state.attempts.length === 0 && state.missionRuns.length === 0 && state.assessmentAttempts.length === 0;
}

/** Placement summary for a fresh learner: strong/weak skill names + date. Null when no completed diagnostic exists. */
function placementSummary(state: LearningState): { date: string; text: string } | null {
  const session = latestCompletedDiagnosticSession(state.diagnosticSessions);
  if (!session?.completedAt) return null;
  const { profile } = deriveDiagnosticProfile(session);
  const strong: string[] = [];
  const weak: string[] = [];
  for (const [skillId, signal] of Object.entries(profile)) {
    if (signal !== "observed") continue;
    const evidence = session.responses.filter(r => r.skillId === skillId && !r.legacy);
    const rate = evidence.length ? evidence.filter(r => r.correct).length / evidence.length : 0;
    (rate >= 0.6 ? strong : weak).push(skillName(skillId));
  }
  const parts: string[] = [];
  if (strong.length) parts.push(`solid ground in ${strong.join(", ")}`);
  if (weak.length) parts.push(`needs work on ${weak.join(", ")}`);
  return { date: dayLabel(session.completedAt), text: parts.join("; ") || "no decisive skill evidence yet" };
}

function trackOfMission(missionId: string): string {
  return CHECKPOINT_GROUPS.find(g => g.missionIds.includes(missionId))?.track ?? "data";
}

/** Review tasks covering the given skills, least-recently-attempted first. */
function repairTasksFor(state: LearningState, skillIds: string[]): string[] {
  const attemptedAt = new Map<string, string>();
  for (const a of state.attempts) attemptedAt.set(a.taskId, a.completedAt);
  return curriculum.reviewTasks
    .filter(t => t.skillIds.some(s => skillIds.includes(s)))
    .sort((a, b) => (attemptedAt.get(a.id) ?? "").localeCompare(attemptedAt.get(b.id) ?? ""))
    .map(t => t.id);
}

function capReviews(ids: string[]): string[] {
  return [...new Set(ids)].slice(0, REVIEW_TASK_CAP);
}

/** Latest failed attempt covering a skill, for evidence-traceable reasons. */
function latestFailedEvidence(state: LearningState, skillId: string): { title: string; date: string } | null {
  const failed = state.attempts.filter(a =>
    !a.passed && a.executionOk &&
    (a.skillOutcomes.some(s => s.skillId === skillId && !s.passed) || a.introducedSkillIds.includes(skillId)));
  const latest = failed.sort((a, b) => a.completedAt.localeCompare(b.completedAt)).at(-1);
  return latest ? { title: taskTitle(latest.taskId), date: dayLabel(latest.completedAt) } : null;
}

export function recommendNext(state: LearningState, now: Date = new Date()): Recommendation {
  // Work on a refreshed clone so the schedule is current; the input is never mutated.
  const fresh = refresh(clone(state));
  const selection = selectToday(fresh, now);
  const schedule = deriveReviewSchedule(fresh.attempts);

  const base = {
    missionId: null as string | null, runId: null as string | null,
    reviewTaskIds: [] as string[], assessmentId: null as string | null,
    blockedMissionId: null as string | null,
  };

  // 1. An active unfinished mission always resumes first.
  if (selection.kind === "resume" && selection.missionId) {
    const mission = getMission(selection.missionId);
    return {
      ...base, action: "resume", missionId: selection.missionId, runId: selection.runId ?? null,
      reason: `Resume "${mission?.title ?? selection.missionId}" — the unfinished ${fresh.missionRuns.find(r => r.id === selection.runId)?.status ?? "active"} run comes before anything new.`,
    };
  }

  // 2. Fresh learner: placement baseline first.
  if (isFresh(fresh)) {
    const summary = placementSummary(fresh);
    if (!summary) {
      return {
        ...base, action: "diagnostic",
        reason: "No attempts recorded yet. Take the placement diagnostic first — it sets your placement baseline across the skill graph so the first mission starts at the right level.",
      };
    }
    const mission = selection.missionId ? getMission(selection.missionId) : null;
    const reviewTaskIds = capReviews(selection.reviewTaskIds);
    const seated = reviewTaskIds.length
      ? ` ${reviewTaskIds.length} scheduled review ${reviewTaskIds.length === 1 ? "task is" : "tasks are"} seated first in stage 0.`
      : "";
    return {
      ...base, action: "start-mission", missionId: selection.missionId, reviewTaskIds,
      reason: `Placement baseline from your ${summary.date} diagnostic: ${summary.text}. ` +
        (mission
          ? `Starting with "${mission.title}" — first in curriculum order${mission.introducedSkillIds.length ? `, teaching ${mission.introducedSkillIds.map(skillName).join(", ")}` : ""}.${seated}`
          : "No unlocked mission is available yet."),
    };
  }

  const graph = buildSkillGraph(fresh);
  const weakById = new Map(graph.map(n => [n.skillId, n.weak]));
  const nodeById = new Map(graph.map(n => [n.skillId, n]));

  // 4. Weak prerequisite blocks the next mission when the mission introduces
  //    (not merely revisits) a skill whose prerequisite is weak.
  if (selection.missionId) {
    const mission = getMission(selection.missionId);
    if (mission) {
      const introduced = new Set(mission.introducedSkillIds);
      const prereqIds = new Set(
        mission.introducedSkillIds.flatMap(id => curriculum.skills.find(s => s.id === id)?.prerequisites ?? []),
      );
      const blockers = [...prereqIds].filter(id => weakById.get(id) && !introduced.has(id));
      if (blockers.length) {
        const cites = blockers.map(id => {
          const evidence = latestFailedEvidence(fresh, id);
          return `${skillName(id)} (${id})${evidence ? ` — failed "${evidence.title}" on ${evidence.date}` : ""}`;
        });
        const reviewTaskIds = capReviews([...repairTasksFor(fresh, blockers), ...selection.reviewTaskIds]);
        return {
          ...base, action: "repair", missionId: selection.missionId,
          blockedMissionId: selection.missionId, reviewTaskIds,
          reason: `"${mission.title}" is blocked: prerequisite ${cites.join("; ")} needs practice first. ` +
            `The repair ${reviewTaskIds.length === 1 ? "task is" : "tasks are"} seated first in stage 0 — the mission's build stage stays out of reach until ${blockers.length === 1 ? "it is" : "they are"} done.`,
        };
      }
    }
  }

  // 5. Recent failed criteria / targeted repair: due repair entries first.
  const dueRepairSkills = Object.values(schedule)
    .filter(e => e.reason === "repair" && e.dueAt <= now.toISOString())
    .map(e => e.skillId);
  if (dueRepairSkills.length) {
    const cites = dueRepairSkills.map(id => {
      const evidence = latestFailedEvidence(fresh, id);
      return `${skillName(id)} (${id})${evidence ? ` — failed "${evidence.title}" on ${evidence.date}` : ""}`;
    });
    const reviewTaskIds = capReviews([...repairTasksFor(fresh, dueRepairSkills), ...selection.reviewTaskIds]);
    const mission = selection.missionId ? getMission(selection.missionId) : null;
    return {
      ...base, action: "repair", missionId: selection.missionId, reviewTaskIds,
      reason: `Targeted repair before new material: ${cites.join("; ")}. ` +
        (mission
          ? `The repair ${reviewTaskIds.length === 1 ? "task is" : "tasks are"} seated first in "${mission.title}" (stage 0).`
          : "No unlocked mission — running the repair as a review session."),
    };
  }

  // 6. Due retrieval, capped so the backlog never consumes the mission.
  if (selection.reviewTaskIds.length) {
    const dueEntries = Object.values(schedule).filter(e => e.dueAt <= now.toISOString());
    const dueCount = dueEntries.length;
    const cites = selection.reviewTaskIds.map(id => {
      const task = getTask(id);
      const skillId = task?.skillIds.find(s => dueEntries.some(e => e.skillId === s));
      const node = skillId ? nodeById.get(skillId) : undefined;
      const last = node?.lastDemonstratedAt;
      return `"${task?.title ?? id}"${skillId ? ` for ${skillName(skillId)} (${skillId})` : ""}${last ? ` — last demonstrated ${dayLabel(last)} (${daysAgo(last, now)} days ago)` : ""}`;
    });
    const mission = selection.missionId ? getMission(selection.missionId) : null;
    return {
      ...base, action: "retrieval", missionId: selection.missionId,
      reviewTaskIds: capReviews(selection.reviewTaskIds),
      reason: `Retrieval due: ${cites.join("; ")}. ` +
        (dueCount > REVIEW_TASK_CAP ? `${dueCount} reviews are due; capped at ${REVIEW_TASK_CAP} so the backlog never consumes the mission. ` : "") +
        (mission ? `Seated first in "${mission.title}" (stage 0).` : "Running as a review session."),
    };
  }

  // Checkpoint assessment: first checkpoint in track order whose mission group
  // is complete and which has no recorded attempts. Only mission-mode runs
  // count: a completed review run must not mark a mission complete.
  const completedMissions = new Set(fresh.missionRuns.filter(r => r.mode === "mission" && r.status === "completed").map(r => r.missionId));
  const attemptedAssessments = new Set(fresh.assessmentAttempts.map(a => a.assessmentId));
  const dueCheckpoint = CHECKPOINT_GROUPS.find(g =>
    g.missionIds.every(id => completedMissions.has(id)) && !attemptedAssessments.has(g.assessmentId));
  if (dueCheckpoint) {
    const assessment = ASSESSMENTS.find(a => a.id === dueCheckpoint.assessmentId);
    return {
      ...base, action: "assessment", assessmentId: dueCheckpoint.assessmentId,
      reason: `You completed the ${dueCheckpoint.track} missions (${dueCheckpoint.missionIds.join(", ")}). ` +
        `Take the ${assessment?.title ?? dueCheckpoint.assessmentId} next — code reading, debugging, scratch coding, a small project, and a written explanation — to consolidate the group before the next track.`,
    };
  }

  // 9/10. Curriculum order, naming the current track.
  if (selection.kind === "mission" && selection.missionId) {
    const mission = getMission(selection.missionId)!;
    const track = trackOfMission(selection.missionId);
    const reviews = selection.reviewTaskIds.length
      ? ` ${selection.reviewTaskIds.length} review ${selection.reviewTaskIds.length === 1 ? "task" : "tasks"} seated first in stage 0.`
      : "";
    return {
      ...base, action: "start-mission", missionId: selection.missionId,
      reviewTaskIds: capReviews(selection.reviewTaskIds),
      reason: `Next in the ${track} track by curriculum order: "${mission.title}" — ${mission.summary}${reviews}`,
    };
  }

  return { ...base, action: "complete", reason: "Every mission is complete and no reviews are due. The skill graph in What I Learned shows where each skill stands." };
}
