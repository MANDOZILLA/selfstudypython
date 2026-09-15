import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODING_QUOTA,
  DIAGNOSTIC_MAX_ITEMS,
  DIAGNOSTIC_MIN_ITEMS,
  DIAGNOSTIC_SESSION_VERSION,
  answerConcept,
  canCompleteDiagnostic,
  classifyGradeResult,
  completeDiagnosticSession,
  createDiagnosticSession,
  deriveDiagnosticProfile,
  markLegacyDiagnosticSession,
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

  it("probes each core skill before repeating any skill", () => {
    let session = createDiagnosticSession();
    const seen = new Set<string>();
    for (let i = 0; i < DIAGNOSTIC_CORE_SKILLS.length; i++) {
      const current = nextDiagnosticItem(session)!;
      expect(seen.has(current.skillId), `skill ${current.skillId} repeated before breadth complete`).toBe(false);
      seen.add(current.skillId);
      session = answerCurrentCorrectly(session);
    }
    expect(seen.size).toBe(DIAGNOSTIC_CORE_SKILLS.length);
  });

  it("confident path stops at 12 or later and completes with an observed profile", () => {
    const session = runConfidentPath();
    expect(session.responses.length).toBeGreaterThanOrEqual(DIAGNOSTIC_MIN_ITEMS);
    expect(session.responses.length).toBeLessThanOrEqual(18);
    expect(nextDiagnosticItem(session)).toBeNull();
    const check = canCompleteDiagnostic(session);
    expect(check.ok).toBe(true);
    const completed = completeDiagnosticSession(session);
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeTruthy();
    const profile = deriveDiagnosticProfile(completed);
    for (const skillId of DIAGNOSTIC_CORE_SKILLS) expect(profile.profile[skillId]).toBe("observed");
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
