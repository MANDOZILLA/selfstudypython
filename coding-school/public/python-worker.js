import { loadPyodide } from "/pyodide/pyodide.mjs";
import { runSubmission } from "./grading/runner.js";
let runtime;
self.onmessage = async ({ data }) => {
  const progress = phase => self.postMessage({ type: "progress", requestId: data?.requestId, exerciseId: data?.exerciseId, graderId: data?.graderId, phase });
  progress("loading");
  const result = await runSubmission(data, async () => {
    runtime ??= await loadPyodide({ indexURL: "/pyodide/" });
    progress("running");
    return runtime;
  });
  self.postMessage(result);
};
