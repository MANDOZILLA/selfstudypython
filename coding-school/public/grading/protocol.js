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
  if (!grader || typeof value.stdout !== "string" || typeof value.stderr !== "string" || value.graderVersion !== grader.version) return null;
  // An explicit execution failure is a retryable transport result, never evidence.
  if (value.executionOk === false && value.passed === false && value.score === 0 && Array.isArray(value.tests) && value.tests.length === 1 && value.tests[0]?.id === "execution" && value.tests[0].passed === false && value.tests[0].required === true && typeof value.tests[0].name === "string" && typeof value.tests[0].detail === "string") return value;
  if (typeof value.executionOk !== "boolean" || !Array.isArray(value.tests) || value.tests.length !== grader.requiredTests.length || new Set(value.tests.map(test => test?.id)).size !== value.tests.length || !grader.requiredTests.every(id => value.tests.some(test => test?.id === id && typeof test.name === "string" && typeof test.passed === "boolean" && test.required === true && typeof test.detail === "string"))) return null;
  const verified = aggregateResult(request, value, value.stdout, value.stderr);
  if (value.passed !== verified.passed || value.score !== verified.score) return null;
  return verified;
}
