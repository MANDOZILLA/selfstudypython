import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CORE_SKILLS,
  DIAGNOSTIC_ITEMS,
  diagnosticItemSchema,
  type DiagnosticItem,
} from "../curriculum/diagnostic-items";
import { getGrader } from "../public/grading/catalog.js";

const byId = new Map<string, DiagnosticItem>(DIAGNOSTIC_ITEMS.map(item => [item.id, item]));

describe("diagnostic item bank", () => {
  it("parses every item against the schema", () => {
    for (const item of DIAGNOSTIC_ITEMS) {
      const parsed = diagnosticItemSchema.safeParse(item);
      expect(parsed.success, `item ${item.id} failed schema`).toBe(true);
    }
  });

  it("authors at least 40 items with unique ids", () => {
    expect(DIAGNOSTIC_ITEMS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(DIAGNOSTIC_ITEMS.map(item => item.id)).size).toBe(DIAGNOSTIC_ITEMS.length);
  });

  it("covers every core skill with at least three items", () => {
    for (const skillId of DIAGNOSTIC_CORE_SKILLS) {
      const items = DIAGNOSTIC_ITEMS.filter(item => item.skillId === skillId);
      expect(items.length, `skill ${skillId} has too few items`).toBeGreaterThanOrEqual(3);
    }
  });

  it("includes the required exact semantic cases", () => {
    for (const id of [
      "diag-fn-isqrt-output", // ROOT(81) must fail
      "diag-fn-loop-var", // YTH must fail
      "diag-exc-catch", // "don't catch ValueError" must fail
      "diag-http-retry-after", // "don't wait for Retry-After" must fail
      "diag-ds-clean-value", // "False; name = name.strip()" must pass
    ]) {
      expect(byId.has(id), `missing required item ${id}`).toBe(true);
      expect(byId.get(id)?.kind).toBe("concept");
    }
  });

  it("includes the required coding items", () => {
    const coding = DIAGNOSTIC_ITEMS.filter(item => item.kind === "coding");
    expect(coding.length).toBeGreaterThanOrEqual(3);
    for (const id of ["diag-fn-callforms", "diag-http-success", "diag-file-with"]) {
      const item = byId.get(id);
      expect(item?.kind).toBe("coding");
      expect(item?.coding?.starterCode).toContain(item?.coding?.entryFunction ?? "__missing__");
    }
  });

  it("registers every coding item grader in the catalog with a matching version", () => {
    for (const item of DIAGNOSTIC_ITEMS.filter(item => item.kind === "coding")) {
      const grader = getGrader(item.coding!.exerciseId, item.coding!.graderId);
      expect(grader, `no catalog grader for ${item.id}`).toBeDefined();
      expect(grader!.requiredTests.length).toBeGreaterThan(0);
    }
  });

  it("gives every item a prompt and at least two hints", () => {
    for (const item of DIAGNOSTIC_ITEMS) {
      expect(item.prompt.trim().length, `${item.id} prompt`).toBeGreaterThan(10);
      expect(item.hints.length, `${item.id} hints`).toBeGreaterThanOrEqual(2);
    }
  });

  it("documents grading notes for every concept item", () => {
    for (const item of DIAGNOSTIC_ITEMS.filter(item => item.kind === "concept")) {
      expect(item.concept?.graderId, `${item.id} grader`).toBeTruthy();
      expect(item.concept?.gradingNotes.trim().length, `${item.id} notes`).toBeGreaterThan(10);
    }
  });
});
