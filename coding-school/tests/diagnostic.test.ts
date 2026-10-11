import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODING_QUOTA,
  DIAGNOSTIC_MAX_ITEMS,
  DIAGNOSTIC_MIN_ITEMS,
  DIAGNOSTIC_SESSION_VERSION,
  DIAGNOSTIC_UNKNOWN_ANSWER,
  answerConcept,
  canCompleteDiagnostic,
  classifyGradeResult,
  codingEvidenceCount,
  codingUnknownCount,
  completeDiagnosticSession,
  createDiagnosticSession,
  deriveDiagnosticProfile,
  diagnosticSessionSchema,
  diagnosticSkillState,
  isUnknownDeclaration,
  markLegacyDiagnosticSession,
  markUnknown,
  nextDiagnosticItem,
  recordCodingOutcome,
  saveDiagnosticDraft,
  type ConceptGrader,
  type DiagnosticSession,
} from "../lib/diagnostic";
import { DIAGNOSTIC_CORE_SKILLS, DIAGNOSTIC_ITEMS, type DiagnosticItem } from "../curriculum/diagnostic-items";

const alwaysCorrect: ConceptGrader = () => ({ correct: true, detail: "stub" });
const byId = new Map(DIAGNOSTIC_ITEMS.map(i => [i.id, i]));

function answerCurrentCorrectly(session: DiagnosticSession, grade: ConceptGrader = alwaysCorrect): DiagnosticSession {
  const current = byId.get(session.currentItemId!);
  if (!current) throw new Error("no current item");
  if (current.kind === "concept") return answerConcept(session, current, "stub answer", grade);
  return recordCodingOutcome(session, current,
    { kind: "graded", passed: true, executionOk: true, graderVersion: "1.0.0" }, "stub code");
}

type SyntheticResponse = {
  skillId: string;
  kind: "concept" | "coding";
  correct: boolean;
  itemId?: string;
  hintsUsed?: number;
  dontKnow?: boolean;
  legacy?: boolean;
};

/** Build an in-progress session from hand-authored responses, so completion
 *  gates can be tested in isolation from the item-selection engine. */
function syntheticSession(parts: SyntheticResponse[]): DiagnosticSession {
  const responses = parts.map((part, i) => ({
    itemId: part.itemId ?? `synthetic-${i}`,
    skillId: part.skillId,
    kind: part.kind,
    correct: part.correct,
    answer: part.dontKnow ? "I do not know" : "",
    code: "",
    hintsUsed: part.hintsUsed ?? 0,
    graderId: null,
    graderVersion: null,
    legacy: part.legacy ?? false,
    dontKnow: part.dontKnow ?? false,
    respondedAt: "2026-09-13T12:00:00.000Z",
  }));
  return {
    id: "synthetic",
    formatVersion: DIAGNOSTIC_SESSION_VERSION,
    status: "in-progress",
    startedAt: "2026-09-13T12:00:00.000Z",
    completedAt: null,
    responses,
    currentItemId: null,
    draftAnswer: "",
    draftCode: "",
    draftHints: 0,
    codingSuccessCount: responses.filter(r => r.kind === "coding" && r.correct && !r.legacy).length,
    infraError: null,
    profile: null,
    recommendation: null,
  };
}

function runConfidentPath(): DiagnosticSession {
  let session = createDiagnosticSession(new Date("2026-09-13T12:00:00.000Z"));
  let guard = 0;
  while (nextDiagnosticItem(session) && guard++ < 40) session = answerCurrentCorrectly(session);
  return session;
}

describe("diagnostic session lifecycle", () => {
  it("creates an in-progress session with a stable id and current format version", () => {
    const session = createDiagnosticSession(new Date("2026-09-13T12:00:00.000Z"));
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.status).toBe("in-progress");
    expect(session.formatVersion).toBe(DIAGNOSTIC_SESSION_VERSION);
    expect(session.currentItemId).toBeTruthy();
  });

  it("stays focused on the first skill until it is observed before moving on", () => {
    let session = createDiagnosticSession();
    const firstSkill = nextDiagnosticItem(session)!.skillId;
    // One correct answer is not decisive yet, so the engine keeps probing the same skill.
    session = answerCurrentCorrectly(session);
    expect(diagnosticSkillState(session, firstSkill)).not.toBe("observed");
    const second = nextDiagnosticItem(session)!;
    expect(second.skillId).toBe(firstSkill);
    session = answerCurrentCorrectly(session);
    expect(diagnosticSkillState(session, firstSkill)).toBe("observed");
    // Only now may the engine move on to the next skill.
    const third = nextDiagnosticItem(session)!;
    expect(third.skillId).not.toBe(firstSkill);
  });

  it("confident path stops well before the cap with observed, uncertain, and untested skills", () => {
    const session = runConfidentPath();
    expect(session.responses.length).toBeGreaterThanOrEqual(DIAGNOSTIC_MIN_ITEMS);
    expect(session.responses.length).toBeLessThanOrEqual(20);
    expect(nextDiagnosticItem(session)).toBeNull();
    const check = canCompleteDiagnostic(session);
    expect(check.ok).toBe(true);
    const completed = completeDiagnosticSession(session);
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeTruthy();
    const profile = deriveDiagnosticProfile(completed);
    const states = Object.values(profile.profile);
    expect(states).toContain("observed");
    expect(states).toContain("uncertain");
    expect(states).toContain("untested");
    // Confident path probes each skill in order until observed, stopping as
    // soon as a skill is still genuinely uncertain after the quota is met.
    expect(session.responses.length).toBe(19);
    expect(states.filter(s => s === "observed")).toHaveLength(9);
    expect(states.filter(s => s === "uncertain")).toHaveLength(1);
    expect(states.filter(s => s === "untested")).toHaveLength(1);
    expect(profile.recommendation.length).toBeGreaterThan(20);
  });

  it("never offers fewer than 12 or more than 25 items", () => {
    const alternating: ConceptGrader = (() => { let n = 0; return () => ({ correct: (n++ % 2 === 0), detail: "stub" }); })();
    let session = createDiagnosticSession();
    let guard = 0;
    while (nextDiagnosticItem(session) && guard++ < 60) {
      const current = byId.get(session.currentItemId!)!;
      session = current.kind === "concept"
        ? answerConcept(session, current, "stub", alternating)
        : recordCodingOutcome(session, current, { kind: "graded", passed: guard % 2 === 0, executionOk: true, graderVersion: "1.0.0" }, "code");
    }
    expect(session.responses.length).toBeLessThanOrEqual(DIAGNOSTIC_MAX_ITEMS);
    expect(session.responses.length).toBeGreaterThanOrEqual(DIAGNOSTIC_MIN_ITEMS);
  });

  it("conflicted path can continue toward 25 while evidence stays uncertain", () => {
    let n = 0;
    const flaky: ConceptGrader = () => ({ correct: (n++ % 3 !== 0), detail: "stub" });
    let session = createDiagnosticSession();
    let guard = 0;
    while (nextDiagnosticItem(session) && guard++ < 60) {
      const current = byId.get(session.currentItemId!)!;
      session = current.kind === "concept"
        ? answerConcept(session, current, "stub", flaky)
        : recordCodingOutcome(session, current, { kind: "graded", passed: false, executionOk: true, graderVersion: "1.0.0" }, "code");
    }
    // Uncertain evidence keeps the engine probing instead of stopping early.
    expect(session.responses.length).toBeGreaterThan(DIAGNOSTIC_MIN_ITEMS);
  });

  it("a 12-response session covering only two skills cannot complete", () => {
    const parts: SyntheticResponse[] = [];
    for (let i = 0; i < 4; i++) parts.push({ skillId: "python-functions", kind: "concept", correct: true });
    for (let i = 0; i < 2; i++) parts.push({ skillId: "python-functions", kind: "coding", correct: true });
    for (let i = 0; i < 6; i++) parts.push({ skillId: "python-exceptions", kind: "concept", correct: true });
    const session = syntheticSession(parts);
    expect(session.responses.length).toBe(12);
    expect(session.codingSuccessCount).toBe(DIAGNOSTIC_CODING_QUOTA);
    const check = canCompleteDiagnostic(session);
    expect(check.ok).toBe(false);
    expect(check.reasons.join(" ")).toMatch(/skill/i);
    expect(() => completeDiagnosticSession(session)).toThrow(/skill/i);
  });

  it("needs a genuinely uncertain skill and completes once one appears", () => {
    const parts: SyntheticResponse[] = [];
    DIAGNOSTIC_CORE_SKILLS.slice(0, 6).forEach((skillId, index) => {
      parts.push({ skillId, kind: "concept", correct: true });
      // Two successful Python executions for the quota, on two different skills.
      parts.push({ skillId, kind: index < 2 ? "coding" : "concept", correct: true });
    });
    const allDecided = syntheticSession(parts);
    expect(allDecided.responses.length).toBe(12);
    expect(allDecided.codingSuccessCount).toBe(DIAGNOSTIC_CODING_QUOTA);
    const blocked = canCompleteDiagnostic(allDecided);
    expect(blocked.ok).toBe(false);
    expect(blocked.reasons.join(" ")).toMatch(/uncertain/i);
    // One more response that leaves a seventh skill genuinely uncertain.
    const withUncertain = syntheticSession([
      ...parts,
      { skillId: DIAGNOSTIC_CORE_SKILLS[6], kind: "concept", correct: true },
    ]);
    expect(canCompleteDiagnostic(withUncertain).ok).toBe(true);
    const completed = completeDiagnosticSession(withUncertain);
    expect(deriveDiagnosticProfile(completed).profile[DIAGNOSTIC_CORE_SKILLS[6]]).toBe("uncertain");
  });

  it("requires the coding quota and refuses completion with zero successful executions", () => {
    let session = createDiagnosticSession();
    let guard = 0;
    while (nextDiagnosticItem(session) && guard++ < 40) {
      const current = byId.get(session.currentItemId!)!;
      session = current.kind === "concept"
        ? answerConcept(session, current, "right", alwaysCorrect)
        : recordCodingOutcome(session, current, { kind: "graded", passed: false, executionOk: true, graderVersion: "1.0.0" }, "wrong code");
    }
    expect(session.codingSuccessCount).toBe(0);
    const check = canCompleteDiagnostic(session);
    expect(check.ok).toBe(false);
    expect(check.reasons.join(" ")).toMatch(/coding/i);
    expect(() => completeDiagnosticSession(session)).toThrow(/coding/i);
  });

  it("re-offers a failed coding item instead of soft-locking when the quota is unreachable from fresh items", () => {
    const alwaysWrong: ConceptGrader = () => ({ correct: false, detail: "stub" });
    let session = createDiagnosticSession();
    const failedCodingIds = new Set<string>();
    let retried: DiagnosticItem | null = null;
    let guard = 0;
    while (guard++ < 60) {
      const current = session.currentItemId ? byId.get(session.currentItemId)! : null;
      if (!current) break;
      if (current.kind === "coding") {
        if (failedCodingIds.has(current.id)) { retried = current; break; }
        failedCodingIds.add(current.id);
        session = recordCodingOutcome(session, current,
          { kind: "graded", passed: false, executionOk: true, graderVersion: "1.0.0" }, "broken code");
      } else {
        session = answerConcept(session, current, "wrong", alwaysWrong);
      }
    }
    // Every coding item was failed, so the quota cannot be met from fresh
    // items. The engine must offer a failed coding item for another attempt
    // rather than marching through concepts to an uncompletable dead end.
    expect(failedCodingIds.size).toBeGreaterThan(0);
    expect(session.codingSuccessCount).toBe(0);
    expect(retried).not.toBeNull();
    expect(retried!.kind).toBe("coding");
    // Passing the retry counts toward the quota.
    const after = recordCodingOutcome({ ...session, currentItemId: retried!.id }, retried!,
      { kind: "graded", passed: true, executionOk: true, graderVersion: "1.0.0" }, "fixed code");
    expect(after.codingSuccessCount).toBe(1);
  });

  it("counts only current-version successful executions toward the quota", () => {
    let session = createDiagnosticSession();
    // Answer everything correctly except coding items use a legacy grader version.
    let guard = 0;
    while (nextDiagnosticItem(session) && guard++ < 40) {
      const current = byId.get(session.currentItemId!)!;
      session = current.kind === "concept"
        ? answerConcept(session, current, "right", alwaysCorrect)
        : recordCodingOutcome(session, current, { kind: "graded", passed: true, executionOk: true, graderVersion: "0.9.0" }, "code");
    }
    expect(session.codingSuccessCount).toBe(0);
    expect(session.responses.filter(r => r.legacy).length).toBeGreaterThan(0);
    expect(canCompleteDiagnostic(session).ok).toBe(false);
  });
});

describe("infrastructure failures create no evidence", () => {
  it("infra outcome records no response, no credit, and a retryable error preserving code", () => {
    let session = createDiagnosticSession();
    // Advance to a coding item.
    let guard = 0;
    while (session.currentItemId && byId.get(session.currentItemId)!.kind !== "coding" && guard++ < 20) {
      session = answerCurrentCorrectly(session);
    }
    const codingItem = byId.get(session.currentItemId!)!;
    expect(codingItem.kind).toBe("coding");
    const before = session.responses.length;
    session = recordCodingOutcome(session, codingItem, { kind: "infra", message: "Pyodide failed to load" }, "my precious code");
    expect(session.responses.length).toBe(before);
    expect(session.codingSuccessCount).toBe(0);
    expect(session.infraError?.message).toMatch(/Pyodide/);
    expect(session.draftCode).toBe("my precious code");
    expect(session.currentItemId).toBe(codingItem.id);
  });

  it("retry after recovery records the graded response and clears the error", () => {
    let session = createDiagnosticSession();
    let guard = 0;
    while (session.currentItemId && byId.get(session.currentItemId)!.kind !== "coding" && guard++ < 20) {
      session = answerCurrentCorrectly(session);
    }
    const codingItem = byId.get(session.currentItemId!)!;
    session = recordCodingOutcome(session, codingItem, { kind: "infra", message: "timeout" }, "code v1");
    const cleared = { ...session, infraError: null };
    const after = recordCodingOutcome(cleared, codingItem, { kind: "graded", passed: true, executionOk: true, graderVersion: "1.0.0" }, "code v1");
    expect(after.infraError).toBeNull();
    expect(after.responses.length).toBe(session.responses.length + 1);
    expect(after.responses.at(-1)?.correct).toBe(true);
    expect(after.codingSuccessCount).toBe(1);
  });

  it("classifies runner failure results as infrastructure, learner crashes as graded", () => {
    const infra = { requestId: "r", executionOk: false, passed: false, tests: [{ id: "execution", name: "x", required: true, passed: false, detail: "timed out" }] };
    expect(classifyGradeResult(infra)).toBe("infra");
    const learnerCrash = { requestId: "r", executionOk: false, passed: false, tests: [{ id: "sample", name: "x", required: true, passed: false, detail: "traceback" }] };
    expect(classifyGradeResult(learnerCrash)).toBe("graded");
  });

  it("ignored outcomes change nothing and preserve the draft", () => {
    let session = createDiagnosticSession();
    let guard = 0;
    while (session.currentItemId && byId.get(session.currentItemId)!.kind !== "coding" && guard++ < 20) {
      session = answerCurrentCorrectly(session);
    }
    const codingItem = byId.get(session.currentItemId!)!;
    const before = session.responses.length;
    const after = recordCodingOutcome({ ...session, draftCode: "draft" }, codingItem,
      { kind: "ignored", reason: "grader-version-mismatch" }, "draft");
    expect(after.responses.length).toBe(before);
    expect(after.codingSuccessCount).toBe(0);
    expect(after.draftCode).toBe("draft");
    expect(after.infraError).toBeNull();
    expect(after.currentItemId).toBe(codingItem.id);
  });
});

describe("stale identifiers are rejected", () => {
  it("rejects answers and coding outcomes for a non-current item", () => {
    const session = createDiagnosticSession();
    const other = DIAGNOSTIC_ITEMS.find(i => i.id !== session.currentItemId)!;
    expect(() => answerConcept(session, other, "x", alwaysCorrect)).toThrow(/current/i);
    expect(() => recordCodingOutcome(session, other, { kind: "graded", passed: true, executionOk: true, graderVersion: "1.0.0" }, "x")).toThrow(/current/i);
  });
});

describe("legacy grader versions", () => {
  it("preserves old-version responses, marks them legacy, and excludes them from placement", () => {
    let session = createDiagnosticSession();
    let guard = 0;
    while (session.currentItemId && byId.get(session.currentItemId)!.kind !== "coding" && guard++ < 20) {
      session = answerCurrentCorrectly(session);
    }
    const codingItem = byId.get(session.currentItemId!)!;
    session = recordCodingOutcome(session, codingItem, { kind: "graded", passed: true, executionOk: true, graderVersion: "0.0.0" }, "code");
    const response = session.responses.at(-1)!;
    expect(response.legacy).toBe(true);
    expect(session.codingSuccessCount).toBe(0);
    const profile = deriveDiagnosticProfile(session);
    expect(profile.legacyCount).toBe(1);
    // Legacy evidence alone cannot make a skill observed.
    expect(profile.profile[codingItem.skillId]).not.toBe("observed");
  });

  it("marks every response of an old-format session legacy and zeroes its quota contribution", () => {
    let session = createDiagnosticSession();
    session = answerCurrentCorrectly(session);
    const oldFormat = { ...session, formatVersion: "0.9.0", codingSuccessCount: 2 };
    expect(oldFormat.responses.every(r => !r.legacy)).toBe(true);

    const marked = markLegacyDiagnosticSession(oldFormat);

    expect(marked.formatVersion).toBe("0.9.0");
    expect(marked.id).toBe(session.id);
    expect(marked.responses).toHaveLength(1);
    expect(marked.responses.every(r => r.legacy)).toBe(true);
    expect(marked.codingSuccessCount).toBe(0);
    // Legacy responses cannot make a skill observed.
    expect(deriveDiagnosticProfile(marked).profile[marked.responses[0].skillId]).not.toBe("observed");
  });

  it("leaves current-format sessions untouched", () => {
    const session = answerCurrentCorrectly(createDiagnosticSession());
    expect(markLegacyDiagnosticSession(session)).toBe(session);
  });
});

describe("completed sessions are immutable and retakes create new sessions", () => {
  it("refuses to record on a completed session", () => {
    const completed = completeDiagnosticSession(runConfidentPath());
    const current = byId.get(completed.currentItemId ?? DIAGNOSTIC_ITEMS[0].id)!;
    expect(() => answerConcept(completed, current, "x", alwaysCorrect)).toThrow(/completed/i);
    expect(() => recordCodingOutcome(completed, current, { kind: "graded", passed: true, executionOk: true, graderVersion: "1.0.0" }, "x")).toThrow(/completed/i);
  });

  it("gives each retake a fresh id", () => {
    const first = createDiagnosticSession();
    const second = createDiagnosticSession();
    expect(first.id).not.toBe(second.id);
  });

  it("never fabricates mission completion or mastery", () => {
    const completed = completeDiagnosticSession(runConfidentPath());
    const keys = Object.keys(completed);
    for (const forbidden of ["attempts", "missionRuns", "mastery", "missionsCompleted"]) {
      expect(keys, `session must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("draft preservation", () => {
  it("keeps answer, code, and hints through a JSON round-trip (reload)", () => {
    const session = createDiagnosticSession();
    const withDraft = { ...session, draftAnswer: "partial answer", draftCode: "partial code", draftHints: 2 };
    const reloaded = JSON.parse(JSON.stringify(withDraft)) as DiagnosticSession;
    expect(reloaded.draftAnswer).toBe("partial answer");
    expect(reloaded.draftCode).toBe("partial code");
    expect(reloaded.draftHints).toBe(2);
    expect(reloaded.currentItemId).toBe(session.currentItemId);
  });
  it("saves drafts without recording a response", () => {
    const session = createDiagnosticSession();
    const saved = saveDiagnosticDraft(session, { answer: "a", code: "c", hints: 1 });
    expect(saved.draftAnswer).toBe("a");
    expect(saved.draftCode).toBe("c");
    expect(saved.draftHints).toBe(1);
    expect(saved.responses).toHaveLength(0);
    expect(saved.currentItemId).toBe(session.currentItemId);
    // Partial updates keep the other fields.
    const partial = saveDiagnosticDraft(saved, { code: "c2" });
    expect(partial.draftAnswer).toBe("a");
    expect(partial.draftCode).toBe("c2");
  });
  it("refuses draft changes on a completed session", () => {
    const completed = { ...createDiagnosticSession(), status: "completed" as const };
    expect(() => saveDiagnosticDraft(completed, { answer: "x" })).toThrow(/immutable/i);
  });
});

describe("profile derivation", () => {
  it("marks untouched skills untested", () => {
    const session = createDiagnosticSession();
    const profile = deriveDiagnosticProfile(session);
    for (const skillId of DIAGNOSTIC_CORE_SKILLS) expect(profile.profile[skillId]).toBe("untested");
  });

  it("coding quota constant is positive", () => {
    expect(DIAGNOSTIC_CODING_QUOTA).toBeGreaterThan(0);
  });
});

describe("explicit I do not know declarations", () => {
  it("matches only answers that open with the declaration", () => {
    for (const phrase of ["I do not know", "i don't know", "I do not know.", "I do not know the answer!", "I do not know how to approach this"]) {
      expect(isUnknownDeclaration(phrase), phrase).toBe(true);
    }
    for (const phrase of ["", "no", "9", "Not sure — maybe 9", "I know this one", "unknown"]) {
      expect(isUnknownDeclaration(phrase), phrase).toBe(false);
    }
  });

  it("records a concept declaration without ever invoking the grader", () => {
    const session = createDiagnosticSession();
    const item = byId.get(session.currentItemId!)!;
    expect(item.kind).toBe("concept");
    const graderCalls: string[] = [];
    const spy: ConceptGrader = (itemId, answer) => {
      graderCalls.push(`${itemId}:${answer}`);
      return { correct: true, detail: "must never run for a declaration" };
    };
    const next = answerConcept(session, item, DIAGNOSTIC_UNKNOWN_ANSWER, spy);
    expect(graderCalls).toHaveLength(0);
    const response = next.responses[0];
    expect(response.dontKnow).toBe(true);
    expect(response.correct).toBe(false);
    expect(response.answer).toBe(DIAGNOSTIC_UNKNOWN_ANSWER);
    expect(response.respondedAt).toBeTruthy();
    expect(next.currentItemId).not.toBe(item.id);
    expect(next.draftAnswer).toBe("");
    expect(next.draftHints).toBe(0);
  });

  it("treats a typed declaration as a gap and a near-miss sentence as graded", () => {
    const session = createDiagnosticSession();
    const item = byId.get(session.currentItemId!)!;
    const graded: string[] = [];
    const grader: ConceptGrader = (_id, answer) => { graded.push(answer); return { correct: true, detail: "ok" }; };

    const declared = answerConcept(session, item, "I do not know, honestly", grader);
    expect(graded).toHaveLength(0);
    expect(declared.responses[0].dontKnow).toBe(true);
    expect(declared.responses[0].correct).toBe(false);

    const current = byId.get(declared.currentItemId!)!;
    const answered = answerConcept(declared, current, "Not sure — maybe 9", grader);
    expect(graded).toEqual(["Not sure — maybe 9"]);
    expect(answered.responses[1].dontKnow).toBeFalsy();
    expect(answered.responses[1].correct).toBe(true);
  });

  it("records a coding declaration with draft code preserved and no execution", () => {
    let session = createDiagnosticSession();
    let guard = 0;
    while (session.currentItemId && byId.get(session.currentItemId)!.kind !== "coding" && guard++ < 20) {
      session = answerConcept(session, byId.get(session.currentItemId)!, "stub", alwaysCorrect);
    }
    const codingItem = byId.get(session.currentItemId!)!;
    expect(codingItem.kind).toBe("coding");
    session = saveDiagnosticDraft(session, { code: "def solve():  # my attempt", hints: 2 });
    const before = session.codingSuccessCount;

    const next = markUnknown(session, codingItem);

    const response = next.responses.at(-1)!;
    expect(response.kind).toBe("coding");
    expect(response.dontKnow).toBe(true);
    expect(response.correct).toBe(false);
    expect(response.code).toBe("def solve():  # my attempt");
    expect(response.hintsUsed).toBe(2);
    expect(response.graderVersion).toBeNull();
    expect(next.codingSuccessCount).toBe(before);
    expect(next.currentItemId).not.toBe(codingItem.id);
    expect(next.infraError).toBeNull();
  });

  it("counts distinct current-format coding declarations and ignores legacy ones", () => {
    const session = syntheticSession([
      { skillId: "python-functions", kind: "coding", correct: false, itemId: "diag-fn-callforms", dontKnow: true },
      { skillId: "python-functions", kind: "coding", correct: false, itemId: "diag-fn-callforms", dontKnow: true },
      { skillId: "file-io", kind: "coding", correct: false, itemId: "diag-file-with", dontKnow: true },
      { skillId: "http-reliability", kind: "coding", correct: false, itemId: "diag-http-success", dontKnow: true, legacy: true },
    ]);
    expect(codingUnknownCount(session)).toBe(2);
  });

  it("lets two honest coding declarations satisfy the coding gate without any run", () => {
    const parts: SyntheticResponse[] = [];
    // Five skills observed with two correct answers each.
    DIAGNOSTIC_CORE_SKILLS.slice(2, 7).forEach(skillId => {
      parts.push({ skillId, kind: "concept", correct: true });
      parts.push({ skillId, kind: "concept", correct: true });
    });
    // One skill observed as a pure knowledge gap: two honest declarations.
    parts.push({ skillId: DIAGNOSTIC_CORE_SKILLS[0], kind: "coding", correct: false, dontKnow: true });
    parts.push({ skillId: DIAGNOSTIC_CORE_SKILLS[0], kind: "coding", correct: false, dontKnow: true });
    // One skill still genuinely uncertain (the early-stop gate needs it).
    parts.push({ skillId: DIAGNOSTIC_CORE_SKILLS[7], kind: "concept", correct: true });

    const allDecided = syntheticSession(parts);
    expect(allDecided.responses.length).toBe(13);
    expect(allDecided.codingSuccessCount).toBe(0);
    expect(codingUnknownCount(allDecided)).toBe(DIAGNOSTIC_CODING_QUOTA);
    const check = canCompleteDiagnostic(allDecided);
    expect(check.ok).toBe(true);
    expect(check.reasons.join(" ")).not.toMatch(/coding/i);
    const completed = completeDiagnosticSession(allDecided);
    // The declaration places its skill as a knowledge gap, never as mastery.
    expect(completed.profile![DIAGNOSTIC_CORE_SKILLS[0]]).toBe("observed");
    expect(completed.recommendation).toContain("useful gaps, not mistakes");
  });

  it("still blocks completion when declarations fall short of the quota", () => {
    const parts: SyntheticResponse[] = [];
    DIAGNOSTIC_CORE_SKILLS.slice(2, 7).forEach(skillId => {
      parts.push({ skillId, kind: "concept", correct: true });
      parts.push({ skillId, kind: "concept", correct: true });
    });
    // One observed skill mixing a wrong answer with a single declaration —
    // evidence exists, but only one of the two required declarations.
    parts.push({ skillId: DIAGNOSTIC_CORE_SKILLS[0], kind: "concept", correct: false });
    parts.push({ skillId: DIAGNOSTIC_CORE_SKILLS[0], kind: "coding", correct: false, dontKnow: true });
    parts.push({ skillId: DIAGNOSTIC_CORE_SKILLS[7], kind: "concept", correct: true });

    const session = syntheticSession(parts);
    expect(codingUnknownCount(session)).toBe(1);
    expect(session.codingSuccessCount).toBe(0);
    const check = canCompleteDiagnostic(session);
    expect(check.ok).toBe(false);
    expect(check.reasons.join(" ")).toMatch(/coding/i);
    expect(() => completeDiagnosticSession(session)).toThrow(/coding/i);
  });

  it("never re-serves a coding item already declared unknown, but retries graded failures", () => {
    const twoConceptIds = (skillId: string) =>
      DIAGNOSTIC_ITEMS.filter(i => i.skillId === skillId && i.kind === "concept").slice(0, 2).map(i => i.id);
    const responses: SyntheticResponse[] = [];
    // Eight skills observed with two correct concept answers each.
    for (const skillId of DIAGNOSTIC_CORE_SKILLS.filter(id =>
      id !== "python-functions" && id !== "http-reliability" && id !== "file-io")) {
      const [a, b] = twoConceptIds(skillId);
      responses.push({ skillId, kind: "concept", correct: true, itemId: a });
      responses.push({ skillId, kind: "concept", correct: true, itemId: b });
    }
    // Three skills observed through a wrong concept + their coding item: one
    // declared and two graded failures, so the two-piece coding evidence
    // quota is still unmet and the failed items stay in play.
    const special: [string, string, boolean][] = [
      ["python-functions", "diag-fn-callforms", true],
      ["http-reliability", "diag-http-success", false],
      ["file-io", "diag-file-with", false],
    ];
    for (const [skillId, codingId, declared] of special) {
      responses.push({ skillId, kind: "concept", correct: false, itemId: twoConceptIds(skillId)[0] });
      responses.push({ skillId, kind: "coding", correct: false, itemId: codingId, dontKnow: declared });
    }
    const declaredIds = ["diag-fn-callforms", "diag-http-success", "diag-file-with"];

    // One declaration: one graded failure is re-offered for an honest retry
    // while the quota is unmet; the declared item is never served again.
    const withFailure = syntheticSession(responses);
    expect(withFailure.responses.length).toBeLessThan(DIAGNOSTIC_MAX_ITEMS);
    expect(codingUnknownCount(withFailure)).toBe(1);
    expect(withFailure.codingSuccessCount).toBe(0);
    const retry = nextDiagnosticItem(withFailure);
    expect(retry?.id).toBe("diag-http-success");

    // A second declaration completes the two-piece quota: the engine stops
    // forcing coding questions and falls through to a fresh concept.
    const evidenceMet = syntheticSession(responses.map(r =>
      r.itemId === "diag-http-success" ? { ...r, dontKnow: true } : r));
    expect(codingUnknownCount(evidenceMet)).toBe(DIAGNOSTIC_CODING_QUOTA);
    const afterEvidence = nextDiagnosticItem(evidenceMet);
    expect(afterEvidence).not.toBeNull();
    expect(declaredIds).not.toContain(afterEvidence!.id);
    expect(afterEvidence!.kind).toBe("concept");

    // All three declared: nothing coding is re-served — the engine falls
    // through to a fresh concept while the other gates finish.
    const allDeclared = syntheticSession(responses.map(r =>
      r.itemId === "diag-http-success" || r.itemId === "diag-file-with" ? { ...r, dontKnow: true } : r));
    expect(codingUnknownCount(allDeclared)).toBe(3);
    const next = nextDiagnosticItem(allDeclared);
    expect(next).not.toBeNull();
    expect(declaredIds).not.toContain(next!.id);
    expect(next!.kind).toBe("concept");
  });
});

describe("honest evidence: gaps, wrong answers, and hints", () => {
  it("splits per-skill evidence and keeps pure gaps out of the wrong-answer list", () => {
    const session = syntheticSession([
      { skillId: "csp-foundations", kind: "concept", correct: true, hintsUsed: 0 },
      { skillId: "csp-foundations", kind: "concept", correct: true, hintsUsed: 2 },
      { skillId: "csp-data-systems", kind: "concept", correct: false },
      { skillId: "csp-data-systems", kind: "concept", correct: false, dontKnow: true },
      { skillId: "json-validation", kind: "concept", correct: false, dontKnow: true },
      { skillId: "json-validation", kind: "concept", correct: false, dontKnow: true },
      { skillId: "python-functions", kind: "concept", correct: true, hintsUsed: 1 },
    ]);
    const { evidence, knowledgeGaps, hintDependent, recommendation } = deriveDiagnosticProfile(session);

    expect(evidence["csp-foundations"]).toEqual({ independent: 1, hinted: 1, wrong: 0, unknown: 0 });
    expect(evidence["csp-data-systems"]).toEqual({ independent: 0, hinted: 0, wrong: 1, unknown: 1 });
    expect(evidence["json-validation"]).toEqual({ independent: 0, hinted: 0, wrong: 0, unknown: 2 });
    expect(evidence["python-functions"]).toEqual({ independent: 0, hinted: 1, wrong: 0, unknown: 0 });
    expect(evidence["csv-cleaning"]).toEqual({ independent: 0, hinted: 0, wrong: 0, unknown: 0 });

    expect(knowledgeGaps).toContain("json-validation");
    expect(knowledgeGaps).not.toContain("csp-data-systems"); // mixed: has a wrong answer too
    expect(hintDependent).toContain("python-functions");
    expect(hintDependent).not.toContain("csp-foundations"); // one independent correct answer

    // Preserve each original classification assertion through structured data
    // and learner-facing skill titles instead of exposing raw ids in copy.
    expect(knowledgeGaps).toContain("json-validation");
    expect(knowledgeGaps).not.toContain("csp-data-systems");
    expect(hintDependent).toContain("python-functions");
    expect(hintDependent).not.toContain("csp-foundations");
    expect(evidence["csp-data-systems"].wrong).toBeGreaterThan(0);
    expect(evidence["python-functions"].hinted).toBeGreaterThan(0);
    expect(recommendation).toContain("useful gaps, not mistakes");
    expect(recommendation).toContain("Some areas could use more practice");
    expect(recommendation).not.toContain("json-validation");
    expect(recommendation).not.toContain("csp-data-systems");
    expect(recommendation).toContain("Hints helped in some areas");
  });

  it("reports the answer tally and current placement wording", () => {
    const session = syntheticSession([
      { skillId: "csp-foundations", kind: "concept", correct: true, hintsUsed: 0 },
      { skillId: "csp-foundations", kind: "concept", correct: true, hintsUsed: 2 },
      { skillId: "csp-data-systems", kind: "concept", correct: false },
      { skillId: "json-validation", kind: "concept", correct: false, dontKnow: true },
    ]);
    const { recommendation } = deriveDiagnosticProfile(session);
    expect(recommendation).toContain(
      'Answers: 1 correct on your own, 1 correct after hints, 1 incorrect, 1 declared "I do not know".',
    );
    expect(recommendation).toContain("Your scan starts with Python foundations");
    expect(recommendation).toContain("Your skill tree tracks learning over time");
  });
});

describe("versioned migration preserves stored sessions", () => {
  it("bumped the format version for the v2 bank and evidence fields", () => {
    expect(DIAGNOSTIC_SESSION_VERSION).not.toBe("1.0.0");
    expect(createDiagnosticSession().formatVersion).toBe(DIAGNOSTIC_SESSION_VERSION);
  });

  it("parses pre-v2 responses lacking dontKnow and keeps their evidence legacy, not current", () => {
    const stored = {
      id: "stored-v1", formatVersion: "1.0.0", status: "in-progress",
      startedAt: "2026-08-01T00:00:00.000Z", completedAt: null,
      responses: [{
        itemId: "diag-fn-loop-var", skillId: "python-functions", kind: "concept", correct: true,
        answer: "x", code: "", hintsUsed: 1, graderId: "diagnostic-concept-diag-fn-loop-var",
        graderVersion: null, legacy: false, respondedAt: "2026-08-01T00:05:00.000Z",
      }],
      currentItemId: "diag-fn-return", draftAnswer: "half typed", draftCode: "", draftHints: 1,
      codingSuccessCount: 0, infraError: null, profile: null, recommendation: null,
    };
    const parsed = diagnosticSessionSchema.safeParse(stored);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // The missing field is tolerated (no fabrication), and the whole session
    // survives a JSON round-trip the way browser storage persists it.
    expect(parsed.data.responses[0].dontKnow).toBeFalsy();
    const roundTripped = diagnosticSessionSchema.safeParse(JSON.parse(JSON.stringify(parsed.data)));
    expect(roundTripped.success).toBe(true);

    const migrated = markLegacyDiagnosticSession(parsed.data);
    expect(migrated.id).toBe("stored-v1");
    expect(migrated.draftAnswer).toBe("half typed");
    expect(migrated.responses).toHaveLength(1);
    expect(migrated.responses[0].answer).toBe("x");
    expect(migrated.responses[0].hintsUsed).toBe(1);
    expect(migrated.responses[0].legacy).toBe(true);
    // Stale evidence no longer counts toward placement.
    expect(diagnosticSkillState(migrated, "python-functions")).toBe("untested");
  });

  it("round-trips current-version declarations through the session schema", () => {
    let session = createDiagnosticSession();
    const item = byId.get(session.currentItemId!)!;
    session = markUnknown(session, item);
    const round = diagnosticSessionSchema.parse(JSON.parse(JSON.stringify(session)));
    expect(round.responses[0].dontKnow).toBe(true);
    expect(round.responses[0].correct).toBe(false);
    expect(markLegacyDiagnosticSession(round).responses[0].legacy).toBe(false);
  });
});

describe("two-piece coding evidence gate", () => {
  /** Five observed skills plus one still-uncertain skill at twelve responses:
   *  only the coding gate may block these sessions. */
  function readySession(extra: SyntheticResponse[]): DiagnosticSession {
    const parts: SyntheticResponse[] = [];
    DIAGNOSTIC_CORE_SKILLS.slice(2, 7).forEach(skillId => {
      parts.push({ skillId, kind: "concept", correct: true });
      parts.push({ skillId, kind: "concept", correct: true });
    });
    parts.push({ skillId: DIAGNOSTIC_CORE_SKILLS[7], kind: "concept", correct: true });
    parts.push(...extra);
    return syntheticSession(parts);
  }

  it("lets one successful run plus one distinct declaration satisfy the gate", () => {
    const session = readySession([
      { skillId: "http-reliability", kind: "coding", correct: true, itemId: "diag-http-success" },
      { skillId: "file-io", kind: "coding", correct: false, itemId: "diag-file-with", dontKnow: true },
    ]);
    expect(session.codingSuccessCount).toBe(1);
    expect(codingUnknownCount(session)).toBe(1);
    expect(codingEvidenceCount(session)).toBe(DIAGNOSTIC_CODING_QUOTA);
    const check = canCompleteDiagnostic(session);
    expect(check.ok, check.reasons.join("; ")).toBe(true);
    expect(completeDiagnosticSession(session).status).toBe("completed");
  });

  it("never counts hints, graded failures, or legacy runs as coding evidence", () => {
    const hintOnly = readySession([
      { skillId: "json-validation", kind: "concept", correct: true, hintsUsed: 2 },
    ]);
    expect(hintOnly.responses.at(-1)?.hintsUsed).toBe(2);
    const failedRun = readySession([
      { skillId: "http-reliability", kind: "coding", correct: false, itemId: "diag-http-success" },
    ]);
    const legacyRun = readySession([
      { skillId: "http-reliability", kind: "coding", correct: true, itemId: "diag-http-success", legacy: true },
    ]);

    for (const session of [hintOnly, failedRun, legacyRun]) {
      expect(session.responses.length).toBe(DIAGNOSTIC_MIN_ITEMS);
      expect(codingEvidenceCount(session)).toBe(0);
      const check = canCompleteDiagnostic(session);
      expect(check.ok).toBe(false);
      expect(check.reasons).toHaveLength(1);
      expect(check.reasons[0]).toMatch(/coding/i);
      expect(() => completeDiagnosticSession(session)).toThrow(/coding/i);
    }
  });

  it("does not let hints pad a lone declaration into the quota", () => {
    const session = readySession([
      { skillId: "file-io", kind: "coding", correct: false, itemId: "diag-file-with", dontKnow: true },
      { skillId: "json-validation", kind: "concept", correct: true, hintsUsed: 3 },
    ]);
    expect(codingUnknownCount(session)).toBe(1);
    expect(codingEvidenceCount(session)).toBe(1);
    const check = canCompleteDiagnostic(session);
    expect(check.ok).toBe(false);
    expect(check.reasons).toHaveLength(1);
    expect(check.reasons[0]).toMatch(/coding/i);
  });

  it("counts a successful run and a declaration only once each, on distinct coding items", () => {
    const sameItemTwice = syntheticSession([
      { skillId: "file-io", kind: "coding", correct: true, itemId: "diag-file-with" },
      { skillId: "file-io", kind: "coding", correct: false, itemId: "diag-file-with", dontKnow: true },
    ]);
    expect(codingEvidenceCount(sameItemTwice)).toBe(1);
    const twoItems = syntheticSession([
      { skillId: "file-io", kind: "coding", correct: true, itemId: "diag-file-with" },
      { skillId: "http-reliability", kind: "coding", correct: false, itemId: "diag-http-success", dontKnow: true },
    ]);
    expect(codingEvidenceCount(twoItems)).toBe(DIAGNOSTIC_CODING_QUOTA);
  });
});

describe("real-bank simulation: a learner who declares on every item", () => {
  it("serves two distinct coding questions and completes without a 25-item dead end", () => {
    let session = createDiagnosticSession(new Date("2026-09-13T12:00:00.000Z"));
    const served: string[] = [];
    let guard = 0;
    while (session.currentItemId && guard++ < DIAGNOSTIC_MAX_ITEMS + 5) {
      const item = byId.get(session.currentItemId)!;
      served.push(item.id);
      session = markUnknown(session, item);
    }
    // The engine, not the guard, stopped serving items — and it stopped well
    // before the 25-item cap, so the declaration path never dead-ends.
    expect(session.currentItemId).toBeNull();
    expect(session.responses).toHaveLength(served.length);
    expect(session.responses.length).toBeGreaterThanOrEqual(DIAGNOSTIC_MIN_ITEMS);
    expect(session.responses.length).toBeLessThan(DIAGNOSTIC_MAX_ITEMS);

    const codingServed = [...new Set(served.filter(id => byId.get(id)!.kind === "coding"))];
    expect(codingServed.length).toBeGreaterThanOrEqual(DIAGNOSTIC_CODING_QUOTA);
    expect(codingUnknownCount(session)).toBe(codingServed.length);
    expect(codingEvidenceCount(session)).toBe(codingServed.length);
    expect(session.codingSuccessCount).toBe(0);

    const check = canCompleteDiagnostic(session);
    expect(check.ok, check.reasons.join("; ")).toBe(true);
    const completed = completeDiagnosticSession(session);
    expect(completed.status).toBe("completed");
    // Every response is an honest knowledge gap: never a grade, never mastery.
    expect(completed.responses.every(r => r.dontKnow === true && !r.correct)).toBe(true);
    expect(completed.recommendation).not.toContain("Solid ground");
    expect(completed.recommendation).toContain("useful gaps, not mistakes");
    expect(completed.recommendation).not.toContain("csp-foundations");
  });

  it("serves coding questions from the real bank in a reachable order", () => {
    let session = createDiagnosticSession(new Date("2026-09-13T12:00:00.000Z"));
    const codingServed: string[] = [];
    let guard = 0;
    while (session.currentItemId && guard++ < DIAGNOSTIC_MAX_ITEMS + 5) {
      const item = byId.get(session.currentItemId)!;
      if (item.kind === "coding") codingServed.push(item.id);
      session = markUnknown(session, item);
    }
    expect(new Set(codingServed).size).toBeGreaterThanOrEqual(DIAGNOSTIC_CODING_QUOTA);
    for (const id of codingServed) expect(byId.get(id)?.kind).toBe("coding");
    // Two distinct coding questions arrive well before the item cap.
    const firstTwo = [...new Set(codingServed)].slice(0, DIAGNOSTIC_CODING_QUOTA);
    expect(firstTwo).toHaveLength(DIAGNOSTIC_CODING_QUOTA);
  });
});

describe("placement wording separates solid ground from assisted success", () => {
  it("keeps hint-only successes out of Solid ground and reports them as emerging", () => {
    const session = syntheticSession([
      { skillId: "python-functions", kind: "concept", correct: true, hintsUsed: 1 },
      { skillId: "python-functions", kind: "concept", correct: true, hintsUsed: 3 },
      { skillId: "data-structures", kind: "concept", correct: true, hintsUsed: 0 },
      { skillId: "data-structures", kind: "concept", correct: true, hintsUsed: 0 },
    ]);
    const { recommendation, hintDependent, evidence } = deriveDiagnosticProfile(session);

    expect(evidence["python-functions"]).toEqual({ independent: 0, hinted: 2, wrong: 0, unknown: 0 });
    expect(hintDependent).toContain("python-functions");
    expect(hintDependent).not.toContain("data-structures");

    expect(recommendation).toContain("strong signals in some areas");
    expect(recommendation).toContain("Hints helped in some areas");
    expect(recommendation).not.toContain("data-structures");
    expect(recommendation).not.toContain("python-functions");
  });

  it("still reports a mixed skill with unaided successes as solid ground", () => {
    const session = syntheticSession([
      { skillId: "csv-cleaning", kind: "concept", correct: true, hintsUsed: 0 },
      { skillId: "csv-cleaning", kind: "concept", correct: true, hintsUsed: 2 },
      { skillId: "csv-cleaning", kind: "concept", correct: true, hintsUsed: 0 },
    ]);
    const { recommendation, hintDependent } = deriveDiagnosticProfile(session);
    expect(hintDependent).not.toContain("csv-cleaning");
    expect(recommendation).toContain("strong signals in some areas");
  });
});
