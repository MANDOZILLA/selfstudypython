import { failureResult, isSafeFileName, verifyWorkerResult } from "../public/grading/protocol.js";

export { isSafeFileName };
export type GradeResult = ReturnType<typeof failureResult> & {
  // Present on IDE results: "executed" for entrypoint runs, structured
  // execution status and per-skill rubric evidence on graded runs.
  mode?: string;
  execution?: { status: string; kind?: string; file?: string; line?: number; message?: string };
  skills?: { skillId: string; passed: boolean; checkIds: string[] }[];
};
export type IgnoredResult = { ignored: true; reason: string; requestId: string; exerciseId: string; graderId: string };
export type GradeRequest = { type: "run"; requestId: string; exerciseId: string; graderId: string; files: Record<string, string>; sessionId?: string; taskId?: string;
  // Multi-file IDE projects: entrypoint defaults to "main.py", fixtures are
  // readable project data (never submitted source), mode "execute" runs the
  // entrypoint without grading, skillChecks maps skill IDs to the named
  // checks that evidence them, and timeoutMs lets a task override the
  // client-side worker timeout.
  entrypoint?: string; fixtures?: Record<string, string>; mode?: "execute" | "grade";
  skillChecks?: Record<string, string[]>; timeoutMs?: number };
type WorkerTransport = Pick<Worker, "onmessage" | "onerror" | "onmessageerror" | "postMessage" | "terminate">;

export function startGradingRun(request: GradeRequest, onComplete: (result: GradeResult) => void, createWorker: () => WorkerTransport = () => new Worker("/python-worker.js", { type: "module" }), timeoutMs = 15000, onProgress?: (phase: "loading" | "running" | "packages") => void, onIgnored?: (ignored: IgnoredResult) => void): () => void {
  let active = true;
  let worker: WorkerTransport | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  // A task can carry its own timeout in the request (e.g. data-science tasks
  // that install packages); otherwise the caller-supplied default applies.
  // Either way the main thread enforces it and terminates the worker, so
  // runaway code can never freeze the UI.
  const effectiveTimeoutMs = request.timeoutMs ?? timeoutMs;
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
    timeout = setTimeout(() => finish(failureResult(request, `Timed out after ${effectiveTimeoutMs / 1000} seconds. Your code is preserved; the worker was stopped.`)), effectiveTimeoutMs);
    worker.onmessage = ({ data }) => {
      if (!active) return;
      if (data?.type === "progress") {
        if (data.requestId === request.requestId && data.exerciseId === request.exerciseId && data.graderId === request.graderId && (data.phase === "loading" || data.phase === "running" || data.phase === "packages")) onProgress?.(data.phase);
        return;
      }
      const result = verifyWorkerResult(request, data) as GradeResult | IgnoredResult | null;
      // Ignored (stale/mismatched) results are dropped: they never invoke
      // onComplete as a failure and never become learner evidence. The run
      // stays active so a valid result can still arrive; onIgnored lets the
      // UI explain the stale result instead of hanging until the timeout.
      if (!result) return;
      if ("ignored" in result) { onIgnored?.(result); return; }
      finish(result);
    };
    worker.onerror = () => finish(failureResult(request, "The Python worker failed to load or execute. Your code is preserved. Try again."));
    worker.onmessageerror = () => finish(failureResult(request, "The Python worker returned an unreadable response. Your code is preserved. Try again."));
    worker.postMessage(request);
  } catch (error) {
    finish(failureResult(request, `Could not start Python: ${String(error)}. Your code is preserved.`));
  }
  return cancel;
}
