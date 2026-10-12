/**
 * Semantic short-answer grading for the adaptive placement diagnostic's
 * concept items. Pure TypeScript — no DOM, no dependencies beyond the item
 * registry (used only to enumerate which ids have concept graders).
 *
 * Code-reading items carry their exact printed output (`expectedOutput`),
 * which tests verify by executing each snippet; they share one exact-output
 * grader. The few explanation items keep an item-specific predicate.
 */
import { DIAGNOSTIC_ITEMS } from "../curriculum/diagnostic-items";
import { isUnknownDeclaration } from "./diagnostic";

export interface DiagnosticConceptResult {
  correct: boolean;
  detail: string;
}

type ConceptPredicate = (trimmed: string) => DiagnosticConceptResult;

/** Every id in DIAGNOSTIC_ITEMS whose kind is "concept". */
const CONCEPT_IDS: ReadonlySet<string> = new Set(
  DIAGNOSTIC_ITEMS.filter(item => item.kind === "concept").map(item => item.id),
);

/** True when `itemId` is a concept item with a semantic grader. */
export function hasConceptGrader(itemId: string): boolean {
  return CONCEPT_IDS.has(itemId) && Object.hasOwn(GRADERS, itemId);
}

const pass = (detail: string): DiagnosticConceptResult => ({ correct: true, detail });
const fail = (detail: string): DiagnosticConceptResult => ({ correct: false, detail });

/**
 * Canonical form of a printed value, so harmless typing differences match:
 * quote style inside collections, spacing around punctuation, a comma typed
 * between two separately printed values (`print(a, b)` shows `a b`), and the
 * case of True/False/None. Quotes around the whole answer are NOT removed
 * (print shows strings without them), and commas inside brackets must stay.
 */
export function normalizeOutput(text: string): string {
  let depth = 0;
  let value = "";
  for (const char of text.trim().replace(/"/g, "'")) {
    if ("[{(".includes(char)) depth++;
    else if ("]})".includes(char)) depth--;
    value += char === "," && depth === 0 ? " " : char;
  }
  return value
    .replace(/\b(true|false|none)\b/gi, word => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .replace(/\s+/g, " ")
    .replace(/\s*([[\]{}():,])\s*/g, "$1")
    .trim();
}

/** Code-reading items: the answer must be the snippet's printed output. */
function outputGrader(expected: string, acceptAlso: readonly string[] = []): ConceptPredicate {
  const accepted = new Set([expected, ...acceptAlso].map(normalizeOutput));
  return trimmed => accepted.has(normalizeOutput(trimmed))
    ? pass(`the code prints ${expected}`)
    : fail(`expected the printed output ${expected}`);
}

/** The few explanation items that have no single printed output. */
const EXPLANATION_GRADERS: Record<string, ConceptPredicate> = {
  "diag-csp-testing": t =>
    /(boundar|edge)/i.test(t) ||
    (/\b59\b/.test(t) && /\b60\b/.test(t)) ||
    (/\b60\b/.test(t) && /\b61\b/.test(t))
      ? pass("boundary cases around 60 give the most confidence")
      : fail("expected boundary/edge cases around 60 (e.g. 59, 60, 61)"),

  "diag-file-write": t =>
    /^['"]?ab['"]?$/i.test(t) || (/\bappend/i.test(t) && !/\b(overwrite|replace)/i.test(t))
      ? pass("append mode adds b after the existing a")
      : fail("expected 'ab' (append mode keeps a and adds b)"),

  "diag-http-429": t =>
    /\b(no|wait|back\s*off|retry-after)\b/i.test(t) && !/\byes\b/i.test(t)
      ? pass("do not retry immediately; wait / back off")
      : fail("expected 'no', with waiting/backing off"),

  "diag-http-timeout": t =>
    /\btime\s*-?out\b/i.test(t)
      ? pass("a timeout bounds how long you wait")
      : fail("expected 'timeout'"),
};

const GRADERS: Record<string, ConceptPredicate> = Object.fromEntries(
  DIAGNOSTIC_ITEMS.flatMap(item => {
    if (item.kind !== "concept" || !item.concept) return [];
    const { expectedOutput, acceptAlso } = item.concept;
    const grader = expectedOutput ? outputGrader(expectedOutput, acceptAlso) : EXPLANATION_GRADERS[item.id];
    return grader ? [[item.id, grader] as const] : [];
  }),
);
/**
 * Grade a short-answer concept response against the item's semantic rule.
 * The explicit "I do not know" declaration is never a wrong answer: the
 * engine records it as a knowledge gap before grading, and if it reaches this
 * layer anyway it fails with a gap-specific detail, never a misconception one.
 * @throws Error("unknown diagnostic concept item ...") for unknown ids.
 */
export function gradeDiagnosticConcept(itemId: string, answer: string): DiagnosticConceptResult {
  const grader = GRADERS[itemId];
  if (!grader || !CONCEPT_IDS.has(itemId)) {
    throw new Error(`unknown diagnostic concept item ${itemId}`);
  }
  const trimmed = answer.trim();
  if (isUnknownDeclaration(trimmed)) {
    return { correct: false, detail: 'learner declared "I do not know" — knowledge gap, not a wrong answer' };
  }
  return grader(trimmed);
}
