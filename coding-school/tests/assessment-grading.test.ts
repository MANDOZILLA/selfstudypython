import { describe, expect, test } from "vitest";
import { gradeAssessmentWritten, hasWrittenGrader } from "../lib/assessment-grading";

describe("assessment written semantic grading", () => {
  test("every written challenge has a grader for each rubric criterion", () => {
    const cases: [string, string[]][] = [
      ["foundations-read-challenge", ["read-trace", "read-result", "read-contract"]],
      ["foundations-explain-challenge", ["explain-except", "explain-edge"]],
      ["data-read-challenge", ["read-value", "read-envelope"]],
      ["data-explain-challenge", ["explain-header", "explain-corruption"]],
      ["applied-read-challenge", ["read-exhaust", "read-client-error"]],
      ["applied-explain-challenge", ["explain-fallback", "explain-retry"]],
    ];
    for (const [exerciseId, criteria] of cases) {
      for (const criterion of criteria) {
        expect(hasWrittenGrader(exerciseId, criterion), `${exerciseId}/${criterion}`).toBe(true);
      }
      expect(hasWrittenGrader(exerciseId, "nope")).toBe(false);
    }
    expect(hasWrittenGrader("nope-challenge", "read-trace")).toBe(false);
  });

  test("unknown challenge or empty response yields failing checks, never a crash", () => {
    const raw = gradeAssessmentWritten("nope-challenge", "anything");
    expect(raw.executionOk).toBe(true);
    expect(raw.tests).toEqual([]);
    const empty = gradeAssessmentWritten("foundations-read-challenge", "   ");
    expect(empty.executionOk).toBe(true);
    expect(empty.tests.length).toBe(3);
    expect(empty.tests.every(t => t.passed === false)).toBe(true);
  });

  describe("foundations-read", () => {
    const g = (criterion: string, response: string) =>
      gradeAssessmentWritten("foundations-read-challenge", response).tests.find(t => t.id === criterion)!;
    test("read-trace: the colon-less line is skipped by the colon guard, not an except clause", () => {
      expect(g("read-trace", "The broken line is stripped, then the `if \":\" not in line` check skips it with continue — no exception is raised.").passed).toBe(true);
      expect(g("read-trace", "The line has no colon so the guard continues to the next line.").passed).toBe(true);
      expect(g("read-trace", "the `if ':' not in line` guard skips it — no try/except is involved").passed).toBe(true);
      expect(g("read-trace", "The broken line raises and the except clause skips it.").passed).toBe(false);
      expect(g("read-trace", "It crashes on the bad line.").passed).toBe(false);
    });
    test("read-result: the error level is counted twice", () => {
      expect(g("read-result", "counts['error'] == 2").passed).toBe(true);
      expect(g("read-result", "the error level appears twice").passed).toBe(true);
      expect(g("read-result", "counts['disk full'] == 2").passed).toBe(false);
      expect(g("read-result", "error appears three times").passed).toBe(false);
      expect(g("read-result", "it counts each line once").passed).toBe(false);
    });
    test("read-contract: log lines are counted per level", () => {
      expect(g("read-contract", "It counts how many log lines belong to each level (info, error, warn).").passed).toBe(true);
      expect(g("read-contract", "Messages are stripped of surrounding whitespace, then each distinct message is counted.").passed).toBe(false);
      expect(g("read-contract", "it counts lines").passed).toBe(false);
    });
  });

  describe("foundations-explain", () => {
    const g = (criterion: string, response: string) =>
      gradeAssessmentWritten("foundations-explain-challenge", response).tests.find(t => t.id === criterion)!;
    test("explain-except: int() raises ValueError, not KeyError", () => {
      expect(g("explain-except", "int('abc') raises ValueError, not KeyError, so the except clause must name ValueError.").passed).toBe(true);
      expect(g("explain-except", "Catching only KeyError misses the ValueError from int() on non-numeric ages.").passed).toBe(true);
      expect(g("explain-except", "KeyError handles the bad age.").passed).toBe(false);
    });
    test("explain-edge: names a concrete edge case and why it matters", () => {
      expect(g("explain-edge", "An empty input list should return [], otherwise callers crash on None.").passed).toBe(true);
      expect(g("explain-edge", "Duplicate rows matter because double-counting inflates the totals silently.").passed).toBe(true);
      expect(g("explain-edge", "It should handle edge cases.").passed).toBe(false);
    });
  });

  describe("data-read", () => {
    const g = (criterion: string, response: string) =>
      gradeAssessmentWritten("data-read-challenge", response).tests.find(t => t.id === criterion)!;
    test("read-value: the bad row is skipped, the good rows load", () => {
      expect(g("read-value", "[('7', 7.0), ('9', 9.0)] — the 'eight' row is skipped.").passed).toBe(true);
      expect(g("read-value", "[('7', 7.0), ('9', 9.0)]").passed).toBe(true);
      expect(g("read-value", "It returns all three rows.").passed).toBe(false);
      expect(g("read-value", "It returns 7, 8 and 9.").passed).toBe(false);
    });
    test("read-envelope: None has no split/strip, so it raises AttributeError", () => {
      expect(g("read-envelope", "load(None) raises AttributeError because None has no .strip() method.").passed).toBe(true);
      expect(g("read-envelope", "It returns an empty list.").passed).toBe(false);
    });
  });

  describe("data-explain", () => {
    const g = (criterion: string, response: string) =>
      gradeAssessmentWritten("data-explain-challenge", response).tests.find(t => t.id === criterion)!;
    test("explain-header: DictReader maps by header name, so reordering misaligns", () => {
      expect(g("explain-header", "DictReader maps columns by header name, so a reordered header puts amounts under the wrong keys.").passed).toBe(true);
      expect(g("explain-header", "Headers do not matter.").passed).toBe(false);
    });
    test("explain-corruption: names a corruption and a guard", () => {
      expect(g("explain-corruption", "A ragged row with an extra comma shifts every column; validate the field count per row.").passed).toBe(true);
      expect(g("explain-corruption", "Data is always clean.").passed).toBe(false);
    });
  });

  describe("applied-read", () => {
    const g = (criterion: string, response: string) =>
      gradeAssessmentWritten("applied-read-challenge", response).tests.find(t => t.id === criterion)!;
    test("read-exhaust: returns None after three attempts", () => {
      expect(g("read-exhaust", "None — it tries 3 times and then gives up.").passed).toBe(true);
      expect(g("read-exhaust", "It retries forever until it succeeds.").passed).toBe(false);
    });
    test("read-client-error: 400 returns immediately without retry", () => {
      expect(g("read-client-error", "fetch(400) returns the response right away; a 400 client error is not retried.").passed).toBe(true);
      expect(g("read-client-error", "It retries the 400 three times.").passed).toBe(false);
    });
    test("read-client-error: accepts semantically correct 'pointless to retry' phrasings", () => {
      expect(g("read-client-error", "Retrying a 400 is pointless — it's a client error.").passed).toBe(true);
      expect(g("read-client-error", "A 400 is returned without retrying; there is no point in retrying a client error.").passed).toBe(true);
      expect(g("read-client-error", "The 400 doesn't get retried — 400 < 500 so it returns immediately.").passed).toBe(true);
      expect(g("read-client-error", "400s dont get retried; the client error is returned as-is.").passed).toBe(true);
      expect(g("read-client-error", "Retry the 400 until it succeeds.").passed).toBe(false);
      expect(g("read-client-error", "Use exponential backoff on 400s.").passed).toBe(false);
      expect(g("read-client-error", "It retries the 400 three times, then returns None.").passed).toBe(false);
    });
    test("read-client-error: accepts active-voice 'do not retry' phrasings", () => {
      // Six must-pass natural correct phrasings (active voice).
      expect(g("read-client-error", "Don't retry a 400.").passed).toBe(true);
      expect(g("read-client-error", "You should not retry a 400.").passed).toBe(true);
      expect(g("read-client-error", "No retrying a 400 — it's a client error.").passed).toBe(true);
      expect(g("read-client-error", "400s should never be retried.").passed).toBe(true);
      expect(g("read-client-error", "A 400 isn't worth retrying.").passed).toBe(true);
      expect(g("read-client-error", "Don't bother retrying a 400.").passed).toBe(true);
      // Regression: previously accepted phrasings must keep passing.
      expect(g("read-client-error", "Retrying a 400 is pointless — it's a client error.").passed).toBe(true);
      expect(g("read-client-error", "The 400 doesn't get retried.").passed).toBe(true);
      expect(g("read-client-error", "400s are not worth retrying.").passed).toBe(true);
      // Wrong answers must keep failing.
      expect(g("read-client-error", "Retry the 400").passed).toBe(false);
      expect(g("read-client-error", "The 400 is retried with backoff").passed).toBe(false);
      expect(g("read-client-error", "Retry both").passed).toBe(false);
      expect(g("read-client-error", "A 400 means the server failed; retry it").passed).toBe(false);
    });
  });

  describe("applied-explain", () => {
    const g = (criterion: string, response: string) =>
      gradeAssessmentWritten("applied-explain-challenge", response).tests.find(t => t.id === criterion)!;
    test("explain-fallback: one bad line must not fail the batch", () => {
      expect(g("explain-fallback", "Without the fallback counter, one corrupt line would fail the whole batch and the accepted count would be nondeterministic.").passed).toBe(true);
      expect(g("explain-fallback", "Fallbacks do not matter.").passed).toBe(false);
    });
    test("explain-retry: retry the 429 rate limit, not the 400 client error", () => {
      expect(g("explain-retry", "Retry the 429 because it is a rate limit that may clear; retrying the 400 is pointless since the request itself is invalid.").passed).toBe(true);
      expect(g("explain-retry", "Retry the 429 — it is transient. Never retry the 400.").passed).toBe(true);
      expect(g("explain-retry", "Retry both statuses.").passed).toBe(false);
    });
  });
});
