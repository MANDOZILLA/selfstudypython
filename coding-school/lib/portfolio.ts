import { z } from "zod";
import { sha256Hex } from "./sha256";
import { findPortfolioComponent, getPortfolioProject } from "../curriculum/portfolio-projects";
import { CURRICULUM_VERSION, getMission, getTask } from "./curriculum";
import type { LearningState } from "./state";

/**
 * Immutable portfolio completion snapshots.
 *
 * When a tagged mission build task passes, the learner's exact source, the
 * frozen fixtures and exported tests, the named test outcomes, score,
 * assistance, skills, and reflection are sealed into a snapshot with a
 * SHA-256 content hash. Snapshots are keyed by `projectId:componentId`, so
 * re-completing a mission never duplicates or overwrites evidence. Exports
 * (ZIP downloads) are derived from the frozen snapshot only, so later
 * curriculum changes can never rewrite a learner's evidence.
 */

export { sha256Hex };

export const PORTFOLIO_SNAPSHOT_VERSION = "1.0.0";

export const portfolioTestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  passed: z.boolean(),
});
export type PortfolioTestOutcome = z.infer<typeof portfolioTestSchema>;

export const portfolioAssistanceSchema = z.object({
  hintsUsed: z.number().int().min(0),
  aiAssisted: z.boolean(),
  solutionViewed: z.boolean(),
});
export type PortfolioAssistance = z.infer<typeof portfolioAssistanceSchema>;

export const portfolioSkillSchema = z.object({ skillId: z.string().min(1) });
export type PortfolioSkill = z.infer<typeof portfolioSkillSchema>;

export const portfolioSnapshotSchema = z.object({
  id: z.string().min(1),
  snapshotVersion: z.string().min(1),
  projectId: z.string().min(1),
  projectVersion: z.string().min(1),
  componentId: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  sourceFiles: z.record(z.string(), z.string()),
  fixtures: z.record(z.string(), z.string()),
  exportFiles: z.record(z.string(), z.string()),
  tests: z.array(portfolioTestSchema),
  score: z.number().min(0).max(1),
  result: z.enum(["passed", "failed"]),
  assistance: portfolioAssistanceSchema,
  skillsDemonstrated: z.array(portfolioSkillSchema),
  reflection: z.string(),
  completedAt: z.string().min(1),
  graderId: z.string().min(1),
  graderVersion: z.string().min(1),
  curriculumVersion: z.string().min(1),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type PortfolioSnapshot = z.infer<typeof portfolioSnapshotSchema>;

/** Legacy snapshots from the previous minimal schema (state.ts, schema v3 era). */
export const legacyPortfolioSnapshotSchema = z.object({
  projectId: z.string(),
  title: z.string(),
  sourceFiles: z.record(z.string(), z.string()),
  tests: z.array(z.object({ name: z.string(), passed: z.boolean() })),
  feedback: z.string(),
  score: z.number().min(0).max(1),
  skillIds: z.array(z.string()),
  completedAt: z.string(),
});
export type LegacyPortfolioSnapshot = z.infer<typeof legacyPortfolioSnapshotSchema>;

export interface CreatePortfolioSnapshotInput {
  projectId: string;
  projectVersion: string;
  componentId: string;
  title: string;
  objective: string;
  sourceFiles: Record<string, string>;
  fixtures: Record<string, string>;
  exportFiles: Record<string, string>;
  tests: PortfolioTestOutcome[];
  score: number;
  result: "passed" | "failed";
  assistance: PortfolioAssistance;
  skillsDemonstrated: PortfolioSkill[];
  reflection: string;
  completedAt: string;
  graderId: string;
  graderVersion: string;
  curriculumVersion: string;
}

/** Deterministic JSON: object keys sorted recursively, arrays keep order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

/** Deep copy through JSON; snapshots only ever contain JSON-safe data. */
export function deepCopySnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** SHA-256 over the canonical snapshot body (everything except the hash). */
export function computeContentHash(snapshot: Omit<PortfolioSnapshot, "hash">): string {
  return sha256Hex(canonicalJson(snapshot));
}

/**
 * Seal a new snapshot. The id is `projectId:componentId`; the hash covers
 * every other field. Fails closed on invalid payloads.
 */
export function createPortfolioSnapshot(input: CreatePortfolioSnapshotInput): PortfolioSnapshot {
  const parsed = z
    .object({
      projectId: z.string().min(1),
      projectVersion: z.string().min(1),
      componentId: z.string().min(1),
      title: z.string().min(1),
      objective: z.string().min(1),
      sourceFiles: z.record(z.string(), z.string()),
      fixtures: z.record(z.string(), z.string()),
      exportFiles: z.record(z.string(), z.string()),
      tests: z.array(portfolioTestSchema),
      score: z.number().min(0).max(1),
      result: z.enum(["passed", "failed"]),
      assistance: portfolioAssistanceSchema,
      skillsDemonstrated: z.array(portfolioSkillSchema),
      reflection: z.string(),
      completedAt: z.string().min(1),
      graderId: z.string().min(1),
      graderVersion: z.string().min(1),
      curriculumVersion: z.string().min(1),
    })
    .parse(deepCopySnapshot(input));
  const body = {
    id: `${parsed.projectId}:${parsed.componentId}`,
    snapshotVersion: PORTFOLIO_SNAPSHOT_VERSION,
    ...parsed,
  };
  return portfolioSnapshotSchema.parse({ ...body, hash: computeContentHash(body) });
}

/**
 * Verify a snapshot's integrity: schema-valid and the content hash
 * recomputes to the stored value. Returns false instead of throwing so
 * callers can quarantine tampered snapshots.
 */
export function verifyPortfolioSnapshot(snapshot: unknown): snapshot is PortfolioSnapshot {
  const parsed = portfolioSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) return false;
  const { hash, ...body } = parsed.data;
  return computeContentHash(body) === hash;
}

/**
 * Convert a legacy minimal snapshot into the full schema. Fields the old
 * schema never recorded are marked as unknown rather than invented; the
 * source files and test outcomes are preserved verbatim. The old free-text
 * feedback is not a reflection, so reflection stays empty.
 */
export function convertLegacyPortfolioSnapshot(legacy: LegacyPortfolioSnapshot): PortfolioSnapshot {
  const project = getPortfolioProject(legacy.projectId);
  return createPortfolioSnapshot({
    projectId: legacy.projectId,
    projectVersion: project?.version ?? "0.0.0-legacy",
    componentId: `legacy:${legacy.projectId}`,
    title: legacy.title,
    objective: "Imported from an earlier app version; the original project objective was not recorded.",
    sourceFiles: deepCopySnapshot(legacy.sourceFiles),
    fixtures: {},
    exportFiles: {},
    tests: legacy.tests.map((t) => ({ id: t.name, name: t.name, passed: t.passed })),
    score: legacy.score,
    result: legacy.score >= 1 ? "passed" : "failed",
    assistance: { hintsUsed: 0, aiAssisted: false, solutionViewed: false },
    skillsDemonstrated: legacy.skillIds.map((skillId) => ({ skillId })),
    reflection: "",
    completedAt: legacy.completedAt,
    graderId: "legacy",
    graderVersion: "0.0.0",
    curriculumVersion: "0.0.0-legacy",
  });
}

/**
 * Add a snapshot to a portfolio list exactly once, keyed by snapshot id.
 * Returns the list unchanged when the snapshot is already present.
 */
export function addPortfolioSnapshot(
  portfolio: PortfolioSnapshot[],
  snapshot: PortfolioSnapshot,
): PortfolioSnapshot[] {
  if (!verifyPortfolioSnapshot(snapshot)) throw new Error("Refusing to store a snapshot that fails verification");
  if (portfolio.some((s) => s.id === snapshot.id)) return portfolio;
  return [...portfolio, deepCopySnapshot(snapshot)];
}

function latestPassedAttempt(state: LearningState, runId: string, taskId: string) {
  return state.attempts
    .filter((a) => a.runId === runId && a.taskId === taskId && a.passed && a.executionOk)
    .at(-1);
}

function runReflection(state: LearningState, runId: string, missionId: string): string {
  const mission = getMission(missionId);
  const explainTaskIds = new Set(
    (mission?.stages ?? []).filter((s) => s.kind === "explain").flatMap((s) => s.tasks.map((t) => t.id)),
  );
  const run = state.missionRuns.find((r) => r.id === runId);
  return (
    state.attempts
      .filter((a) => a.runId === runId && explainTaskIds.has(a.taskId) && a.response.trim().length > 0)
      .at(-1)?.response ??
    [...explainTaskIds].map((id) => run?.drafts[id]?.response?.trim()).find((r) => r) ??
    ""
  );
}

/**
 * Seal the snapshot for one tagged build task. Returns the state unchanged
 * when the task is unknown, untagged, or has no passing attempt in the run —
 * snapshots are evidence of passed work, never placeholders.
 */
export function recordPortfolioSnapshot(
  state: LearningState,
  runId: string,
  taskId: string,
  now: Date = new Date(),
): LearningState {
  const task = getTask(taskId);
  const found = findPortfolioComponent(taskId);
  const run = state.missionRuns.find((r) => r.id === runId);
  if (!task || !task.portfolioProjectId || !found || found.project.id !== task.portfolioProjectId || !run) {
    return state;
  }
  const latest = latestPassedAttempt(state, runId, taskId);
  if (!latest) return state;
  const snapshot = createPortfolioSnapshot({
    projectId: found.project.id,
    projectVersion: found.project.version,
    componentId: taskId,
    title: found.component.title,
    objective: found.component.objective,
    sourceFiles: deepCopySnapshot(latest.sourceFiles),
    fixtures: deepCopySnapshot(found.component.fixtureFiles),
    exportFiles: { [found.component.testFileName]: found.component.testFileContent },
    tests: latest.checks.map((c) => ({ id: c.id, name: c.name, passed: c.passed })),
    score: 1,
    result: "passed",
    assistance: { ...latest.assistance },
    skillsDemonstrated: latest.skillOutcomes.filter((s) => s.passed).map((s) => ({ skillId: s.skillId })),
    reflection: runReflection(state, runId, run.missionId),
    completedAt: latest.completedAt || now.toISOString(),
    graderId: found.component.graderId,
    graderVersion: latest.graderVersion,
    curriculumVersion: CURRICULUM_VERSION,
  });
  const portfolio = addPortfolioSnapshot(state.portfolio, snapshot);
  if (portfolio === state.portfolio) return state;
  return { ...state, portfolio };
}

/**
 * Seal one immutable snapshot per tagged build task that has a passing
 * attempt in the run. Idempotent: re-running never duplicates or overwrites.
 */
export function recordRunPortfolioSnapshots(
  state: LearningState,
  runId: string,
  now: Date = new Date(),
): LearningState {
  const run = state.missionRuns.find((r) => r.id === runId);
  const mission = run && getMission(run.missionId);
  if (!run || !mission) return state;
  const tagged = mission.stages
    .flatMap((s) => s.tasks)
    .filter((t) => t.kind === "code" && t.portfolioProjectId)
    .map((t) => t.id);
  return tagged.reduce((next, taskId) => recordPortfolioSnapshot(next, runId, taskId, now), state);
}
