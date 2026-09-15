/**
 * Checkpoint-assessment evidence: completion/mastery separation, assistance
 * weakening, focused repair scheduling, and monotonic cross-context skill
 * status. Pure TypeScript — no DOM, no I/O. The state layer persists the
 * derived records; this module owns the derivation rules.
 *
 * Model: an assessment (checkpoint) has five tasks (read/debug/scratch/
 * project/explain). Each task attempt records pass/fail plus assistance.
 * Skills (code-reading, debugging, ...) are cross-cutting: the debugging
 * skill is evidenced by the debug task in each checkpoint.
 *
 * Rules (from the product spec):
 * - Completion and mastery are separate. A task attempt is complete when it
 *   has a result; it is mastered only when it passed independently (no
 *   hints, no AI, no revealed solution).
 * - Four or more hints weakens a full rubric level: the attempt is practice,
 *   never independent. (Any hints already break independence; the four-hint
 *   mark is recorded explicitly.)
 * - AI-assisted or solution-revealed success is practice, not mastery.
 * - Failed tasks schedule focused repair reviews.
 * - Retained/mastered requires later independent work in another
 *   context/date. The identical task cannot add diversity.
 * - Status is monotonic: derived from the full history, so later poor
 *   results never regress a skill.
 */

export interface AssessmentTaskInput {
  passed: boolean;
  hintsUsed: number;
  aiAssisted: boolean;
  solutionViewed: boolean;
}

export interface AssessmentTaskAttempt {
  attemptId: string;
  taskId: string;
  assessmentId: string;
  skillId: string;
  result: AssessmentTaskInput;
  completedAt: string; // ISO timestamp
}

export interface AssessmentTaskRecord extends AssessmentTaskInput {
  attemptId: string;
  taskId: string;
  assessmentId: string;
  skillId: string;
  completedAt: string;
  /** YYYY-MM-DD of completion, for diversity comparisons. */
  date: string;
  /** Independent only with zero hints, no AI, and no revealed solution. */
  independent: boolean;
  /** Four or more hints weakens a full rubric level: practice, not mastery. */
  weakenedByHints: boolean;
  /** Passed independently. */
  mastered: boolean;
}

export type SkillStatusLabel = "not-started" | "completed" | "mastered";

export interface SkillStatus {
  skillId: string;
  status: SkillStatusLabel;
  completedTasks: number;
  independentTasks: number;
}

export interface FocusedReview {
  taskId: string;
  skillId: string;
  assessmentId: string;
  reason: "repair";
  /** YYYY-MM-DD the repair review is due (the day after the attempt). */
  scheduledFor: string;
}

/**
 * Derive a task's evidence record from one attempt. Pure: the same attempt
 * always yields the same record (idempotent by attemptId at the state layer).
 */
export function deriveTaskRecord(attempt: AssessmentTaskAttempt): AssessmentTaskRecord {
  const { result } = attempt;
  const independent = result.hintsUsed === 0 && !result.aiAssisted && !result.solutionViewed;
  return {
    ...result,
    attemptId: attempt.attemptId,
    taskId: attempt.taskId,
    assessmentId: attempt.assessmentId,
    skillId: attempt.skillId,
    completedAt: attempt.completedAt,
    date: attempt.completedAt.slice(0, 10),
    independent,
    weakenedByHints: result.hintsUsed >= 4,
    mastered: result.passed && independent,
  };
}

/**
 * Derive a skill's status from its full task history. Monotonic by
 * construction: records are only appended, and mastery requires two
 * mastered tasks that differ in task and in context or date.
 */
export function deriveSkillStatus(skillId: string, records: AssessmentTaskRecord[]): SkillStatus {
  const completed = records.length;
  const mastered = records.filter(r => r.mastered);
  let status: SkillStatusLabel = "not-started";
  if (completed > 0) status = "completed";
  const diverse = mastered.some((a, i) =>
    mastered.slice(i + 1).some(
      b =>
        a.taskId !== b.taskId &&
        (a.date !== b.date || a.assessmentId !== b.assessmentId),
    ),
  );
  if (diverse) status = "mastered";
  return { skillId, status, completedTasks: completed, independentTasks: mastered.length };
}

/**
 * Turn a failed task into a focused repair review due the day after the
 * attempt. Empty when the task passed.
 */
export function planFocusedReviews(record: AssessmentTaskRecord): FocusedReview[] {
  if (record.passed) return [];
  const due = new Date(record.completedAt);
  due.setUTCDate(due.getUTCDate() + 1);
  return [{
    taskId: record.taskId,
    skillId: record.skillId,
    assessmentId: record.assessmentId,
    reason: "repair",
    scheduledFor: due.toISOString().slice(0, 10),
  }];
}
