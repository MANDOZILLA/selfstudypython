import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_SESSION_VERSION, PLACEMENT_LADDER, answerConcept, canCompleteDiagnostic,
  completeDiagnosticSession, createDiagnosticSession, derivePlacement, finishPlacementEarly,
  markLegacyDiagnosticSession, markUnknown, saveDiagnosticDraft,
} from "../lib/diagnostic";
import { DIAGNOSTIC_ITEMS } from "../curriculum/diagnostic-items";
import { gradeDiagnosticConcept } from "../lib/diagnostic-grading";

const item = (id: string) => DIAGNOSTIC_ITEMS.find(entry => entry.id === id)!;
const answer = (session: ReturnType<typeof createDiagnosticSession>, value: string) => {
  const current = item(session.currentItemId!);
  return answerConcept(session, current, value, gradeDiagnosticConcept, new Date("2026-01-01T00:00:00Z"));
};

describe("ladder placement", () => {
  it("uses curriculum order and climbs after two correct answers on a rung", () => {
    let session = createDiagnosticSession();
    expect(session.currentItemId).toBe("diag-csp-variable");
    session = answer(session, "6");
    expect(session.currentItemId).toBeTruthy();
    session = answer(session, session.currentItemId!.includes("print") ? "hello" : "float");
    expect(derivePlacement(session)).toMatchObject({ knownSkillIds: ["py-values"], gapSkillId: "py-conditionals" });
    expect(item(session.currentItemId!).skillId).toBe("py-conditionals");
  });

  it("stops at two wrong answers and treats one right plus one wrong as needing a third", () => {
    let session = createDiagnosticSession();
    session = answer(session, "wrong");
    const secondItem = item(session.currentItemId!);
    session = answer(session, secondItem.id.includes("print") ? "hello" : secondItem.id.includes("type") ? "float" : "6");
    expect(session.currentItemId).toBeTruthy();
    session = answer(session, "wrong");
    expect(derivePlacement(session).gapSkillId).toBe("py-values");
    expect(canCompleteDiagnostic(session).ok).toBe(true);
  });

  it("records I don't know as a gap and supports finishing early", () => {
    const session = createDiagnosticSession();
    const unknown = markUnknown(session, item(session.currentItemId!), new Date("2026-01-01T00:00:00Z"));
    expect(derivePlacement(unknown).gapSkillId).toBe("py-values");
    const completed = completeDiagnosticSession(unknown);
    expect(completed.status).toBe("completed");
    expect(completed.profile?.["py-values"]).toBe("observed");

    const fresh = createDiagnosticSession();
    const early = finishPlacementEarly(fresh, new Date("2026-01-02T00:00:00Z"));
    expect(early.status).toBe("completed");
    expect(derivePlacement(early).gapSkillId).toBe("py-values");
  });

  it("returns null gap after every rung passes and locks completed sessions", () => {
    let session = createDiagnosticSession();
    for (const skillId of PLACEMENT_LADDER) {
      const candidates = DIAGNOSTIC_ITEMS.filter(candidate => candidate.skillId === skillId && candidate.kind === "concept");
      for (const candidate of candidates.slice(0, 2)) {
        expect(session.currentItemId).toBe(candidate.id);
        session = answerConcept(session, candidate, "ok", () => ({ correct: true, detail: "ok" }));
      }
    }
    expect(derivePlacement(session).gapSkillId).toBe(null);
    const done = completeDiagnosticSession(session);
    expect(done.status).toBe("completed");
    expect(() => saveDiagnosticDraft(done, { answer: "edit" })).toThrow(/immutable/);
  });

  it("marks older versions legacy and excludes their responses from placement", () => {
    const session = createDiagnosticSession();
    const answered = answer(session, "6");
    const migrated = markLegacyDiagnosticSession({ ...answered, formatVersion: "2.0.0" });
    expect(migrated.responses.every(response => response.legacy)).toBe(true);
    expect(migrated.formatVersion).toBe("2.0.0");
    expect(derivePlacement(migrated)).toMatchObject({ knownSkillIds: [], gapSkillId: "py-values", testedSkillIds: [] });
    expect(DIAGNOSTIC_SESSION_VERSION).toBe("3.0.0");
  });
});
