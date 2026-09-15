import { describe, expect, it } from "vitest";
import { buildSkillGraph, type GraphSkillStatus } from "../lib/skill-graph";
import {
  createDefaultState,
  type AttemptRecord,
  type LearningState,
} from "../lib/state";
import {
  createDiagnosticSession,
  type DiagnosticSession,
} from "../lib/diagnostic";

let serial = 0;
function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  serial += 1;
  const skillId = (overrides.skillOutcomes?.[0]?.skillId ?? "csv-cleaning") as string;
  return {
    id: `attempt-${serial}`,
    runId: "run-1",
    missionId: "csv-foundations",
    missionVersion: "1.0.0",
    stageId: "stage-build",
    taskId: "csv-tags-challenge",
    variantId: "v1",
    contextId: "ctx-1",
    graderId: "csv-tags-v1",
    graderVersion: "1.0.0",
    sourceFiles: { "main.py": `x = ${serial}` },
    sourceHash: `sh-${serial}`,
    resultHash: `rh-${serial}`,
    checks: [],
    skillOutcomes: [{ skillId, passed: true, checkIds: ["csv-tags-row"] }],
    introducedSkillIds: [],
    assistance: { hintsUsed: 0, aiAssisted: false, solutionViewed: false },
    purpose: "project",
    passed: true,
    executionOk: true,
    response: "",
    completedAt: "2026-09-10T12:00:00.000Z",
    duplicateOf: null,
    ...overrides,
  };
}

function withAttempts(records: AttemptRecord[]): LearningState {
  return { ...createDefaultState(), attempts: records };
}

function nodeFor(state: LearningState, skillId: string) {
  const node = buildSkillGraph(state).find(n => n.skillId === skillId);
  if (!node) throw new Error(`missing skill node ${skillId}`);
  return node;
}

function diagnosedSession(weakSkill: string): DiagnosticSession {
  const at = "2026-09-09T12:00:00.000Z";
  const response = (itemId: string, skillId: string, correct: boolean, kind: "concept" | "coding" = "concept") => ({
    itemId, skillId, kind, correct, answer: "x", code: "",
    hintsUsed: 0, graderId: `diagnostic-concept-${itemId}`, graderVersion: "1.0.0",
    legacy: false, respondedAt: at,
  });
  const base = createDiagnosticSession(new Date(at));
  return {
    ...base,
    status: "completed",
    completedAt: at,
    currentItemId: null,
    responses: [
      // Two correct concept answers make python-functions observed-strong.
      response("d1", "python-functions", true),
      response("d2", "python-functions", true),
      // Two incorrect answers make the weak skill observed-weak.
      response("d3", weakSkill, false),
      response("d4", weakSkill, false),
    ],
    profile: null,
    recommendation: null,
  };
}

describe("skill graph", () => {
  it("covers every curriculum skill with qualitative statuses and no percentages", () => {
    const graph = buildSkillGraph(createDefaultState());
    expect(graph.map(n => n.skillId)).toEqual([
      "python-functions", "python-exceptions", "data-structures", "file-io",
      "csv-cleaning", "financial-data", "json-validation", "pandas-data-quality",
      "sqlite-analytics", "http-reliability", "llm-output-validation",
    ]);
    const allowed: GraphSkillStatus[] = ["untested", "needs-practice", "working-evidence",
      "demonstrated-in-project", "demonstrated-again-later", "mastered"];
    for (const node of graph) {
      expect(allowed).toContain(node.status);
      expect(JSON.stringify(node)).not.toMatch(/\d+%/);
      expect(node.name.length).toBeGreaterThan(0);
      expect(node.evidenceTasks).toEqual([]);
      expect(node.lastDemonstratedAt).toBeNull();
    }
  });

  it("lists prerequisites with names for every skill", () => {
    const node = nodeFor(createDefaultState(), "csv-cleaning");
    expect(node.prerequisites).toEqual([{ skillId: "data-structures", name: "Ordered record transformations" }]);
    expect(nodeFor(createDefaultState(), "python-functions").prerequisites).toEqual([]);
  });

  it("marks untested skills as untested, never weak", () => {
    const node = nodeFor(createDefaultState(), "csv-cleaning");
    expect(node.status).toBe("untested");
    expect(node.weak).toBe(false);
    expect(node.evidenceCount).toBe(0);
    expect(node.readiness).toMatch(/no attempts/i);
  });

  it("marks assisted or failed evidence as needs-practice and weak", () => {
    const state = withAttempts([
      attempt({ assistance: { hintsUsed: 3, aiAssisted: false, solutionViewed: false }, passed: false,
        skillOutcomes: [{ skillId: "csv-cleaning", passed: false, checkIds: ["csv-tags-row"] }] }),
    ]);
    const node = nodeFor(state, "csv-cleaning");
    expect(node.status).toBe("needs-practice");
    expect(node.weak).toBe(true);
    expect(node.evidenceCount).toBe(1);
    expect(node.lastDemonstratedAt).toBeNull();
    expect(node.readiness).toMatch(/needs practice/i);
  });

  it("caps a single easy independent retrieval at working evidence, never mastery", () => {
    const state = withAttempts([
      attempt({ purpose: "retrieval", taskId: "csv-tags-review", contextId: "ctx-review" }),
    ]);
    const node = nodeFor(state, "csv-cleaning");
    expect(node.status).toBe("working-evidence");
    expect(node.weak).toBe(false);
    expect(node.lastDemonstratedAt).toBe("2026-09-10T12:00:00.000Z");
    expect(node.readiness).toMatch(/independent/i);
  });

  it("establishes demonstrated-in-project from one independent project success", () => {
    const node = nodeFor(withAttempts([attempt()]), "csv-cleaning");
    expect(node.status).toBe("demonstrated-in-project");
    expect(node.lastDemonstratedAt).toBe("2026-09-10T12:00:00.000Z");
    expect(node.evidenceTasks).toHaveLength(1);
    expect(node.evidenceTasks[0]).toMatchObject({ taskId: "csv-tags-challenge", passed: true, independent: true });
    expect(node.readiness).toMatch(/demonstrated in project/i);
  });

  it("repeating the same task cannot establish context diversity", () => {
    const state = withAttempts([
      attempt({ completedAt: "2026-09-10T12:00:00.000Z" }),
      // Same task, later date, different code — still the same task.
      attempt({ completedAt: "2026-09-14T12:00:00.000Z", sourceHash: "sh-other", resultHash: "rh-other" }),
    ]);
    const node = nodeFor(state, "csv-cleaning");
    expect(node.status).toBe("demonstrated-in-project");
    expect(node.readiness).toMatch(/new context/i);
  });

  it("advances to demonstrated-again-later with a later independent success in a new context", () => {
    const state = withAttempts([
      attempt({ completedAt: "2026-09-10T12:00:00.000Z" }),
      attempt({ purpose: "retrieval", taskId: "csv-tags-review", contextId: "ctx-review",
        completedAt: "2026-09-12T12:00:00.000Z" }),
    ]);
    const node = nodeFor(state, "csv-cleaning");
    expect(node.status).toBe("demonstrated-again-later");
    expect(node.evidenceTasks).toHaveLength(2);
  });

  it("requires delayed retrieval across distinct contexts for mastered", () => {
    const state = withAttempts([
      attempt({ completedAt: "2026-09-10T12:00:00.000Z" }),
      attempt({ purpose: "retrieval", taskId: "csv-tags-review", contextId: "ctx-review",
        completedAt: "2026-09-12T12:00:00.000Z" }),
      // Same context as the retrieval: not diverse enough for mastery.
      attempt({ purpose: "retrieval", taskId: "csv-tags-review", contextId: "ctx-review",
        completedAt: "2026-09-16T12:00:00.000Z" }),
    ]);
    expect(nodeFor(state, "csv-cleaning").status).toBe("demonstrated-again-later");
    const mastered = withAttempts([
      attempt({ completedAt: "2026-09-10T12:00:00.000Z" }),
      attempt({ purpose: "retrieval", taskId: "csv-tags-review", contextId: "ctx-review",
        completedAt: "2026-09-12T12:00:00.000Z" }),
      attempt({ purpose: "retrieval", taskId: "csv-ledger-review", contextId: "ctx-ledger",
        completedAt: "2026-09-16T12:00:00.000Z" }),
    ]);
    const node = nodeFor(mastered, "csv-cleaning");
    expect(node.status).toBe("mastered");
    expect(node.readiness).toMatch(/mastered/i);
  });

  it("surfaces the next review date and reason from the review schedule", () => {
    const state = {
      ...withAttempts([attempt()]),
      reviewSchedule: {
        "csv-cleaning": { skillId: "csv-cleaning", dueAt: "2026-09-13T12:00:00.000Z", reason: "retrieval" as const, intervalDays: 3 as const },
      },
    };
    const node = nodeFor(state, "csv-cleaning");
    expect(node.nextReviewAt).toBe("2026-09-13T12:00:00.000Z");
    expect(node.nextReviewReason).toBe("retrieval");
    expect(node.readiness).toMatch(/retrieval/i);
  });

  it("uses diagnostic placement for readiness without fabricating mastery", () => {
    const session = diagnosedSession("data-structures");
    const state = { ...createDefaultState(), diagnosticSessions: [session] };
    const weak = nodeFor(state, "data-structures");
    expect(weak.status).toBe("untested");
    expect(weak.weak).toBe(false);
    expect(weak.placement).toBe("weak");
    expect(weak.readiness).toMatch(/placement/i);
    const strong = nodeFor(state, "python-functions");
    expect(strong.status).toBe("untested");
    expect(strong.placement).toBe("strong");
  });

  it("explains blocked readiness when a prerequisite needs practice", () => {
    const state = withAttempts([
      attempt({ assistance: { hintsUsed: 2, aiAssisted: false, solutionViewed: false }, passed: false,
        skillOutcomes: [{ skillId: "data-structures", passed: false, checkIds: ["ds-1"] }] }),
    ]);
    const node = nodeFor(state, "csv-cleaning");
    expect(node.readiness).toMatch(/prerequisite/i);
    expect(node.readiness).toMatch(/data-structures/i);
  });

  it("lists assessment attempts as evidence tasks when their skill matches", () => {
    const state = {
      ...withAttempts([attempt()]),
      assessmentAttempts: [{
        attemptId: "a1", taskId: "csv-debug-task", assessmentId: "data-checkpoint",
        skillId: "csv-cleaning", completedAt: "2026-09-11T12:00:00.000Z", date: "2026-09-11",
        passed: true, hintsUsed: 0, aiAssisted: false, solutionViewed: false,
        independent: true, weakenedByHints: false, mastered: true,
        result: { passed: true, hintsUsed: 0, aiAssisted: false, solutionViewed: false },
      }],
    };
    const node = nodeFor(state, "csv-cleaning");
    expect(node.evidenceCount).toBe(2);
    expect(node.evidenceTasks.some(t => t.taskId === "csv-debug-task" && t.kind === "assessment")).toBe(true);
  });

  it("keeps the readiness reason traceable to concrete evidence", () => {
    const state = withAttempts([
      attempt({ completedAt: "2026-09-10T12:00:00.000Z" }),
      attempt({ purpose: "retrieval", taskId: "csv-tags-review", contextId: "ctx-review",
        completedAt: "2026-09-12T12:00:00.000Z" }),
    ]);
    const node = nodeFor(state, "csv-cleaning");
    expect(node.readiness).toContain("2026-09-12");
    expect(node.readiness).toContain("csv-tags-review");
  });
});
