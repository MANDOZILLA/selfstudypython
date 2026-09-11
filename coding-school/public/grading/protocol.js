import { getGrader } from "./catalog.js";
export function failureResult(request, message) {
  return { requestId: request?.requestId ?? "", exerciseId: request?.exerciseId ?? "", graderId: request?.graderId ?? "",
    executionOk: false, passed: false, score: 0, stdout: "", stderr: message,
    graderVersion: getGrader(request?.exerciseId, request?.graderId)?.version ?? "unavailable",
    tests: [{ id: "execution", name: "Execution and grader available", required: true, passed: false, detail: message }] };
}
export function validRequest(request) {
  return request?.type === "run" && typeof request.requestId === "string" && request.requestId.length > 0 &&
    typeof request.exerciseId === "string" && typeof request.graderId === "string" &&
    request.files && typeof request.files === "object" && !Array.isArray(request.files) &&
    Object.keys(request.files).length === 1 && typeof request.files["main.py"] === "string" && Boolean(getGrader(request.exerciseId, request.graderId));
}
export function aggregateResult(request, raw, stdout = "", stderr = "") {
  const grader = getGrader(request?.exerciseId, request?.graderId);
  if (!grader || !raw || typeof raw.executionOk !== "boolean" || !Array.isArray(raw.tests)) return failureResult(request, "Invalid or unavailable grader result.");
  const tests = raw.tests;
  const wellFormed = tests.length === grader.requiredTests.length &&
    tests.every(test => test && typeof test.id === "string" && typeof test.name === "string" && typeof test.passed === "boolean" && test.required === true && typeof test.detail === "string") &&
    new Set(tests.map(test => test.id)).size === tests.length && grader.requiredTests.every(id => tests.some(test => test.id === id));
  if (!wellFormed) return { ...failureResult(request, raw.error || "Incomplete or malformed required checks."), stdout, stderr: stderr || raw.error || "Incomplete or malformed required checks." };
  const score = raw.executionOk ? tests.filter(test => test.passed).length / tests.length : 0;
  return { requestId: request.requestId, exerciseId: request.exerciseId, graderId: request.graderId,
    executionOk: raw.executionOk, passed: raw.executionOk && tests.length > 0 && tests.every(test => test.passed),
    score, stdout, stderr: [stderr, raw.error].filter(Boolean).join("\n"), graderVersion: grader.version, tests };
}
export function verifyWorkerResult(request, value) {
  if (!value || value.requestId !== request.requestId || value.exerciseId !== request.exerciseId || value.graderId !== request.graderId) return null;
  const grader = getGrader(request.exerciseId, request.graderId);
  if (typeof value.stdout !== "string" || typeof value.stderr !== "string" || value.graderVersion !== grader?.version) return failureResult(request, "Malformed worker response.");
  const verified = aggregateResult(request, value, value.stdout, value.stderr);
  if (value.passed !== verified.passed || value.score !== verified.score) return failureResult(request, "Worker result did not match its required checks.");
  return verified;
}
