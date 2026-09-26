/**
 * Visible skill graph: one qualitative record per curriculum skill, derived
 * from every evidence source. Pure TypeScript — no DOM, no I/O.
 *
 * Evidence sources, in order of authority for *status*:
 *  1. Mission attempts (lib/adaptive.ts deriveSkillEvidence): the full ladder
 *     Not started → Practicing → Demonstrated in project → Demonstrated again
 *     later → Mastered. Refined here into the spec's six labels: Practicing
 *     with no independent success is "needs-practice"; with at least one
 *     independent success it is "working-evidence".
 *  2. Checkpoint-assessment attempts (Task 4): cross-cutting skill ids only
 *     match when they name a curriculum skill, so they are listed as evidence
 *     tasks and counted, but never invent a mapping that does not exist.
 *  3. Diagnostic placement (lib/diagnostic.ts): placement only. It shapes the
 *     readiness text ("why it is or is not ready") and never grants status.
 *  4. The spaced-retrieval schedule (state.reviewSchedule): next review date.
 *
 * Rules enforced here (mirroring the spec):
 * - Untested skills are never called weak. Only attempt evidence of weakness
 *   (needs-practice) marks a skill weak.
 * - One easy question cannot establish mastery: a single independent
 *   retrieval caps at working-evidence (deriveSkillEvidence requires project
 *   + diverse later evidence for the upper rungs).
 * - Repeating one task cannot establish context diversity (deriveSkillEvidence
 *   requires distinct taskId + contextId + date).
 * - No mastery percentages anywhere: the six qualitative labels only.
 */
import { deriveSkillEvidence } from "./adaptive";
import { deriveDiagnosticProfile, latestCompletedDiagnosticSession } from "./diagnostic";
import { curriculum, getTask } from "./curriculum";
import { ASSESSMENTS } from "../curriculum/assessments";
import type { LearningState } from "./state";

export type GraphSkillStatus =
  | "untested"
  | "needs-practice"
  | "working-evidence"
  | "demonstrated-in-project"
  | "demonstrated-again-later"
  | "mastered";

export type PlacementSignal = "strong" | "weak" | "uncertain" | "untested";

export interface SkillEvidenceTask {
  taskId: string;
  title: string;
  kind: "mission" | "retrieval" | "assessment";
  completedAt: string;
  passed: boolean;
  independent: boolean;
}

export interface SkillGraphNode {
  skillId: string;
  name: string;
  prerequisites: { skillId: string; name: string }[];
  status: GraphSkillStatus;
  /** A skill is weak only from attempt evidence of weakness — never from being untested. */
  weak: boolean;
  evidenceCount: number;
  lastDemonstratedAt: string | null;
  nextReviewAt: string | null;
  nextReviewReason: "practice" | "retrieval" | "repair" | null;
  /** Human-readable, traceable to the evidence it cites. */
  readiness: string;
  evidenceTasks: SkillEvidenceTask[];
  /** Diagnostic placement signal. Placement only: never grants status. */
  placement: PlacementSignal;
}

const DAY_LABEL = (iso: string) => iso.slice(0, 10);

function toGraphStatus(skillId: string, state: LearningState): { status: GraphSkillStatus; weak: boolean } {
  const evidence = deriveSkillEvidence(state.attempts, skillId);
  switch (evidence.status) {
    case "Mastered": return { status: "mastered", weak: false };
    case "Demonstrated again later": return { status: "demonstrated-again-later", weak: false };
    case "Demonstrated in project": return { status: "demonstrated-in-project", weak: false };
    case "Practicing":
      return evidence.independentSuccesses > 0
        ? { status: "working-evidence", weak: false }
        : { status: "needs-practice", weak: true };
    default: return { status: "untested", weak: false };
  }
}

function placementSignalFor(state: LearningState, skillId: string): PlacementSignal {
  const session = latestCompletedDiagnosticSession(state.diagnosticSessions);
  if (!session) return "untested";
  const { profile } = deriveDiagnosticProfile(session);
  const skillState = profile[skillId];
  if (skillState === "observed") {
    const evidence = session.responses.filter(r => r.skillId === skillId && !r.legacy);
    const rate = evidence.length ? evidence.filter(r => r.correct).length / evidence.length : 0;
    return rate >= 0.6 ? "strong" : "weak";
  }
  return skillState === "uncertain" ? "uncertain" : "untested";
}

function missionEvidenceTasks(state: LearningState, skillId: string): SkillEvidenceTask[] {
  return state.attempts
    .filter(a => a.skillOutcomes.some(s => s.skillId === skillId) || a.introducedSkillIds.includes(skillId))
    .map(a => ({
      taskId: a.taskId,
      title: getTask(a.taskId)?.title ?? a.taskId,
      kind: (a.purpose === "retrieval" ? "retrieval" : "mission") as "mission" | "retrieval",
      completedAt: a.completedAt,
      passed: a.passed,
      independent: !a.assistance.hintsUsed && !a.assistance.aiAssisted && !a.assistance.solutionViewed,
    }));
}

function assessmentEvidenceTasks(state: LearningState, skillId: string): SkillEvidenceTask[] {
  return state.assessmentAttempts
    .filter(a => a.skillId === skillId)
    .map(a => {
      const task = ASSESSMENTS.flatMap(x => x.tasks).find(t => t.id === a.taskId);
      return {
        taskId: a.taskId,
        title: task?.title ?? a.taskId,
        kind: "assessment" as const,
        completedAt: a.completedAt,
        passed: a.passed,
        independent: a.independent,
      };
    });
}

function readinessText(node: Omit<SkillGraphNode, "readiness">, weakSkillIds: Set<string>): string {
  const weakPrereqs = node.prerequisites.filter(p => weakSkillIds.has(p.skillId));
  const prereqClause = weakPrereqs.length
    ? ` Not ready: prerequisite ${weakPrereqs.map(p => `${p.name} (${p.skillId})`).join(", ")} needs practice.`
    : "";
  const placementClause = node.placement === "weak"
    ? " Placement suggests this needs practice — start with the earliest mission covering it."
    : node.placement === "uncertain"
      ? " Placement was uncertain for this skill — early mission attempts will settle it."
      : node.placement === "strong"
        ? " Placement showed solid ground; a mission attempt will confirm it."
        : "";
  const dateOf = (iso: string | null) => (iso ? DAY_LABEL(iso) : "unknown date");
  switch (node.status) {
    case "untested":
      return `No attempts recorded yet.${placementClause || " Take the placement diagnostic or start the first mission to generate evidence."}${prereqClause}`;
    case "needs-practice": {
      const latest = node.evidenceTasks.at(-1);
      const detail = latest
        ? ` Latest: ${latest.title} on ${dateOf(latest.completedAt)} — ${latest.passed ? "passed with help" : "needs changes"}${latest.independent ? "" : " (assistance used)"}.`
        : "";
      return `Needs practice: ${node.evidenceCount} attempt${node.evidenceCount === 1 ? "" : "s"}, no independent success yet.${detail} Independent project evidence is needed.${prereqClause}`;
    }
    case "working-evidence": {
      const latest = node.evidenceTasks.filter(t => t.independent && t.passed).at(-1);
      return `Working evidence: at least one independent success${latest ? ` — latest ${latest.title} on ${dateOf(latest.completedAt)}` : ""}. A project demonstration will move this to Demonstrated in project.${prereqClause}`;
    }
    case "demonstrated-in-project": {
      const witness = node.evidenceTasks.find(t => t.completedAt === node.lastDemonstratedAt) ?? node.evidenceTasks.at(-1);
      return `Demonstrated in project on ${dateOf(node.lastDemonstratedAt)}${witness ? ` (${witness.title})` : ""}. Later retrieval in a new context builds toward mastery.${node.nextReviewAt ? ` Next retrieval ${dateOf(node.nextReviewAt)}.` : ""}${prereqClause}`;
    }
    case "demonstrated-again-later": {
      const latest = node.evidenceTasks.at(-1);
      return `Demonstrated again${latest ? ` on ${dateOf(latest.completedAt)} in a new context (${latest.title})` : ""}. Delayed retrieval will establish mastery.${node.nextReviewAt ? ` Next retrieval ${dateOf(node.nextReviewAt)}.` : ""}${prereqClause}`;
    }
    case "mastered":
      return `Mastered: independent project evidence plus delayed retrieval across distinct contexts (last demonstration ${dateOf(node.lastDemonstratedAt)}).${prereqClause}`;
  }
}

export function buildSkillGraph(state: LearningState): SkillGraphNode[] {
  const skillNameById = new Map(curriculum.skills.map(s => [s.id, s.title]));

  const preliminary = curriculum.skills.map(skill => ({ skill, ...toGraphStatus(skill.id, state) }));
  const weakSkillIds = new Set(preliminary.filter(p => p.weak).map(p => p.skill.id));

  return preliminary.map(({ skill, status, weak }) => {
    const placement = placementSignalFor(state, skill.id);
    const evidenceTasks = [...missionEvidenceTasks(state, skill.id), ...assessmentEvidenceTasks(state, skill.id)]
      .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
    const evidence = deriveSkillEvidence(state.attempts, skill.id);
    const review = state.reviewSchedule[skill.id];
    const node: Omit<SkillGraphNode, "readiness"> = {
      skillId: skill.id,
      name: skill.title,
      prerequisites: skill.prerequisites.map(id => ({ skillId: id, name: skillNameById.get(id) ?? id })),
      status,
      weak,
      evidenceCount: evidence.attemptCount + state.assessmentAttempts.filter(a => a.skillId === skill.id).length,
      lastDemonstratedAt: evidence.lastDemonstratedAt,
      nextReviewAt: review?.dueAt ?? null,
      nextReviewReason: review?.reason ?? null,
      evidenceTasks,
      placement,
    };
    return { ...node, readiness: readinessText(node, weakSkillIds) };
  });
}
