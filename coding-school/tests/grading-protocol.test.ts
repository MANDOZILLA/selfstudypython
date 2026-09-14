import { describe, expect, it } from "vitest";
import { aggregateResult, verifyWorkerResult } from "../public/grading/protocol.js";

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
    expect(verifyWorkerResult(request, passed)?.passed).toBe(true);
    expect(verifyWorkerResult(request, { ...passed, tests: [] })).toBeNull();
    for (const key of ["requestId", "exerciseId", "graderId"]) expect(verifyWorkerResult(request, { ...passed, [key]: "stale" })).toBeNull();
  });
});
