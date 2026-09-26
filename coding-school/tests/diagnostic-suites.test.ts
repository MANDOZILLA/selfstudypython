import { beforeAll, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import { resolve } from "node:path";
import { runSubmission } from "../public/grading/runner.js";
import { classifyGradeResult } from "../lib/diagnostic";

let runtime: Awaited<ReturnType<typeof loadPyodide>>;
beforeAll(async () => { runtime = await loadPyodide({ indexURL: resolve("public/pyodide") }); }, 60000);

async function grade(code: string, graderId: string, exerciseId: string) {
  return runSubmission({ type: "run", requestId: "diagnostic-test", exerciseId, graderId, files: { "main.py": code } }, async () => runtime);
}

type Graded = Awaited<ReturnType<typeof grade>>;
type GradedTest = { id: string; name: string; required: boolean; passed: boolean; detail: string };
function gradedTests(result: Graded): GradedTest[] {
  return (result.tests ?? []) as GradedTest[];
}
function failedIds(result: Graded): string[] {
  return gradedTests(result).filter((test) => !test.passed).map((test) => test.id);
}

// ---------- diagnostic-call-forms ----------

const callFormsReference = `import json
from math import ceil
def solve(payload):
    try:
        values = json.loads(payload)
    except (json.JSONDecodeError, TypeError):
        return []
    if type(values) is not list:
        return []
    return list(map(ceil, values))
`;

const callFormsKeyword = `import json
from math import ceil
def solve(payload):
    try:
        values = json.loads(s=payload)
    except (json.JSONDecodeError, TypeError):
        return []
    if type(values) is not list:
        return []
    return list(map(function=ceil, iterable=values))
`;

it("diagnostic-call-forms: reference solution passes", async () => {
  expect((await grade(callFormsReference, "diagnostic-call-forms-v1", "diagnostic-call-forms")).passed).toBe(true);
});

it("diagnostic-call-forms: keyword call forms earn concept credit", async () => {
  // Note: CPython's map() takes no keyword arguments, so map(function=..., iterable=...)
  // raises TypeError at runtime and the submission cannot pass behaviorally. The grader
  // still accepts (credits) the keyword call forms at the concept level.
  const result = await grade(callFormsKeyword, "diagnostic-call-forms-v1", "diagnostic-call-forms");
  const byId: Record<string, GradedTest> = Object.fromEntries(gradedTests(result).map((test) => [test.id, test]));
  expect(byId["concept-loads"].passed).toBe(true);
  expect(byId["concept-map"].passed).toBe(true);
  expect(byId["sample"].passed).toBe(false);
  expect(byId["sample"].detail).toMatch("keyword argument");
});

it("diagnostic-call-forms: rejects a decorative unused json.loads('[]')", async () => {
  const source = `import json
from math import ceil
def solve(payload):
    json.loads('[]')
    try:
        values = list(map(float, payload.strip('[]').split(',')))
    except ValueError:
        return []
    return list(map(ceil, values))
`;
  const result = await grade(source, "diagnostic-call-forms-v1", "diagnostic-call-forms");
  expect(result.passed).toBe(false);
  expect(failedIds(result)).toContain("concept-loads");
});

it("diagnostic-call-forms: rejects map with the wrong function", async () => {
  const source = callFormsReference.replace("return list(map(ceil, values))", "return list(map(str, values))");
  const result = await grade(source, "diagnostic-call-forms-v1", "diagnostic-call-forms");
  expect(result.passed).toBe(false);
  expect(failedIds(result)).toContain("concept-map");
  expect(failedIds(result)).toContain("sample");
});

it("diagnostic-call-forms: rejects a json.loads result that is assigned but never used", async () => {
  const source = `import json
from math import ceil
def solve(payload):
    try:
        data = json.loads(payload)
    except (json.JSONDecodeError, TypeError):
        data = None
    values = [1.2, 2.7, -0.5]
    return list(map(ceil, values))
`;
  const result = await grade(source, "diagnostic-call-forms-v1", "diagnostic-call-forms");
  expect(result.passed).toBe(false);
  expect(failedIds(result)).toContain("concept-loads");
});

// ---------- diagnostic-http ----------

const httpReference = `def is_success(status):
    return 200 <= status < 300
`;

it("diagnostic-http: reference solution passes", async () => {
  expect((await grade(httpReference, "diagnostic-http-v1", "diagnostic-http")).passed).toBe(true);
});

it.each([
  ["status == 200", "def is_success(status):\n    return status == 200", "boundary-299"],
  ["status >= 200", "def is_success(status):\n    return status >= 200", "boundary-300"],
  ["status > 200", "def is_success(status):\n    return status > 200", "boundary-200"],
])("diagnostic-http: rejects %s (fails %s)", async (_label, source, failingId) => {
  const result = await grade(source, "diagnostic-http-v1", "diagnostic-http");
  expect(result.passed).toBe(false);
  expect(failedIds(result)).toContain(failingId);
});

it("diagnostic-http: missing is_success fails closed", async () => {
  const result = await grade("def solve(status):\n    return True\n", "diagnostic-http-v1", "diagnostic-http");
  expect(result.passed).toBe(false);
  expect(result.executionOk).toBe(false);
});

// ---------- diagnostic-files ----------

const filesReference = `def read_lines(path):
    with open(path) as f:
        return f.read().splitlines()
`;

it("diagnostic-files: reference solution passes", async () => {
  expect((await grade(filesReference, "diagnostic-files-v1", "diagnostic-files")).passed).toBe(true);
});

it("diagnostic-files: rejects with nullcontext() plus manual open/close", async () => {
  const source = `from contextlib import nullcontext
def read_lines(path):
    with nullcontext():
        f = open(path)
        data = f.read()
        f.close()
    return data.splitlines()
`;
  const result = await grade(source, "diagnostic-files-v1", "diagnostic-files");
  expect(result.passed).toBe(false);
  expect(failedIds(result)).toContain("context-manager");
  expect(failedIds(result)).not.toContain("reads-lines");
});

it("diagnostic-files: rejects open without with", async () => {
  const source = `def read_lines(path):
    f = open(path)
    try:
        return f.read().splitlines()
    finally:
        f.close()
`;
  const result = await grade(source, "diagnostic-files-v1", "diagnostic-files");
  expect(result.passed).toBe(false);
  expect(failedIds(result)).toContain("context-manager");
});

it("diagnostic-files: rejects lines that keep their newlines", async () => {
  const source = `def read_lines(path):
    with open(path) as f:
        return f.readlines()
`;
  const result = await grade(source, "diagnostic-files-v1", "diagnostic-files");
  expect(result.passed).toBe(false);
  expect(failedIds(result)).toContain("reads-lines");
  expect(failedIds(result)).not.toContain("context-manager");
});

it("diagnostic-files: rejects swallowing FileNotFoundError", async () => {
  const source = `def read_lines(path):
    try:
        with open(path) as f:
            return f.read().splitlines()
    except FileNotFoundError:
        return []
`;
  const result = await grade(source, "diagnostic-files-v1", "diagnostic-files");
  expect(result.passed).toBe(false);
  expect(failedIds(result)).toContain("missing-file");
});

// ---------- broken learner submissions stay graded evidence, never infra ----------

it.each([
  ["diagnostic-call-forms-v1", "diagnostic-call-forms",
    "def solve(payload)\n    return []\n",
    ["concept-loads", "concept-map", "sample", "empty", "invalid"]],
  ["diagnostic-http-v1", "diagnostic-http",
    "def is_success(status)\n    return True\n",
    ["boundary-199", "boundary-200", "boundary-299", "boundary-300"]],
  ["diagnostic-files-v1", "diagnostic-files",
    "def read_lines(path)\n    return []\n",
    ["reads-lines", "context-manager", "missing-file"]],
])("%s: a syntax error yields a complete graded failure, not an infrastructure result",
  async (graderId, exerciseId, source, expectedIds) => {
    const result = await grade(source, graderId as string, exerciseId as string);
    expect(result.passed).toBe(false);
    expect(result.executionOk).toBe(false);
    // The full required check list must be present (all failed): a truncated
    // list would be converted to a single-"execution" infra result upstream,
    // silently discarding this genuine failed attempt.
    expect(gradedTests(result).map((test) => test.id).sort()).toEqual([...(expectedIds as string[])].sort());
    expect(gradedTests(result).every((test) => !test.passed)).toBe(true);
    expect(classifyGradeResult({ executionOk: result.executionOk, tests: gradedTests(result) })).toBe("graded");
  });

it("diagnostic-call-forms: a wrong entry function yields a complete graded failure", async () => {
  const result = await grade("def solution(payload):\n    return []\n", "diagnostic-call-forms-v1", "diagnostic-call-forms");
  expect(result.passed).toBe(false);
  expect(result.executionOk).toBe(false);
  expect(gradedTests(result).map((test) => test.id).sort()).toEqual(
    ["concept-loads", "concept-map", "empty", "invalid", "sample"]);
  expect(classifyGradeResult({ executionOk: result.executionOk, tests: gradedTests(result) })).toBe("graded");
});
