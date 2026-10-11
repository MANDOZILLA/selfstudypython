import { describe, expect, it } from "vitest";
import {
  AP_CSP_FRAMEWORK,
  DIAGNOSTIC_CORE_SKILLS,
  DIAGNOSTIC_ITEMS,
  DIAGNOSTIC_SKILLS,
  diagnosticItemSchema,
  type DiagnosticItem,
} from "../curriculum/diagnostic-items";
import { DIAGNOSTIC_CODING_QUOTA, createDiagnosticSession, nextDiagnosticItem } from "../lib/diagnostic";
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

describe("AP CSP foundation tier", () => {
  const cspItems = DIAGNOSTIC_ITEMS.filter(item => item.skillId.startsWith("csp-"));

  it("places both CSP skills at the front so placement starts at AP CSP level", () => {
    expect(DIAGNOSTIC_CORE_SKILLS[0]).toBe("csp-foundations");
    expect(DIAGNOSTIC_CORE_SKILLS[1]).toBe("csp-data-systems");
    expect(DIAGNOSTIC_SKILLS[0].id).toBe("csp-foundations");
    expect(DIAGNOSTIC_SKILLS[1].id).toBe("csp-data-systems");
    const first = nextDiagnosticItem(createDiagnosticSession(new Date("2026-09-13T12:00:00.000Z")));
    expect(first?.skillId).toBe("csp-foundations");
    expect(first?.difficulty).toBe(1);
    expect(first?.kind).toBe("concept");
  });

  it("authors every CSP item with an official College Board big idea", () => {
    expect(cspItems.length).toBeGreaterThanOrEqual(6);
    const bigIdeas = new Set<string>();
    for (const item of cspItems) {
      expect(item.framework, `${item.id} framework`).toBeDefined();
      expect(AP_CSP_FRAMEWORK.bigIdeas).toContain(item.framework!.bigIdea);
      if (item.framework!.practice) expect(AP_CSP_FRAMEWORK.practices).toContain(item.framework!.practice);
      bigIdeas.add(item.framework!.bigIdea);
    }
    // The tier spans all five official big ideas, not just programming.
    expect(bigIdeas.size).toBe(AP_CSP_FRAMEWORK.bigIdeas.length);
    for (const bigIdea of AP_CSP_FRAMEWORK.bigIdeas) expect(bigIdeas).toContain(bigIdea);
  });

  it("uses the official College Board title for Big Idea 3 everywhere", () => {
    const official = "Big Idea 3: Algorithms and Programming";
    expect(AP_CSP_FRAMEWORK.bigIdeas).toContain(official);
    expect(AP_CSP_FRAMEWORK.bigIdeas).not.toContain("Big Idea 3: Algorithms and Programs");
    for (const item of DIAGNOSTIC_ITEMS) {
      const bigIdea = item.framework?.bigIdea;
      if (bigIdea?.startsWith("Big Idea 3")) expect(bigIdea, item.id).toBe(official);
    }
  });

  it("starts each CSP skill with difficulty-1 items before harder ones", () => {
    for (const skillId of ["csp-foundations", "csp-data-systems"] as const) {
      const skillItems = DIAGNOSTIC_ITEMS.filter(item => item.skillId === skillId);
      expect(skillItems.length).toBeGreaterThanOrEqual(3);
      expect(skillItems[0].difficulty).toBe(1);
      expect(skillItems.some(item => item.difficulty === 2)).toBe(true);
    }
  });

  it("keeps the coding quota reachable: enough coding items to declare or pass", () => {
    const coding = DIAGNOSTIC_ITEMS.filter(item => item.kind === "coding");
    expect(coding.length).toBeGreaterThanOrEqual(DIAGNOSTIC_CODING_QUOTA);
  });

  it("rejects a CSP item that omits its framework mapping", () => {
    const orphan = cspItems[0];
    const withoutFramework = { ...orphan, framework: undefined, id: "diag-csp-orphan" };
    const parsed = diagnosticItemSchema.safeParse(withoutFramework);
    expect(parsed.success).toBe(false);
  });
});
