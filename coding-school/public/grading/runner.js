import { paymentsSuite } from "./catalog.js";
import { aggregateResult, failureResult, validRequest } from "./protocol.js";
export async function runSubmission(request, loadRuntime) {
  if (!validRequest(request)) return failureResult(request, "This exercise has no available grader, or the request is invalid.");
  let stdout = "";
  let stderr = "";
  let namespace;
  try {
    const runtime = await loadRuntime();
    runtime.setStdout({ batched: text => { stdout = (stdout + text + "\n").slice(-20000); } });
    runtime.setStderr({ batched: text => { stderr = (stderr + text + "\n").slice(-20000); } });
    namespace = runtime.toPy({ submission_source: request.files["main.py"] });
    const raw = JSON.parse(await runtime.runPythonAsync(paymentsSuite, { globals: namespace }));
    return aggregateResult(request, raw, stdout, stderr);
  } catch (error) {
    return { ...failureResult(request, String(error)), stdout, stderr: stderr + String(error) };
  } finally {
    namespace?.destroy();
  }
}
