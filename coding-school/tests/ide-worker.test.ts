import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadPyodide } from "pyodide";
import { resolve } from "node:path";
import { runSubmission } from "../public/grading/runner.js";
import {
  aggregateResult,
  executedResult,
  isSafeFileName,
  validRequest,
  verifyWorkerResult,
} from "../public/grading/protocol.js";
import { startGradingRun } from "../lib/runner";

let runtime: Awaited<ReturnType<typeof loadPyodide>>;
beforeAll(async () => {
  runtime = await loadPyodide({ indexURL: resolve("public/pyodide") });
}, 60000);
async function loadRuntime() { return runtime; }

// Structural view of the extended worker result: graded results carry the
// named tests plus structured execution and per-skill evidence; execute-mode
// results carry mode "executed" with an empty test list.
type IdeResult = {
  requestId: string;
  mode?: string;
  executionOk: boolean;
  passed: boolean;
  stdout: string;
  stderr: string;
  tests: { id: string; name: string; required: boolean; passed: boolean; detail: string }[];
  execution: { status: string; kind?: string; file?: string; line?: number; message?: string };
  skills: { skillId: string; passed: boolean; checkIds: string[] }[];
};

async function run(request: Record<string, unknown>): Promise<IdeResult> {
  const result = await runSubmission(request as never, loadRuntime);
  return result as unknown as IdeResult;
}
const execRequest = (files: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  type: "run" as const,
  requestId: `exec-${Math.random().toString(36).slice(2)}`,
  exerciseId: "ide-smoke",
  graderId: "ide-no-grader",
  files,
  entrypoint: "main.py",
  mode: "execute" as const,
  ...extra,
});

describe("IDE file-name safety", () => {
  it.each(["main.py", "helpers.py", "data/input.csv", "a-b_c.py", "pkg/sub/mod.py"])(
    "accepts safe project file %s",
    name => expect(isSafeFileName(name)).toBe(true),
  );
  it.each(["../../evil.py", "/abs.py", "a\\b.py", "", "a/../b.py", ".", "..", "a/.", 'a"b.py', "my file.py", "a//b.py"])(
    "rejects unsafe project file %s",
    name => expect(isSafeFileName(name)).toBe(false),
  );
});

describe("multi-file grading requests", () => {
  const legacy = {
    type: "run" as const, requestId: "legacy-1", exerciseId: "contacts-challenge",
    graderId: "contacts-v1", files: { "main.py": "def solve(r):\n    return []\n" },
  };
  it("still accepts the legacy single-file grade request", () => {
    expect(validRequest(legacy)).toBe(true);
  });
  it("accepts multiple files with an explicit entrypoint and fixtures", () => {
    expect(validRequest({
      ...legacy, requestId: "multi-1",
      files: { "main.py": "x = 1\n", "helpers.py": "y = 2\n" },
      entrypoint: "main.py",
      fixtures: { "data/input.csv": "a,b\n" },
    })).toBe(true);
  });
  it("accepts execute mode without a registered grader", () => {
    expect(validRequest(execRequest({ "main.py": "print('hi')\n" }))).toBe(true);
  });
  it.each([
    ["entrypoint missing from files", { entrypoint: "missing.py" }],
    ["fixtures colliding with a source file", { fixtures: { "main.py": "x\n" } }],
    ["path traversal in files", { files: { "../evil.py": "x\n" } }],
    ["absolute path in fixtures", { fixtures: { "/etc/passwd": "x\n" } }],
    ["unknown mode", { mode: "teleport" }],
    ["unregistered grader in grade mode", { graderId: "nope-v9", mode: "grade" }],
    ["no files at all", { files: {} }],
  ])("rejects invalid request: %s", (_label, patch) => {
    expect(validRequest({ ...legacy, requestId: `bad-${_label}`, ...patch })).toBe(false);
  });
});

describe("per-skill rubric evidence", () => {
  const request = {
    type: "run" as const, requestId: "skills-1", exerciseId: "contacts-challenge",
    graderId: "contacts-v1", files: { "main.py": "x\n" },
    skillChecks: { "python-functions": ["sample"], "data-structures": ["invalid"] },
  };
  const tests = ["sample", "empty", "invalid", "duplicates", "shape"].map(id => ({
    id, name: id, required: true, passed: id !== "invalid", detail: "",
  }));
  it("reports per-skill evidence derived from the named checks", () => {
    const result = aggregateResult(request, { executionOk: true, tests }) as unknown as IdeResult;
    expect(result.skills).toEqual([
      { skillId: "python-functions", passed: true, checkIds: ["sample"] },
      { skillId: "data-structures", passed: false, checkIds: ["invalid"] },
    ]);
  });
  it("always reports structured execution status", () => {
    expect((aggregateResult(request, { executionOk: true, tests }) as unknown as IdeResult).execution.status).toBe("ok");
    const failed = aggregateResult(request, { executionOk: false, tests, error: "boom" }) as unknown as IdeResult;
    expect(failed.execution.status).toBe("error");
  });
});

describe("execute-mode results", () => {
  it("builds an honest execution envelope", () => {
    const request = execRequest({ "main.py": "print(1)\n" });
    const ok = executedResult(request, { status: "ok" }, "1\n", "");
    expect(ok).toMatchObject({ mode: "executed", executionOk: true, passed: false, stdout: "1\n", tests: [], skills: [] });
    expect(ok.execution.status).toBe("ok");
    const broken = executedResult(request, { status: "error", kind: "syntax", file: "main.py", line: 2, message: "bad syntax" }, "", "");
    expect(broken.executionOk).toBe(false);
    expect(broken.execution).toMatchObject({ file: "main.py", line: 2 });
    expect(broken.stderr).toContain("main.py");
    expect(broken.stderr).toContain("line 2");
  });
  it("verifyWorkerResult accepts a matching execute-mode envelope without a grader", () => {
    const request = execRequest({ "main.py": "print(1)\n" });
    const envelope = executedResult(request, { status: "ok" }, "1\n", "");
    expect(verifyWorkerResult(request, envelope)).toBe(envelope);
  });
  it("verifyWorkerResult ignores execute results for other requests and rejects malformed ones", () => {
    const request = execRequest({ "main.py": "print(1)\n" });
    const envelope = executedResult(request, { status: "ok" }, "1\n", "");
    expect(verifyWorkerResult(request, { ...envelope, requestId: "other" })).toBeNull();
    const malformed = verifyWorkerResult(request, { ...envelope, execution: null });
    expect(malformed?.passed).toBe(false);
  });
});

describe("IDE execution with real Python", () => {
  it("imports across multiple files in grade mode", async () => {
    const files = {
      "main.py": `from contact_helpers import normalize_email
def solve(records):
    if type(records) is not list: return []
    result, seen = [], set()
    for row in records:
        if type(row) is not dict or type(row.get('email')) is not str: continue
        email = normalize_email(row['email'])
        if email is None or email in seen: continue
        seen.add(email)
        result.append(email)
    return result
`,
      "contact_helpers.py": `def normalize_email(value):
    email = value.strip().lower()
    parts = email.split('@')
    if len(parts) != 2 or not all(parts) or any(c.isspace() for c in email):
        return None
    return email
`,
    };
    const request = {
      type: "run" as const, requestId: `grade-multi-${Date.now()}`, exerciseId: "contacts-challenge",
      graderId: "contacts-v1", files, entrypoint: "main.py",
    };
    const passed = await run(request);
    expect(passed.passed).toBe(true);
    const broken = await run({ ...request, requestId: `grade-multi-broken-${Date.now()}`,
      files: { ...files, "contact_helpers.py": "def normalize_email(value):\n    return value.strip()\n" } });
    expect(broken.passed).toBe(false);
  }, 120000);

  it("runs the entrypoint in execute mode with stdout and stderr separated", async () => {
    const result = await run(execRequest({
      "main.py": "import sys\nprint('hello stdout')\nprint('hello stderr', file=sys.stderr)\n",
    }));
    expect(result.mode).toBe("executed");
    expect(result.executionOk).toBe(true);
    expect(result.execution.status).toBe("ok");
    expect(result.stdout).toContain("hello stdout");
    expect(result.stderr).toContain("hello stderr");
    expect(result.stdout).not.toContain("hello stderr");
    expect(result.tests).toEqual([]);
  }, 120000);

  it("identifies the file and line of a syntax error", async () => {
    const result = await run(execRequest({ "main.py": "def broken(:\n    pass\n" }));
    expect(result.executionOk).toBe(false);
    expect(result.execution.status).toBe("error");
    expect(result.execution.file).toBe("main.py");
    expect(result.execution.line).toBe(1);
  }, 120000);

  it("identifies the file and line of a runtime error inside an imported file", async () => {
    const result = await run(execRequest({
      "main.py": "from helpers import boom\nboom()\n",
      "helpers.py": "def boom():\n    raise ValueError('kaput')\n",
    }));
    expect(result.executionOk).toBe(false);
    expect(result.execution.file).toBe("helpers.py");
    expect(result.execution.line).toBe(2);
    expect(result.execution.message).toContain("kaput");
  }, 120000);

  it("materializes project fixtures for the entrypoint to read", async () => {
    const result = await run(execRequest(
      { "main.py": "print(open('data.csv', encoding='utf-8').read().strip())\n" },
      { fixtures: { "data.csv": "id,name\n1,ada\n" } },
    ));
    expect(result.executionOk).toBe(true);
    expect(result.stdout).toContain("1,ada");
  }, 120000);

  it("fails honestly on unsupported packages without hanging", async () => {
    const result = await run(execRequest({ "main.py": "import requests\nprint('nope')\n" }));
    expect(result.executionOk).toBe(false);
    expect(result.execution.status).toBe("error");
    expect(result.stderr).toContain("requests");
  }, 120000);

  it("keeps console output separate from grading checks", async () => {
    const files = {
      "main.py": `def solve(records):
    print('marker-print-123')
    return []
`,
    };
    const result = await run({
      type: "run", requestId: `sep-${Date.now()}`, exerciseId: "contacts-challenge",
      graderId: "contacts-v1", files, entrypoint: "main.py",
    });
    expect(result.stdout).toContain("marker-print-123");
    expect(result.tests.every(t => !t.detail.includes("marker-print-123"))).toBe(true);
  }, 120000);

  it("runs fully offline with a throwing fetch", async () => {
    const original = globalThis.fetch;
    (globalThis as { fetch: unknown }).fetch = () => { throw new Error("network disabled in test"); };
    try {
      const result = await run(execRequest({ "main.py": "print('offline ok')\n" }));
      expect(result.executionOk).toBe(true);
      expect(result.stdout).toContain("offline ok");
    } finally {
      globalThis.fetch = original;
    }
  }, 120000);
});

describe("IDE worker lifecycle", () => {
  class WorkerTransport {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminated = false;
    posted: unknown[] = [];
    postMessage(data: unknown) { this.posted.push(data); }
    terminate() { this.terminated = true; }
  }
  const request = {
    type: "run" as const, requestId: "ide-run-1", exerciseId: "ide-smoke",
    graderId: "ide-no-grader", files: { "main.py": "while True:\n    pass\n" },
    entrypoint: "main.py", mode: "execute" as const,
  };
  afterEach(() => vi.useRealTimers());

  it("times out a runaway worker without blocking the caller", () => {
    vi.useFakeTimers();
    const worker = new WorkerTransport();
    const completed = vi.fn();
    startGradingRun(request, completed, () => worker, 100);
    vi.advanceTimersByTime(100);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0]?.[0]?.passed).toBe(false);
    expect(completed.mock.calls[0]?.[0]?.stderr).toMatch(/timed out/i);
    expect(worker.terminated).toBe(true);
    // A late result from the dead worker is ignored.
    worker.onmessage?.({ data: { ...request, mode: "executed", executionOk: true, passed: false, score: 0, stdout: "x", stderr: "", tests: [], skills: [], execution: { status: "ok" } } });
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("recreates the worker after a timeout and runs successfully", () => {
    vi.useFakeTimers();
    const created: WorkerTransport[] = [];
    const completed = vi.fn();
    const factory = () => { const w = new WorkerTransport(); created.push(w); return w; };
    startGradingRun(request, completed, factory, 100);
    vi.advanceTimersByTime(100);
    expect(created).toHaveLength(1);
    expect(created[0]?.terminated).toBe(true);
    startGradingRun({ ...request, requestId: "ide-run-2" }, completed, factory, 100);
    expect(created).toHaveLength(2);
    const ok = { ...request, requestId: "ide-run-2", mode: "executed", executionOk: true, passed: false, score: 0, stdout: "done\n", stderr: "", tests: [], skills: [], execution: { status: "ok" } };
    created[1]?.onmessage?.({ data: ok });
    expect(completed).toHaveBeenCalledTimes(2);
    expect(completed.mock.calls[1]?.[0]?.executionOk).toBe(true);
    expect(created[1]?.terminated).toBe(true);
  });

  it("switching tasks suppresses the previous run's late result", () => {
    const first = new WorkerTransport();
    const completed = vi.fn();
    const cancel = startGradingRun(request, completed, () => first);
    cancel(); // task switch cancels the in-flight run
    first.onmessage?.({ data: { ...request, mode: "executed", executionOk: true, passed: false, score: 0, stdout: "late", stderr: "", tests: [], skills: [], execution: { status: "ok" } } });
    expect(completed).not.toHaveBeenCalled();
    expect(first.terminated).toBe(true);
  });

  it("prefers the request timeout over the default", () => {
    vi.useFakeTimers();
    const worker = new WorkerTransport();
    const completed = vi.fn();
    startGradingRun({ ...request, timeoutMs: 50 }, completed, () => worker, 15000);
    vi.advanceTimersByTime(49);
    expect(completed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(true);
  });
});
