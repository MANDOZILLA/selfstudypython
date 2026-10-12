import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_ITEMS } from "../curriculum/diagnostic-items";
import { gradeDiagnosticConcept, hasConceptGrader } from "../lib/diagnostic-grading";

/** Explanation items have no printed output; every other concept item answers with its own expectedOutput. */
const explanationAnswers: Record<string, string> = {
  "diag-csp-testing": "boundary cases around 60", "diag-file-write": "ab",
  "diag-http-429": "no, back off", "diag-http-timeout": "timeout",
};
const answerFor = (id: string) =>
  DIAGNOSTIC_ITEMS.find(item => item.id === id)?.concept?.expectedOutput ?? explanationAnswers[id] ?? "";
describe("semantic diagnostic concept graders", () => {
  it("registers and grades every concept item", () => {
    const concepts = DIAGNOSTIC_ITEMS.filter(item => item.kind === "concept");
    for (const item of concepts) {
      expect(hasConceptGrader(item.id), item.id).toBe(true);
      expect(gradeDiagnosticConcept(item.id, answerFor(item.id)).correct, item.id).toBe(true);
      expect(gradeDiagnosticConcept(item.id, "banana").correct, item.id).toBe(false);
    }
  });

  it("understands a declared unknown and rejects negated or contradictory answers", () => {
    expect(gradeDiagnosticConcept("diag-csp-boolean", "I do not know").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-exc-catch", "no, do not catch it").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-exc-catch", "yes, but do not catch it").correct).toBe(false);
    expect(gradeDiagnosticConcept("diag-conditionals-compare", "False").correct).toBe(false);
  });
});
