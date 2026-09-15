/**
 * Semantic short-answer grading for checkpoint-assessment read/explain tasks.
 * Pure TypeScript — no DOM, no dependencies beyond the grader catalog (used
 * only to enumerate which criteria exist and their versions).
 *
 * Each (exerciseId, criterion) maps to a semantic predicate. Deliberately NOT
 * keyword-bag scoring: predicates require the mechanism or the exact value
 * the rubric demands, and they reject answers that affirm a wrong value.
 */
import { graderCatalog } from "../public/grading/catalog.js";

export interface AssessmentWrittenCheck {
  id: string;
  name: string;
  required: true;
  passed: boolean;
  detail: string;
}

export interface AssessmentWrittenRaw {
  graderVersion: string;
  executionOk: true;
  tests: AssessmentWrittenCheck[];
}

type WrittenPredicate = (trimmed: string) => { correct: boolean; detail: string };

const pass = (detail: string) => ({ correct: true, detail });
const fail = (detail: string) => ({ correct: false, detail });

const GRADERS: Record<string, Record<string, WrittenPredicate>> = {
  "foundations-read-challenge": {
    "read-trace": t =>
      /\b(skipped|skips|continue|continues|except|catches)\b/i.test(t) &&
      /\b(malformed|broken|no colon|without.*colon|valueerror|bad (line|row))\b/i.test(t)
        ? pass("the malformed line is skipped via the except/continue path")
        : fail("explain which line is skipped and the except/continue mechanism that skips it"),
    "read-result": t =>
      /disk full/i.test(t) &&
      (/\b2\b/.test(t) || /\btwice\b/i.test(t)) &&
      !/\b(three|3 times|once)\b/i.test(t)
        ? pass("counts['disk full'] == 2")
        : fail("state the exact count for 'disk full'"),
    "read-contract": t =>
      /\b(strip|whitespace)\b/i.test(t) && /\b(count|each|distinct|per message|times)\b/i.test(t)
        ? pass("whitespace-stripped messages are counted")
        : fail("say what is stripped and what is counted"),
  },
  "foundations-explain-challenge": {
    "explain-except": t =>
      /valueerror/i.test(t) && /\bint\b/i.test(t)
        ? pass("int() raises ValueError, which the except clause must name")
        : fail("name the exception int() raises on a non-numeric age and where it must appear"),
    "explain-edge": t =>
      /\b(empty|duplicates?|malformed|zero|negative|whitespace|missing|none)\b/i.test(t) &&
      /\b(crash|crashes|wrong|silently|silent|matters?|guard|fail|breaks?|inflate)\b/i.test(t)
        ? pass("names a concrete edge case and why it matters")
        : fail("name one concrete edge case and explain why it matters"),
  },
  "data-read-challenge": {
    "read-value": t =>
      /\b7\b/.test(t) && /\b9\b/.test(t) && /\b(skip|skipped|eight)\b/i.test(t)
        ? pass("the bad row is skipped; the 7 and 9 rows load")
        : fail("say which rows load and which row is skipped"),
    "read-envelope": t =>
      /attributeerror/i.test(t) ||
      (/\bnone\b/i.test(t) && /\b(strip|split|crash|raises?|error)\b/i.test(t))
        ? pass("None has no strip/split, so it raises AttributeError")
        : fail("say what load(None) does and why"),
  },
  "data-explain-challenge": {
    "explain-header": t =>
      /header/i.test(t) && /\b(names?|reorder|reordered|misalign|wrong (keys|columns))\b/i.test(t)
        ? pass("DictReader maps by header name, so reordering misaligns values")
        : fail("explain how DictReader uses the header and what reordering breaks"),
    "explain-corruption": t =>
      /\b(ragged|extra comma|duplicates?|corrupt|whitespace|missing)\b/i.test(t) &&
      /\b(valid|validate|check|guard|skip|reject|count|field)\b/i.test(t)
        ? pass("names a corruption and a guard against it")
        : fail("name one way the input can be corrupt and how to guard against it"),
  },
  "applied-read-challenge": {
    "read-exhaust": t =>
      /\bnone\b/i.test(t) && (/\b3\b/.test(t) || /\bthree\b/i.test(t))
        ? pass("returns None after three attempts")
        : fail("say what is returned after the retries are exhausted and how many tries happen"),
    "read-client-error": t =>
      /\b400\b/.test(t) &&
      /\b(immediately|right away|not retried|without retry|no retry|returns? the response)\b/i.test(t)
        ? pass("a 400 returns immediately without retry")
        : fail("say whether the 400 is retried and why"),
  },
  "applied-explain-challenge": {
    "explain-fallback": t =>
      /fallback/i.test(t) && /\b(whole batch|entire batch|deterministic|one (bad|corrupt)|single|lose|fail the batch)\b/i.test(t)
        ? pass("one bad line must not fail the batch; the fallback count keeps it deterministic")
        : fail("explain what breaks without the fallback counter"),
    "explain-retry": t =>
      /\b429\b/.test(t) && /\b400\b/.test(t) &&
      /\b(rate limit|client error|pointless|won'?t succeed|invalid|temporary)\b/i.test(t)
        ? pass("retry the 429 rate limit, not the 400 client error")
        : fail("say which status is retried and why the other is not"),
  },
};

/** Criterion order per exercise, derived from the catalog's requiredTests. */
function criterionOrder(exerciseId: string): { graderVersion: string; criteria: string[] } | null {
  for (const grader of Object.values(graderCatalog)) {
    const entry = grader as { exerciseId: string; version: string; requiredTests: string[] };
    if (entry.exerciseId === exerciseId && GRADERS[exerciseId]) {
      return { graderVersion: entry.version, criteria: entry.requiredTests };
    }
  }
  return null;
}

/** True when (exerciseId, criterion) has a semantic written grader. */
export function hasWrittenGrader(exerciseId: string, criterion: string): boolean {
  return Boolean(GRADERS[exerciseId]?.[criterion]);
}

/**
 * Grade a written assessment response. Never throws: an unknown exercise
 * yields no checks, and every criterion degrades to failed on empty input.
 * The returned shape matches the Python suites' raw result so the same
 * aggregation and evidence pipeline applies.
 */
export function gradeAssessmentWritten(exerciseId: string, response: string): AssessmentWrittenRaw {
  const order = criterionOrder(exerciseId);
  if (!order) {
    return { graderVersion: "0.0.0", executionOk: true, tests: [] };
  }
  const trimmed = response.trim();
  const tests = order.criteria.map(id => {
    const predicate = GRADERS[exerciseId][id];
    const result = trimmed ? predicate(trimmed) : { correct: false, detail: "no response" };
    return {
      id,
      name: id.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      required: true as const,
      passed: result.correct,
      detail: result.detail,
    };
  });
  return { graderVersion: order.graderVersion, executionOk: true, tests };
}
