import { z } from "zod";
import { DIAGNOSTIC_CORE_SKILLS, DIAGNOSTIC_ITEMS, type DiagnosticItem } from "../curriculum/diagnostic-items";
import { getGrader } from "../public/grading/catalog.js";

/** Bump when the item bank or a diagnostic grader changes meaningfully. */
export const DIAGNOSTIC_SESSION_VERSION = "1.0.0";
export const DIAGNOSTIC_MIN_ITEMS = 12;
export const DIAGNOSTIC_MAX_ITEMS = 25;
/** Successful Python executions required before a diagnostic may complete. Never zero. */
export const DIAGNOSTIC_CODING_QUOTA = 2;

export type DiagnosticProfileState = "observed" | "uncertain" | "untested";

export const diagnosticResponseSchema = z.object({
  itemId: z.string().min(1),
  skillId: z.string().min(1),
  kind: z.enum(["concept", "coding"]),
  correct: z.boolean(),
  answer: z.string(),
  code: z.string(),
  hintsUsed: z.number().int().nonnegative(),
  graderId: z.string().nullable(),
  graderVersion: z.string().nullable(),
  legacy: z.boolean(),
  respondedAt: z.string(),
});
export type DiagnosticResponse = z.infer<typeof diagnosticResponseSchema>;

export const diagnosticInfraErrorSchema = z.object({ message: z.string(), at: z.string() });
export const diagnosticSessionSchema = z.object({
  id: z.string().min(1),
  formatVersion: z.string().min(1),
  status: z.enum(["in-progress", "completed"]),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  responses: z.array(diagnosticResponseSchema),
  currentItemId: z.string().nullable(),
  draftAnswer: z.string(),
  draftCode: z.string(),
  draftHints: z.number().int().nonnegative(),
  codingSuccessCount: z.number().int().nonnegative(),
  infraError: diagnosticInfraErrorSchema.nullable(),
  profile: z.record(z.string(), z.enum(["observed", "uncertain", "untested"])).nullable(),
  recommendation: z.string().nullable(),
});
export type DiagnosticSession = z.infer<typeof diagnosticSessionSchema>;

/** Injected semantic grader so the engine stays decoupled from the grading module. */
export type ConceptGrader = (itemId: string, answer: string) => { correct: boolean; detail: string };
export type CodingOutcome =
  | { kind: "graded"; passed: boolean; executionOk: boolean; graderVersion: string }
  | { kind: "infra"; message: string }
  | { kind: "ignored"; reason: string };

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
const nowIso = (now?: Date) => (now ?? new Date()).toISOString();
function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `diag-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** Only current-format evidence counts toward placement confidence and coding quotas. */
const validResponses = (session: DiagnosticSession, skillId: string) =>
  session.responses.filter(r => r.skillId === skillId && !r.legacy);

function decisive(responses: DiagnosticResponse[]): boolean {
  const correct = responses.filter(r => r.correct);
  const incorrect = responses.filter(r => !r.correct);
  return correct.some(r => r.kind === "coding") || correct.length >= 2 || incorrect.length >= 2;
}

export function diagnosticSkillState(session: DiagnosticSession, skillId: string): DiagnosticProfileState {
  const evidence = validResponses(session, skillId);
  if (!evidence.length) return "untested";
  return decisive(evidence) ? "observed" : "uncertain";
}

/** Sessions stored under an older format version keep their history, but every
 *  response becomes Legacy / unverified: it stops counting toward placement
 *  confidence and the coding quota. Nothing is deleted. */
export function markLegacyDiagnosticSession(session: DiagnosticSession): DiagnosticSession {
  if (session.formatVersion === DIAGNOSTIC_SESSION_VERSION) return session;
  return {
    ...clone(session),
    responses: session.responses.map(response => ({ ...response, legacy: true })),
    codingSuccessCount: 0,
  };
}

export function createDiagnosticSession(now?: Date): DiagnosticSession {
  const session: DiagnosticSession = {
    id: randomId(), formatVersion: DIAGNOSTIC_SESSION_VERSION, status: "in-progress",
    startedAt: nowIso(now), completedAt: null, responses: [], currentItemId: null,
    draftAnswer: "", draftCode: "", draftHints: 0, codingSuccessCount: 0,
    infraError: null, profile: null, recommendation: null,
  };
  const first = nextDiagnosticItem(session);
  return { ...session, currentItemId: first?.id ?? null };
}

export function nextDiagnosticItem(session: DiagnosticSession, items: DiagnosticItem[] = DIAGNOSTIC_ITEMS): DiagnosticItem | null {
  if (session.status === "completed") return null;
  if (session.responses.length >= DIAGNOSTIC_MAX_ITEMS) return null;
  if (canCompleteDiagnostic(session).ok) return null;
  const answered = new Set(session.responses.map(r => r.itemId));
  const pool = items.filter(i => !answered.has(i.id));
  if (!pool.length) return null;
  // Breadth first: every core skill gets probed before any skill is repeated.
  for (const skillId of DIAGNOSTIC_CORE_SKILLS) {
    if (!session.responses.some(r => r.skillId === skillId)) {
      return pool.find(i => i.skillId === skillId && i.kind === "concept") ?? pool.find(i => i.skillId === skillId) ?? null;
    }
  }
  // Depth: keep probing uncertain skills. Prefer a coding item when the skill
  // has one and no coding evidence exists yet, so the coding quota stays reachable.
  for (const skillId of DIAGNOSTIC_CORE_SKILLS) {
    if (diagnosticSkillState(session, skillId) !== "uncertain") continue;
    const skillPool = pool.filter(i => i.skillId === skillId);
    if (!skillPool.length) continue;
    if (!session.responses.some(r => r.skillId === skillId && r.kind === "coding")) {
      const codingItem = skillPool.find(i => i.kind === "coding");
      if (codingItem) return codingItem;
    }
    return skillPool[0];
  }
  // Coding-quota repair: the bank holds only a few coding items against the
  // quota, and a graded failure consumes its item. When the quota is still
  // unmet and the adaptive engine has nothing fresher to probe, re-offer a
  // previously failed coding item for another attempt. Without this, failing
  // the available coding items soft-locks the session: the quota can never be
  // met, yet items keep being served until the cap, and the diagnostic can
  // never complete except via retake.
  if (session.codingSuccessCount < DIAGNOSTIC_CODING_QUOTA) {
    const retry = items.find(item => item.kind === "coding" &&
      session.responses.some(r => r.itemId === item.id && r.kind === "coding" && !r.correct && !r.legacy) &&
      !session.responses.some(r => r.itemId === item.id && r.kind === "coding" && r.correct));
    if (retry) return retry;
  }
  return pool[0] ?? null;
}

function assertActive(session: DiagnosticSession, item: DiagnosticItem) {
  if (session.status === "completed") throw new Error("This diagnostic session is completed and immutable.");
  if (item.id !== session.currentItemId) throw new Error(`Item ${item.id} is not the current diagnostic item (stale item rejected).`);
}

/** Persist in-progress drafts (answer/code/hints) without recording a response. Completed sessions are immutable. */
export function saveDiagnosticDraft(session: DiagnosticSession, draft: { answer?: string; code?: string; hints?: number }): DiagnosticSession {
  if (session.status === "completed") throw new Error("This diagnostic session is completed and immutable.");
  return {
    ...clone(session),
    draftAnswer: draft.answer ?? session.draftAnswer,
    draftCode: draft.code ?? session.draftCode,
    draftHints: draft.hints ?? session.draftHints,
  };
}

function advance(session: DiagnosticSession): DiagnosticSession {
  const next = nextDiagnosticItem(session);
  return { ...session, currentItemId: next?.id ?? null, draftAnswer: "", draftCode: "", draftHints: 0, infraError: null };
}

export function answerConcept(
  session: DiagnosticSession, item: DiagnosticItem, answer: string, gradeConcept: ConceptGrader, now?: Date,
): DiagnosticSession {
  assertActive(session, item);
  if (item.kind !== "concept") throw new Error(`Item ${item.id} is not a concept item.`);
  const graded = gradeConcept(item.id, answer);
  const next: DiagnosticSession = {
    ...clone(session),
    responses: [...session.responses, {
      itemId: item.id, skillId: item.skillId, kind: "concept" as const, correct: graded.correct,
      answer, code: "", hintsUsed: session.draftHints,
      graderId: item.concept?.graderId ?? null, graderVersion: null, legacy: false,
      respondedAt: nowIso(now),
    }],
  };
  return advance(next);
}

export function recordCodingOutcome(
  session: DiagnosticSession, item: DiagnosticItem, outcome: CodingOutcome, code: string, now?: Date,
): DiagnosticSession {
  assertActive(session, item);
  if (item.kind !== "coding" || !item.coding) throw new Error(`Item ${item.id} is not a coding item.`);
  // Infrastructure failures and ignored (stale/mismatched) results must never
  // become learner evidence. Code is preserved; the item stays current.
  if (outcome.kind === "infra") {
    return { ...clone(session), draftCode: code, infraError: { message: outcome.message, at: nowIso(now) } };
  }
  if (outcome.kind === "ignored") {
    return { ...clone(session), draftCode: code };
  }
  const catalog = getGrader(item.coding.exerciseId, item.coding.graderId);
  const legacy = outcome.graderVersion !== catalog?.version;
  const correct = outcome.passed && outcome.executionOk;
  const next: DiagnosticSession = {
    ...clone(session),
    codingSuccessCount: !legacy && correct ? session.codingSuccessCount + 1 : session.codingSuccessCount,
    responses: [...session.responses, {
      itemId: item.id, skillId: item.skillId, kind: "coding" as const, correct,
      answer: "", code, hintsUsed: session.draftHints,
      graderId: item.coding.graderId, graderVersion: outcome.graderVersion, legacy,
      respondedAt: nowIso(now),
    }],
  };
  return advance(next);
}

/** Runner failure results (single "execution" check) are infrastructure noise, not learner evidence. */
export function classifyGradeResult(result: { executionOk: boolean; tests: { id: string }[] }): "infra" | "graded" {
  if (!result.executionOk && result.tests.length > 0 && result.tests.every(t => t.id === "execution")) return "infra";
  return "graded";
}

export function canCompleteDiagnostic(session: DiagnosticSession): { ok: boolean; reasons: string[] } {
  if (session.status === "completed") return { ok: true, reasons: [] };
  const reasons: string[] = [];
  const count = session.responses.length;
  if (count < DIAGNOSTIC_MIN_ITEMS) reasons.push(`answer at least ${DIAGNOSTIC_MIN_ITEMS} items (answered ${count})`);
  if (count < DIAGNOSTIC_MAX_ITEMS) {
    for (const skillId of DIAGNOSTIC_CORE_SKILLS) {
      const state = diagnosticSkillState(session, skillId);
      if (state !== "observed") reasons.push(`skill ${skillId} is ${state}`);
    }
  }
  // The coding quota is absolute: a diagnostic may never complete with zero
  // successful Python executions, even at the item cap.
  if (session.codingSuccessCount < DIAGNOSTIC_CODING_QUOTA) {
    reasons.push(`coding quota: ${DIAGNOSTIC_CODING_QUOTA} successful Python executions required (have ${session.codingSuccessCount})`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function deriveDiagnosticProfile(session: DiagnosticSession): {
  profile: Record<string, DiagnosticProfileState>; recommendation: string; legacyCount: number;
} {
  const profile: Record<string, DiagnosticProfileState> = {};
  for (const skillId of DIAGNOSTIC_CORE_SKILLS) profile[skillId] = diagnosticSkillState(session, skillId);
  const legacyCount = session.responses.filter(r => r.legacy).length;
  const placedCount = session.responses.length - legacyCount;
  const correctRate = (skillId: string) => {
    const evidence = validResponses(session, skillId);
    return evidence.length ? evidence.filter(r => r.correct).length / evidence.length : 0;
  };
  const strong = DIAGNOSTIC_CORE_SKILLS.filter(id => profile[id] === "observed" && correctRate(id) >= 0.6);
  const weak = DIAGNOSTIC_CORE_SKILLS.filter(id => profile[id] === "observed" && correctRate(id) < 0.6);
  const uncertain = DIAGNOSTIC_CORE_SKILLS.filter(id => profile[id] === "uncertain");
  const untested = DIAGNOSTIC_CORE_SKILLS.filter(id => profile[id] === "untested");
  const parts = [
    `Placement from ${placedCount} diagnostic responses on ${session.completedAt ?? session.startedAt}.`,
    strong.length ? `Solid ground: ${strong.join(", ")}.` : "",
    weak.length ? `Needs practice: ${weak.join(", ")} — start with the earliest mission covering these.` : "",
    uncertain.length ? `Still uncertain: ${uncertain.join(", ")}.` : "",
    untested.length ? `Untested: ${untested.join(", ")}.` : "",
    legacyCount ? `${legacyCount} response(s) used a legacy grader version and are marked Legacy / unverified; they did not affect placement.` : "",
    "The diagnostic sets placement only. It never grants mission completion or mastery — those need independent project evidence over time.",
  ];
  return { profile, recommendation: parts.filter(Boolean).join(" "), legacyCount };
}

export function completeDiagnosticSession(session: DiagnosticSession, now?: Date): DiagnosticSession {
  if (session.status === "completed") return clone(session);
  const check = canCompleteDiagnostic(session);
  if (!check.ok) throw new Error(`Diagnostic cannot complete yet: ${check.reasons.join("; ")}`);
  const { profile, recommendation } = deriveDiagnosticProfile(session);
  return {
    ...clone(session), status: "completed", completedAt: nowIso(now),
    currentItemId: null, draftAnswer: "", draftCode: "", draftHints: 0, infraError: null,
    profile, recommendation,
  };
}

/** Latest completed session, or null. Previous sessions stay in history untouched. */
export function latestCompletedDiagnosticSession(sessions: DiagnosticSession[]): DiagnosticSession | null {
  const completed = sessions
    .filter(session => session.status === "completed")
    .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));
  return completed[completed.length - 1] ?? null;
}
