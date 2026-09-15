/**
 * Semantic short-answer grading for the adaptive placement diagnostic's
 * concept items. Pure TypeScript — no DOM, no dependencies beyond the item
 * registry (used only to enumerate which ids have concept graders).
 *
 * Each item id maps to an item-specific semantic predicate. Deliberately
 * NOT keyword-bag scoring: predicates honor the gradingNotes on each item
 * (exact matches where the notes demand them, understood negation where
 * the notes demand it, and named equivalent phrasings otherwise).
 */
import { DIAGNOSTIC_ITEMS } from "../curriculum/diagnostic-items";

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
  return CONCEPT_IDS.has(itemId);
}

const pass = (detail: string): DiagnosticConceptResult => ({ correct: true, detail });
const fail = (detail: string): DiagnosticConceptResult => ({ correct: false, detail });

/** Negation tokens: when these appear, an answer cannot be affirmative. */
const NEGATED = /\b(don'?t|do not|cannot|can'?t|won'?t|shouldn'?t|never|not|no)\b/i;
/** Affirmative tokens. */
const AFFIRM = /\b(yes|yeah|yep|affirmative)\b/i;

/**
 * Affirmative yes/no answers with understood negation: negation anywhere
 * in the answer makes it wrong, and only an affirmative token makes it
 * right. Used where the notes require negation to be understood
 * (diag-exc-catch, diag-http-retry-after).
 */
function affirmativeAnswer(t: string): DiagnosticConceptResult {
  if (NEGATED.test(t)) return fail("the answer is negated");
  if (AFFIRM.test(t)) return pass("affirmative answer");
  return fail("expected an affirmative answer");
}

const GRADERS: Record<string, ConceptPredicate> = {
  // ---- python-functions ----
  "diag-fn-isqrt-output": t =>
    t === "9" ? pass("exact printed output") : fail("expected exactly '9', the exact printed output"),

  "diag-fn-loop-var": t =>
    t === "x" ? pass("loop variable is 'x'") : fail("expected exactly 'x', the loop variable name"),

  "diag-fn-return": t =>
    /\btotal\b/i.test(t) && !/\b(print|printed|printing)\b/i.test(t)
      ? pass("caller receives the value of total")
      : fail("expected the value of total, not printed text"),

  "diag-fn-default-arg": t =>
    /(evaluated|created)\s+once/i.test(t) ||
    /\bshared\b/i.test(t) ||
    /\bsame\s+(list|object|default)/i.test(t) ||
    /\bmutable\s+default/i.test(t) ||
    /\bpersist/i.test(t)
      ? pass("default created once and shared across calls")
      : fail("expected the shared mutable default: created once, reused across calls"),

  // ---- python-exceptions ----
  "diag-exc-catch": t => affirmativeAnswer(t),

  "diag-exc-bare": t =>
    /\beverything\b/i.test(t) ||
    /\bcatch-?all\b/i.test(t) ||
    (/(hid|mask|swallow)/i.test(t) && /\b(error|bug)/i.test(t)) ||
    /\b(keyboardinterrupt|systemexit)\b/i.test(t)
      ? pass("bare except catches everything, hiding real errors")
      : fail("expected: bare except catches everything, hiding real errors"),

  "diag-exc-finally": t =>
    /\bfinally\b/i.test(t) && !/\bexcept\b/i.test(t)
      ? pass("finally always runs")
      : fail("expected 'finally'"),

  "diag-exc-raise": t =>
    NEGATED.test(t)
      ? fail("negated answers are wrong")
      : /\braise\b/i.test(t)
        ? pass("raising makes the failure impossible to ignore")
        : fail("expected 'raise ValueError', not 'return -1'"),

  "diag-exc-chain": t =>
    /\boriginal\s+(exception|error)\b/i.test(t) ||
    /\bcause\b/i.test(t) ||
    /\bcontext\b/i.test(t) ||
    /\bfrom\s+err\b/i.test(t)
      ? pass("the original error's cause/context is preserved")
      : fail("expected the preserved original error (cause/context)"),

  // ---- data-structures ----
  "diag-ds-clean-value": t => {
    const parts = t.split(";");
    if (parts.length < 2) return fail("expected a compound answer: '<value>; <expression>'");
    const [valuePart, exprPart] = parts;
    const valueOk = /\bfalse\b/i.test(valuePart) && !/\btrue\b/i.test(valuePart);
    if (!valueOk) return fail("the value of clean is False");
    const exprOk = /\bname\s*\.\s*strip\s*\(\s*\)/.test(exprPart);
    if (!exprOk) return fail("the expression must call name.strip()");
    return pass("False; name.strip() — clean is False, cleaned name via strip");
  },

  "diag-ds-dict-get": t =>
    /\brow\s*\.\s*get\b/i.test(t)
      ? pass("row.get avoids KeyError")
      : fail("expected row.get('id')"),

  "diag-ds-comprehension": t =>
    /\blist\b/i.test(t) && !/\b(generator|none)\b/i.test(t)
      ? pass("a list comprehension builds a list")
      : fail("expected 'list'"),

  "diag-ds-mutation": t =>
    t.replace(/\s+/g, "") === "[1,2,3]"
      ? pass("b shares a's list, so a is [1, 2, 3]")
      : fail("expected '[1, 2, 3]' (shared reference)"),

  "diag-ds-sort-key": t =>
    /(sorted|sort)\s*\(/i.test(t) && /\bkey\b/i.test(t) && /\bamount\b/i.test(t) && /\breverse\s*=\s*true/i.test(t)
      ? pass("sorted with a key on 'amount' and reverse=True")
      : fail("expected sorted()/sort with a key on 'amount' and reverse=True"),

  // ---- csv-cleaning ----
  "diag-csv-header": t =>
    (/\bheader(s)?\b/i.test(t) || /\bfirst\s+row\b/i.test(t)) && !/\bposition\b/i.test(t)
      ? pass("DictReader keys rows by the header row")
      : fail("expected the header row"),

  "diag-csv-strip": t =>
    /\bstrip\b/i.test(t)
      ? pass("strip whitespace before Decimal")
      : fail("expected 'strip'"),

  "diag-csv-quoted": t =>
    /\bone\s+field\b/i.test(t) && !/\btwo\b/i.test(t)
      ? pass("quotes protect the comma: one field")
      : fail("expected 'one field'"),

  "diag-csv-empty": t =>
    NEGATED.test(t)
      ? fail("negated answers are wrong")
      : /\breject/i.test(t) && !/\bkeep\b/i.test(t)
        ? pass("missing amounts are invalid; never invent 0")
        : fail("expected 'rejected'"),

  // ---- json-validation ----
  "diag-json-loads": t =>
    /\blist\b/i.test(t) && !/\bdict\b/i.test(t)
      ? pass("json.loads('[1, 2]') returns a list")
      : fail("expected 'list'"),

  "diag-json-envelope": t =>
    /\bdict\b/i.test(t) && /\blist\b/i.test(t) && /\bpayments\b/i.test(t)
      ? pass("validate the envelope: dict with a 'payments' list")
      : fail("expected validation of the dict envelope and its 'payments' list"),

  "diag-json-decode-error": t =>
    /jsondecodeerror/i.test(t)
      ? pass("json.loads('{bad') raises JSONDecodeError")
      : fail("expected 'JSONDecodeError'"),

  "diag-json-types": t =>
    (/\bstrict\b/i.test(t) && /\btype\b/i.test(t)) ||
    (/\btruthiness\b/i.test(t) && /(\baccept\b|\breject\b|\btrue\b|\b1\b)/i.test(t))
      ? pass("strict type checks reject non-strings that truthiness accepts")
      : fail("expected strict type checking vs truthiness"),

  "diag-json-dumps": t =>
    /\bstr(ing)?\b/i.test(t) && !/\b(dict|bytes)\b/i.test(t)
      ? pass("json.dumps returns a string")
      : fail("expected 'string'"),

  // ---- financial-data ----
  "diag-money-decimal": t =>
    /\bfloat/i.test(t) && (/inexact/i.test(t) || /rounding/i.test(t) || /binary/i.test(t) || /0\.1\s*\+\s*0\.2/.test(t))
      ? pass("binary floating point is inexact for money")
      : fail("expected binary floating-point inexactness (e.g. 0.1 + 0.2)"),

  "diag-money-quantize": t =>
    /\bquantize\b/i.test(t)
      ? pass("quantize to Decimal('0.01')")
      : fail("expected 'quantize'"),

  "diag-money-negative": t =>
    NEGATED.test(t)
      ? fail("negated answers are wrong")
      : /\breject/i.test(t) && !/\b(accept|convert)/i.test(t)
        ? pass("negative payment amounts are rejected")
        : fail("expected 'rejected'"),

  "diag-money-currency": t =>
    (/\bupper\b/i.test(t) || /\buppercase\b/i.test(t)) && !/\blower\b/i.test(t)
      ? pass("normalize with upper()")
      : fail("expected 'upper()'"),

  // ---- http-reliability ----
  "diag-http-retry-after": t => affirmativeAnswer(t),

  "diag-http-2xx": t =>
    /\b2xx\b/i.test(t) && !/\b[13]xx\b/i.test(t)
      ? pass("2xx is the success family")
      : fail("expected '2xx'"),

  "diag-http-429": t =>
    /\b(no|wait|back\s*off)\b/i.test(t) && !/\byes\b/i.test(t)
      ? pass("do not retry immediately; wait / back off")
      : fail("expected 'no', with waiting/backing off"),

  "diag-http-timeout": t =>
    /\btimeout\b/i.test(t)
      ? pass("a timeout bounds how long you wait")
      : fail("expected 'timeout'"),

  // ---- file-io ----
  "diag-file-close": t =>
    /\bclose[sd]?\b/i.test(t)
      ? pass("with guarantees the file is closed")
      : fail("expected the file to be closed"),

  "diag-file-modes": t =>
    /\b(overwrite|truncate)/i.test(t) && !/\b(append|raise)/i.test(t)
      ? pass("'w' overwrites the existing file")
      : fail("expected 'overwrites'"),

  "diag-file-readlines": t =>
    /\blist\b/i.test(t) && !/\bstring\b/i.test(t)
      ? pass("readlines returns a list of lines")
      : fail("expected 'list'"),

  "diag-file-newline": t =>
    (/\\n/.test(t) || /\bnewline\b/i.test(t)) && /\b(r?strip)\b/i.test(t)
      ? pass("lines end with \\n, removed with strip/rstrip")
      : fail("expected the newline character and strip/rstrip"),

  // ---- llm-output-validation ----
  "diag-llm-schema": t =>
    /\bparse\b/i.test(t) && /\bvalidat/i.test(t)
      ? pass("parse, then validate against a schema")
      : fail("expected parse and validate"),

  "diag-llm-deterministic": t =>
    /\bnon-?deterministic\b/i.test(t) || /\bdifferent\s+shapes?\b/i.test(t)
      ? pass("output shape is nondeterministic across calls")
      : fail("expected nondeterminism across calls"),

  "diag-llm-fallback": t =>
    /\bfallback\b/i.test(t) && !/\b(guess|crash)\b/i.test(t)
      ? pass("use a deterministic fallback")
      : fail("expected the deterministic fallback"),
};

/**
 * Grade a short-answer concept response against the item's semantic rule.
 * @throws Error("unknown diagnostic concept item ...") for unknown ids.
 */
export function gradeDiagnosticConcept(itemId: string, answer: string): DiagnosticConceptResult {
  const grader = GRADERS[itemId];
  if (!grader || !CONCEPT_IDS.has(itemId)) {
    throw new Error(`unknown diagnostic concept item ${itemId}`);
  }
  return grader(answer.trim());
}
