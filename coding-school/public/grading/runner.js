import { paymentsSuite } from "./catalog.js";
import { apiSuite, contactsSuite, inventorySuite, csvTagsSuite, invoiceCentsSuite, webhookEventsSuite, settlementReconciliationSuite } from "./mission-suites.js";
import { diagnosticCallFormsSuite, diagnosticHttpSuite, diagnosticFilesSuite } from "./diagnostic-suites.js";
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
    const suites = { "payments-csv-v1": paymentsSuite, "api-normalization-v1": apiSuite, "contacts-v1": contactsSuite, "inventory-v1": inventorySuite, "csv-tags-v1": csvTagsSuite, "invoice-cents-v1": invoiceCentsSuite, "webhook-events-v1": webhookEventsSuite, "settlement-reconciliation-v1": settlementReconciliationSuite, "diagnostic-call-forms-v1": diagnosticCallFormsSuite, "diagnostic-http-v1": diagnosticHttpSuite, "diagnostic-files-v1": diagnosticFilesSuite };
    const raw = JSON.parse(await runtime.runPythonAsync(suites[request.graderId], { globals: namespace }));
    return aggregateResult(request, raw, stdout, stderr);
  } catch (error) {
    return { ...failureResult(request, String(error)), stdout, stderr: stderr + String(error) };
  } finally {
    namespace?.destroy();
  }
}
