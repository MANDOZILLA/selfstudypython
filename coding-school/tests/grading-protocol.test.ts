import { describe, expect, it } from "vitest";
import { aggregateResult, failureResult, verifyWorkerResult } from "../public/grading/protocol.js";

const request = { type: "run", requestId: "current", exerciseId: "messy-csv-challenge", graderId: "payments-csv-v1", files: { "main.py": "" } };
const tests = ["concept-csv", "concept-decimal", "sample", "empty", "header", "precision", "invalid", "duplicates", "quoted", "shape"].map(id => ({ id, name: id, required: true, passed: true, detail: "" }));
describe("fail-closed aggregation", () => {
  it.each([null, {}, { executionOk: true, tests: [] }, { executionOk: true, tests: tests.slice(1) }, { executionOk: true, tests: [...tests, tests[0]] }, { executionOk: true, tests: tests.map(t => ({ ...t, passed: "true" })) }, { executionOk: false, tests }])("rejects malformed or unsuccessful results %#", raw => {
    expect(aggregateResult(request, raw).passed).toBe(false);
  });
  it("requires every behavioral and concept check", () => {
    for (let index = 0; index < tests.length; index++) {
      const result = aggregateResult(request, { executionOk: true, tests: tests.map((test, i) => ({ ...test, passed: i !== index })) });
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0.9);
    }
  });
  it("rejects forged pass flags and ignores stale IDs", () => {
    const passed = aggregateResult(request, { executionOk: true, tests });
    expect(verifyWorkerResult(request, passed)).toMatchObject({ passed: true });
    expect(verifyWorkerResult(request, { ...passed, tests: [] })).toMatchObject({ passed: false });
    for (const key of ["requestId", "exerciseId", "graderId"]) expect(verifyWorkerResult(request, { ...passed, [key]: "stale" })).toBeNull();
  });
  it("rejects grader version 0.0.0 as ignored instead of a failed attempt", () => {
    const passed = aggregateResult(request, { executionOk: true, tests });
    const zero = verifyWorkerResult(request, { ...passed, graderVersion: "0.0.0" });
    expect(zero).toMatchObject({ ignored: true, reason: "grader-version-mismatch" });
    // An ignored outcome must not be convertible into learner evidence.
    expect(zero).not.toHaveProperty("tests");
    expect(zero).not.toHaveProperty("passed", false);
  });
  it("ignores any other mismatched grader version without relabeling", () => {
    const passed = aggregateResult(request, { executionOk: true, tests });
    const stale = verifyWorkerResult(request, { ...passed, graderVersion: "9.9.9" });
    expect(stale).toMatchObject({ ignored: true });
    expect(aggregateResult(request, stale).passed).toBe(false);
  });
  it("validates optional sessionId and taskId when the request carries them", () => {
    const withSession = { ...request, sessionId: "session-1", taskId: "task-1" };
    const passed = aggregateResult(request, { executionOk: true, tests });
    expect(verifyWorkerResult(withSession, { ...passed, sessionId: "session-1", taskId: "task-1" })).toMatchObject({ passed: true });
    expect(verifyWorkerResult(withSession, { ...passed, sessionId: "stale", taskId: "task-1" })).toBeNull();
    expect(verifyWorkerResult(withSession, { ...passed, sessionId: "session-1", taskId: "stale" })).toBeNull();
    // Requests without session/task ids stay backward compatible.
    expect(verifyWorkerResult(request, passed)).toMatchObject({ passed: true });
  });
  it("echoes sessionId and taskId from the request into results so they verify", () => {
    const scoped = { ...request, sessionId: "session-1", taskId: "task-1" };
    const passed = aggregateResult(scoped, { executionOk: true, tests });
    expect(passed.sessionId).toBe("session-1");
    expect(passed.taskId).toBe("task-1");
    expect(verifyWorkerResult(scoped, passed)).toMatchObject({ passed: true });
    const failed = failureResult(scoped, "boom");
    expect(failed.sessionId).toBe("session-1");
    expect(failed.taskId).toBe("task-1");
    expect(verifyWorkerResult(scoped, failed)).toMatchObject({ passed: false });
  });
});
