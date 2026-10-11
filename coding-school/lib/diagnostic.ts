import { z } from "zod";
import { DIAGNOSTIC_CORE_SKILLS, DIAGNOSTIC_ITEMS, type DiagnosticItem } from "../curriculum/diagnostic-items";
import { getGrader } from "../public/grading/catalog.js";

/** Bump when the item bank or a diagnostic grader changes meaningfully.
 *  v2.0.0: AP CSP foundation tier added, explicit "I do not know" evidence
 *  introduced. Sessions stored under an older format version keep their
 *  history but their responses count as Legacy / unverified. */
export const DIAGNOSTIC_SESSION_VERSION = "2.0.0";
export const DIAGNOSTIC_MIN_ITEMS = 12;
export const DIAGNOSTIC_MAX_ITEMS = 25;
/** Honest completion requires this many successful Python executions OR this
 *  many distinct coding items the learner explicitly declared "I do not know".
 *  Never zero: silently finishing without either would fake mastery; requiring
 *  runs from a learner who genuinely cannot code yet would make the quota
 *  impossible. A declaration is recorded as a knowledge gap, never as mastery. */
export const DIAGNOSTIC_CODING_QUOTA = 2;
/** Canonical learner-facing declaration of a knowledge gap. */
export const DIAGNOSTIC_UNKNOWN_ANSWER = "I do not know";

/** True when a typed concept answer is the explicit "I do not know"
 *  declaration rather than a graded response. The declaration must OPEN the
 *  answer: "I do not know how to approach this" is an honest gap, while an
 *  answer that merely mentions it mid-sentence still gets graded. */
export function isUnknownDeclaration(answer: string): boolean {
  return /^i\s*(do\s+not|don'?t|dont)\s+know\b/i.test(answer.trim());
}

export type DiagnosticProfileState = "observed" | "uncertain" | "untested";

/** Per-skill evidence split, current-format responses only: what the learner
 *  demonstrated independently, with hints, got wrong, or admitted not knowing. */
export interface DiagnosticSkillEvidence {
  independent: number;
  hinted: number;
  wrong: number;
  unknown: number;
}

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
  /** Explicit "I do not know" declaration: a knowledge gap, distinct from a
   *  wrong answer. Optional so pre-v2 stored sessions still parse. */
  dontKnow: z.boolean().optional(),
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
  // Focus: stay on one skill until it is observed before moving on. While a
  // skill is still being probed, prefer its coding item when the coding quota
  // is unmet and the skill has no coding evidence yet, so successful Python
  // executions (or an honest declaration) arrive naturally instead of being
  // bolted on afterwards.
  for (const skillId of DIAGNOSTIC_CORE_SKILLS) {
    if (diagnosticSkillState(session, skillId) === "observed") continue;
    const skillPool = pool.filter(i => i.skillId === skillId);
    if (!skillPool.length) continue;
    const touched = session.responses.some(r => r.skillId === skillId);
    if (touched && codingEvidenceCount(session) < DIAGNOSTIC_CODING_QUOTA &&
        !session.responses.some(r => r.skillId === skillId && r.kind === "coding")) {
      const codingItem = skillPool.find(i => i.kind === "coding");
      if (codingItem) return codingItem;
    }
    return skillPool.find(i => i.kind === "concept") ?? skillPool[0];
  }
  // Coding-quota repair: the bank holds only a few coding items against the
  // quota, and a graded failure consumes its item. When the quota is still
  // unmet and the adaptive engine has nothing fresher to probe:
  //   1. serve a fresh coding item first — a real attempt is the honest path.
  //   2. otherwise re-offer a graded failure (the learner has feedback now).
  //   3. never re-serve a coding item the learner declared "I do not know" —
  //      re-punishing an honest declaration would push learners toward
  //      guessing; declared items instead feed the declaration escape hatch
  //      in canCompleteDiagnostic. Without this, failing the available coding
  //      items soft-locks the session at the item cap.
  // Once two pieces of coding evidence exist (runs and declarations mixing),
  // no coding item is forced: the pressure exists to satisfy the gate, not to
  // keep testing a learner who has already shown where they stand.
  if (codingEvidenceCount(session) < DIAGNOSTIC_CODING_QUOTA) {
    const freshCoding = pool.find(item => item.kind === "coding");
    if (freshCoding) return freshCoding;
    const retry = items.find(item => item.kind === "coding" &&
      session.responses.some(r => r.itemId === item.id && r.kind === "coding" && !r.correct && !r.legacy && !r.dontKnow) &&
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
  // The explicit "I do not know" declaration is a knowledge gap, not a wrong
  // answer: it is recorded without invoking the grader so it can never be
  // confused with a graded failure.
  const declared = isUnknownDeclaration(answer);
  const graded = declared
    ? { correct: false, detail: "learner declared a knowledge gap" }
    : gradeConcept(item.id, answer);
  const next: DiagnosticSession = {
    ...clone(session),
    responses: [...session.responses, {
      itemId: item.id, skillId: item.skillId, kind: "concept" as const, correct: graded.correct,
      answer: declared ? DIAGNOSTIC_UNKNOWN_ANSWER : answer, code: "", hintsUsed: session.draftHints,
      graderId: item.concept?.graderId ?? null, graderVersion: null, legacy: false,
      dontKnow: declared,
      respondedAt: nowIso(now),
    }],
  };
  return advance(next);
}

/**
 * Record the explicit "I do not know" declaration for the current item —
 * available for both concept and coding questions. A declaration is honest
 * evidence of a knowledge gap: it counts against the skill (never correct),
 * never toward the coding quota, and never invokes a grader or Python run.
 * Coding declarations preserve the learner's draft code.
 */
export function markUnknown(
  session: DiagnosticSession, item: DiagnosticItem, now?: Date,
): DiagnosticSession {
  assertActive(session, item);
  if (item.kind === "concept") {
    return answerConcept(session, item, DIAGNOSTIC_UNKNOWN_ANSWER,
      () => ({ correct: false, detail: "learner declared a knowledge gap" }), now);
  }
  if (!item.coding) throw new Error(`Item ${item.id} is missing coding details.`);
  const next: DiagnosticSession = {
    ...clone(session),
    responses: [...session.responses, {
      itemId: item.id, skillId: item.skillId, kind: "coding" as const, correct: false,
      answer: "", code: session.draftCode, hintsUsed: session.draftHints,
      graderId: item.coding.graderId, graderVersion: null, legacy: false,
      dontKnow: true,
      respondedAt: nowIso(now),
    }],
  };
  return advance(next);
}

/** Distinct current-format coding items the learner explicitly declared
 *  "I do not know". Legacy responses never count. */
export function codingUnknownCount(session: DiagnosticSession): number {
  return new Set(session.responses
    .filter(r => r.kind === "coding" && r.dontKnow === true && !r.legacy)
    .map(r => r.itemId)).size;
}

/** Two pieces of coding evidence, counted per distinct coding question: either
 *  a successful current-format Python execution or an honest "I do not know"
 *  declaration. The two kinds mix — one run plus one declaration satisfies the
 *  quota. Hinted concept answers, graded failures, and legacy runs are not
 *  pieces of coding evidence and are counted nowhere here. */
export function codingEvidenceCount(session: DiagnosticSession): number {
  const items = new Set<string>();
  for (const response of session.responses) {
    if (response.kind !== "coding" || response.legacy) continue;
    if (response.correct || response.dontKnow === true) items.add(response.itemId);
  }
  return items.size;
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
      dontKnow: false,
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
    // Early stopping: the diagnostic ends while the evidence is fresh, not by
    // grinding every skill to certainty. A probed skill is one with
    // current-format responses; a skill with a single correct answer is still
    // genuinely uncertain, and the profile should say so honestly instead of
    // over-testing it into observed or leaving it untouched.
    const probed = DIAGNOSTIC_CORE_SKILLS.filter(skillId =>
      session.responses.some(r => r.skillId === skillId && !r.legacy));
    const observed = probed.filter(skillId => diagnosticSkillState(session, skillId) === "observed");
    const uncertain = probed.filter(skillId => diagnosticSkillState(session, skillId) === "uncertain");
    if (probed.length < 6) reasons.push(`probe at least 6 different skills (probed ${probed.length} so far)`);
    if (observed.length < 5) reasons.push(`show clear evidence on at least 5 skills (observed ${observed.length} so far)`);
    if (uncertain.length < 1) reasons.push(`leave at least one probed skill still uncertain — the diagnostic stops while some areas are honestly unresolved (observed ${observed.length}, uncertain 0)`);
  }
  // The coding gate is absolute but never impossible: the diagnostic may not
  // complete with zero honest coding evidence. Two distinct coding questions
  // must each carry evidence — a working Python execution or an explicit "I do
  // not know" declaration — and the two kinds mix (one of each is two pieces).
  // A declaration is a knowledge gap recorded as such, never as mastery.
  // Graded failures, legacy runs, and hints satisfy neither side, so a learner
  // who attempted and failed keeps getting honest retries instead of a
  // rubber-stamped finish.
  const codingEvidence = codingEvidenceCount(session);
  if (codingEvidence < DIAGNOSTIC_CODING_QUOTA) {
    const runs = session.codingSuccessCount;
    const declarations = codingUnknownCount(session);
    reasons.push(`coding quota: ${DIAGNOSTIC_CODING_QUOTA} pieces of coding evidence on distinct coding questions — a successful Python run or an honest "${DIAGNOSTIC_UNKNOWN_ANSWER}" declaration, either kind (have ${runs} run${runs === 1 ? "" : "s"}, ${declarations} declaration${declarations === 1 ? "" : "s"})`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function deriveDiagnosticProfile(session: DiagnosticSession): {
  profile: Record<string, DiagnosticProfileState>;
  recommendation: string;
  legacyCount: number;
  evidence: Record<string, DiagnosticSkillEvidence>;
  knowledgeGaps: string[];
  hintDependent: string[];
} {
  const profile: Record<string, DiagnosticProfileState> = {};
  const evidence: Record<string, DiagnosticSkillEvidence> = {};
  for (const skillId of DIAGNOSTIC_CORE_SKILLS) {
    profile[skillId] = diagnosticSkillState(session, skillId);
    const counts: DiagnosticSkillEvidence = { independent: 0, hinted: 0, wrong: 0, unknown: 0 };
    for (const response of validResponses(session, skillId)) {
      if (response.dontKnow === true) counts.unknown++;
      else if (response.correct && response.hintsUsed > 0) counts.hinted++;
      else if (response.correct) counts.independent++;
      else counts.wrong++;
    }
    evidence[skillId] = counts;
  }
  const legacyCount = session.responses.filter(r => r.legacy).length;
  const placedCount = session.responses.length - legacyCount;
  const totals = { independent: 0, hinted: 0, wrong: 0, unknown: 0 };
  for (const counts of Object.values(evidence)) {
    totals.independent += counts.independent;
    totals.hinted += counts.hinted;
    totals.wrong += counts.wrong;
    totals.unknown += counts.unknown;
  }
  const correctRate = (skillId: string) => {
    const counts = evidence[skillId];
    const seen = counts.independent + counts.hinted + counts.wrong + counts.unknown;
    return seen ? (counts.independent + counts.hinted) / seen : 0;
  };
  // Solid ground means unaided evidence: at least one correct answer the
  // learner reached without hints. A skill answered correctly only with hints
  // is assisted success — emerging, reported separately, never solid ground.
  const assistedOnly = (id: string) => evidence[id].independent === 0 && evidence[id].hinted > 0;
  const strong = DIAGNOSTIC_CORE_SKILLS.filter(id =>
    profile[id] === "observed" && correctRate(id) >= 0.6 && !assistedOnly(id));
  // A pure knowledge gap is reported under knowledgeGaps, not lumped in with
  // wrong answers — the distinction is the point of the honest self-diagnostic.
  const isPureGap = (id: string) => {
    const c = evidence[id];
    return c.unknown > 0 && c.independent === 0 && c.hinted === 0 && c.wrong === 0;
  };
  const weak = DIAGNOSTIC_CORE_SKILLS.filter(id => profile[id] === "observed" && correctRate(id) < 0.6 && !isPureGap(id));
  const knowledgeGaps = DIAGNOSTIC_CORE_SKILLS.filter(id => evidence[id].unknown > 0 && isPureGap(id));
  const hintDependent = DIAGNOSTIC_CORE_SKILLS.filter(id =>
    evidence[id].independent === 0 && evidence[id].hinted > 0);
  const uncertain = DIAGNOSTIC_CORE_SKILLS.filter(id => profile[id] === "uncertain");
  const untested = DIAGNOSTIC_CORE_SKILLS.filter(id => profile[id] === "untested");
  const parts = [
    `Placement from ${placedCount} diagnostic responses on ${session.completedAt ?? session.startedAt}.`,
    "Starting level: AP Computer Science Principles foundations adapted to Python, branching into advanced skills.",
    placedCount
      ? `Answers: ${totals.independent} correct on your own, ${totals.hinted} correct after hints, ${totals.wrong} incorrect, ${totals.unknown} declared "${DIAGNOSTIC_UNKNOWN_ANSWER}".`
      : "",
    strong.length ? `Solid ground: ${strong.join(", ")}.` : "",
    knowledgeGaps.length
      ? `Knowledge gaps (you said "${DIAGNOSTIC_UNKNOWN_ANSWER}" — gaps, not mistakes): ${knowledgeGaps.join(", ")}.`
      : "",
    weak.length ? `Needs practice: ${weak.join(", ")} — wrong answers worth reworking; start with the earliest mission covering these.` : "",
    hintDependent.length ? `Hint-dependent: ${hintDependent.join(", ")} — correct only after hints: emerging, assisted success, not solid ground.` : "",
    uncertain.length ? `Still uncertain: ${uncertain.join(", ")}.` : "",
    untested.length ? `Untested: ${untested.join(", ")}.` : "",
    legacyCount ? `${legacyCount} response(s) used a legacy grader version and are marked Legacy / unverified; they did not affect placement.` : "",
    "The diagnostic sets placement only. It never grants mission completion or mastery — those need independent project evidence over time.",
  ];
  return {
    profile, recommendation: parts.filter(Boolean).join(" "), legacyCount,
    evidence, knowledgeGaps, hintDependent,
  };
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
