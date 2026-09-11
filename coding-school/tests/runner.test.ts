import { afterEach, describe, expect, it, vi } from "vitest";
import { startGradingRun } from "../lib/runner";
import { aggregateResult } from "../public/grading/protocol.js";

class WorkerTransport {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  postMessage() {}
  terminate() { this.terminated = true; }
}
const request = { type: "run" as const, requestId: "run-1", exerciseId: "messy-csv-challenge", graderId: "payments-csv-v1", files: { "main.py": "unchanged source" } };
const required = ["concept-csv", "concept-decimal", "sample", "empty", "header", "precision", "invalid", "duplicates", "quoted", "shape"].map(id => ({ id, name: id, passed: true, required: true, detail: "" }));
afterEach(() => vi.useRealTimers());
describe("worker lifecycle", () => {
  it("ignores mismatched results then accepts the current verified result", () => {
    const worker = new WorkerTransport();
    const completed = vi.fn();
    startGradingRun(request, completed, () => worker);
    const passed = aggregateResult(request, { executionOk: true, tests: required });
    worker.onmessage?.({ data: { ...passed, requestId: "stale" } });
    expect(completed).not.toHaveBeenCalled();
    worker.onmessage?.({ data: passed });
    expect(completed.mock.calls[0]?.[0]?.passed).toBe(true);
    expect(worker.terminated).toBe(true);
  });
  it.each(["onerror", "onmessageerror"] as const)("reports %s as failed without changing files", event => {
    const worker = new WorkerTransport();
    const completed = vi.fn();
    startGradingRun(request, completed, () => worker);
    worker[event]?.();
    expect(completed.mock.calls[0]?.[0]?.passed).toBe(false);
    expect(request.files["main.py"]).toBe("unchanged source");
  });
  it("terminates timed out execution and ignores late success", () => {
    vi.useFakeTimers();
    const worker = new WorkerTransport();
    const completed = vi.fn();
    startGradingRun(request, completed, () => worker, 100);
    vi.advanceTimersByTime(100);
    expect(completed.mock.calls[0]?.[0]?.passed).toBe(false);
    expect(worker.terminated).toBe(true);
    worker.onmessage?.({ data: aggregateResult(request, { executionOk: true, tests: required }) });
    expect(completed).toHaveBeenCalledTimes(1);
  });
  it("cancellation suppresses old worker callbacks", () => {
    const worker = new WorkerTransport();
    const completed = vi.fn();
    const cancel = startGradingRun(request, completed, () => worker);
    cancel();
    worker.onerror?.();
    expect(completed).not.toHaveBeenCalled();
    expect(worker.terminated).toBe(true);
  });
  it("reports worker startup errors as failure", () => {
    const completed = vi.fn();
    startGradingRun(request, completed, () => { throw Error("unavailable"); });
    expect(completed.mock.calls[0]?.[0]?.executionOk).toBe(false);
  });
});
