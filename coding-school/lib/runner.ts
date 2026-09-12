import { failureResult, verifyWorkerResult } from "../public/grading/protocol.js";

export type GradeResult = ReturnType<typeof failureResult>;
export type GradeRequest = { type: "run"; requestId: string; exerciseId: string; graderId: string; files: Record<string, string> };
type WorkerTransport = Pick<Worker, "onmessage" | "onerror" | "onmessageerror" | "postMessage" | "terminate">;

export function startGradingRun(request: GradeRequest, onComplete: (result: GradeResult) => void, createWorker: () => WorkerTransport = () => new Worker("/python-worker.js", { type: "module" }), timeoutMs = 15000, onProgress?: (phase: "loading" | "running") => void): () => void {
  let active = true;
  let worker: WorkerTransport | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    active = false;
    clearTimeout(timeout);
    worker?.terminate();
  };
  const finish = (result: GradeResult) => {
    if (!active) return;
    cancel();
    onComplete(result);
  };
  try {
    worker = createWorker();
    timeout = setTimeout(() => finish(failureResult(request, "Timed out after 15 seconds. Your code is preserved; the worker was stopped.")), timeoutMs);
    worker.onmessage = ({ data }) => {
      if (!active) return;
      if (data?.type === "progress") {
        if (data.requestId === request.requestId && data.exerciseId === request.exerciseId && data.graderId === request.graderId && (data.phase === "loading" || data.phase === "running")) onProgress?.(data.phase);
        return;
      }
      const result = verifyWorkerResult(request, data);
      if (result) finish(result);
    };
    worker.onerror = () => finish(failureResult(request, "The Python worker failed to load or execute. Your code is preserved. Try again."));
    worker.onmessageerror = () => finish(failureResult(request, "The Python worker returned an unreadable response. Your code is preserved. Try again."));
    worker.postMessage(request);
  } catch (error) {
    finish(failureResult(request, `Could not start Python: ${String(error)}. Your code is preserved.`));
  }
  return cancel;
}
