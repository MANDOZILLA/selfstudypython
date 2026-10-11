import { describe, expect, it } from "vitest";
import { ASSESSMENTS } from "../curriculum/assessments";
import { DIAGNOSTIC_UNKNOWN_ANSWER, type DiagnosticSession } from "../lib/diagnostic";
import type { AttemptRecord, MissionRun } from "../lib/mission-types";
import type { PortfolioSnapshot } from "../lib/portfolio";
import { createDefaultState, type LearningState } from "../lib/state";
import {
  getAchievements, getProgressSummary, getStreak, getTotalXp, getXpEvents,
  LEVEL_TITLES, levelFor,
} from "../lib/progress";

const instant = (day: number, hour = 12) => `2026-02-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const assistance = (hintsUsed = 0, aiAssisted = false, solutionViewed = false) => ({ hintsUsed, aiAssisted, solutionViewed });

function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    id: "attempt-1", runId: "run-1", missionId: "foundations", missionVersion: "1", stageId: "build",
    taskId: "foundations-project-task", variantId: "variant", contextId: "context", graderId: "grader",
    graderVersion: "1", sourceFiles: {}, sourceHash: "source", resultHash: "result", checks: [], skillOutcomes: [],
    introducedSkillIds: [], assistance: assistance(), purpose: "project", passed: true, executionOk: true,
    response: "", completedAt: instant(1), duplicateOf: null, ...overrides,
  };
}

function session(overrides: Partial<DiagnosticSession> = {}): DiagnosticSession {
  return {
    id: "diagnostic-1", formatVersion: "1", status: "completed", startedAt: instant(1), completedAt: instant(1),
    responses: [], currentItemId: null, draftAnswer: "", draftCode: "", draftHints: 0, codingSuccessCount: 0,
    infraError: null, profile: null, recommendation: null, ...overrides,
  } as DiagnosticSession;
}

function snapshot(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    id: "snapshot-1", snapshotVersion: "1", projectId: "project", projectVersion: "1", componentId: "component-1",
    title: "Shipped component", objective: "Build it", sourceFiles: {}, fixtures: {}, exportFiles: {}, tests: [], score: 1,
    result: "passed", assistance: assistance(), skillsDemonstrated: [], reflection: "", completedAt: instant(1),
    graderId: "grader", graderVersion: "1", curriculumVersion: "1", hash: "0".repeat(64), ...overrides,
  } as PortfolioSnapshot;
}

function run(id: string, status: MissionRun["status"] = "completed", completedAt = instant(1)): MissionRun {
  return { id, missionId: "foundations", missionVersion: "1", mode: "mission", status, stageIndex: 3,
    stages: [], drafts: {}, attemptIds: [], startedAt: instant(1), updatedAt: completedAt, completedAt } as MissionRun;
}

describe("progress derivations", () => {
  it("starts with no XP at level 1", () => {
    const state = createDefaultState();
    expect(getTotalXp(state)).toBe(0);
    expect(levelFor(0)).toMatchObject({ level: 1, title: "Hello World", xp: 0, floor: 0, next: 100, fill: 0 });
  });

  it("awards only the first non-duplicate successful attempt per task and resolves task purpose from curriculum", () => {
    const state = createDefaultState();
    state.attempts = [
      attempt({ id: "failed", passed: false, completedAt: instant(1) }),
      attempt({ id: "dupe", duplicateOf: "attempt-1", completedAt: instant(2) }),
      attempt({ id: "first", completedAt: instant(3) }),
      attempt({ id: "later", runId: "run-2", completedAt: instant(4) }),
      attempt({ id: "no-execution", taskId: "foundations-read-task", purpose: "retrieval", executionOk: false, completedAt: instant(5) }),
    ];
    state.missionRuns = [run("run-1"), run("run-2", "completed", instant(4))];
    expect(getXpEvents(state)).toHaveLength(1);
    expect(getXpEvents(state)[0]).toMatchObject({ id: "mission:first", xp: 150, source: "mission", independent: true });
  });

  it("marks review runs and applies assistance multipliers, hint deductions, and the 25% floor", () => {
    const state = createDefaultState();
    state.attempts = [
      attempt({ id: "review", taskId: "foundations-read-task", purpose: "retrieval", assistance: assistance(), completedAt: instant(1) }),
      attempt({ id: "ai", taskId: "foundations-project-task", runId: "ai-run", assistance: assistance(0, true), completedAt: instant(2) }),
      attempt({ id: "hint-floor", taskId: "foundations-debug-task", runId: "hint-run", assistance: assistance(20), completedAt: instant(3) }),
      attempt({ id: "floor", taskId: "foundations-scratch-task", runId: "solution-run", assistance: assistance(4, true), completedAt: instant(4) }),
    ];
    state.missionRuns = [run("run-1"), { ...run("ai-run"), mode: "mission" }, { ...run("hint-run"), mode: "mission" }, { ...run("solution-run"), mode: "mission" }];
    state.missionRuns[0].mode = "review";
    expect(getXpEvents(state).map(event => [event.source, event.xp, event.independent])).toEqual([
      ["mission", 55, false], ["mission", 37, false], ["mission", 75, false], ["review", 30, true],
    ]);
  });

  it("deduplicates checkpoint, placement, and portfolio XP using their source records", () => {
    const state = createDefaultState();
    const taskId = ASSESSMENTS[0].tasks[0].id;
    state.assessmentAttempts = [
      { attemptId: "checkpoint-fail", taskId, assessmentId: ASSESSMENTS[0].id, skillId: "x", passed: false, hintsUsed: 0, aiAssisted: false, solutionViewed: false, completedAt: instant(1), date: "2026-02-01", independent: true, weakenedByHints: false, mastered: false },
      { attemptId: "checkpoint-first", taskId, assessmentId: ASSESSMENTS[0].id, skillId: "x", passed: true, hintsUsed: 0, aiAssisted: false, solutionViewed: false, completedAt: instant(2), date: "2026-02-02", independent: true, weakenedByHints: false, mastered: true },
      { attemptId: "checkpoint-repeat", taskId, assessmentId: ASSESSMENTS[0].id, skillId: "x", passed: true, hintsUsed: 1, aiAssisted: false, solutionViewed: false, completedAt: instant(3), date: "2026-02-03", independent: false, weakenedByHints: false, mastered: false },
    ];
    state.diagnosticSessions = [session({ id: "placement-later", startedAt: instant(1), completedAt: instant(4) }), session({ id: "placement-first", startedAt: instant(1), completedAt: instant(2) })];
    state.portfolio = [snapshot({ id: "portfolio-fail", componentId: "component-fail", result: "failed" }), snapshot({ id: "portfolio-first", componentId: "same-component", completedAt: instant(2) }), snapshot({ id: "portfolio-repeat", componentId: "same-component", completedAt: instant(3) })];
    expect(getXpEvents(state).map(({ source, xp, id }) => [source, xp, id])).toEqual([
      ["checkpoint", 50, "checkpoint:checkpoint-first"],
      ["placement", 100, "placement:placement-first"],
      ["portfolio", 75, "portfolio:portfolio-first"],
    ]);
  });

  it("chooses earliest passing records per key regardless of array order, with id tie breaks", () => {
    const state = createDefaultState();
    const taskId = ASSESSMENTS[0].tasks[0].id;
    state.attempts = [
      attempt({ id: "z-later-tie", completedAt: instant(2) }),
      attempt({ id: "later", completedAt: instant(3) }),
      attempt({ id: "early-z", completedAt: instant(1) }),
      attempt({ id: "early-a", completedAt: instant(1) }),
    ];
    state.assessmentAttempts = [
      { attemptId: "later-check", taskId, assessmentId: ASSESSMENTS[0].id, skillId: "x", passed: true, hintsUsed: 0, aiAssisted: false, solutionViewed: false, completedAt: instant(3), date: "2026-02-03", independent: true, weakenedByHints: false, mastered: true },
      { attemptId: "check-z", taskId, assessmentId: ASSESSMENTS[0].id, skillId: "x", passed: true, hintsUsed: 0, aiAssisted: false, solutionViewed: false, completedAt: instant(1), date: "2026-02-01", independent: true, weakenedByHints: false, mastered: true },
      { attemptId: "check-a", taskId, assessmentId: ASSESSMENTS[0].id, skillId: "x", passed: true, hintsUsed: 0, aiAssisted: false, solutionViewed: false, completedAt: instant(1), date: "2026-02-01", independent: false, weakenedByHints: false, mastered: false },
    ];
    state.portfolio = [
      snapshot({ id: "portfolio-later", completedAt: instant(3) }),
      snapshot({ id: "portfolio-z", completedAt: instant(1) }),
      snapshot({ id: "portfolio-a", completedAt: instant(1) }),
    ];
    const events = getXpEvents(state);
    expect(events.find(event => event.source === "mission")).toMatchObject({ id: "mission:early-a", at: instant(1) });
    expect(events.find(event => event.source === "checkpoint")).toMatchObject({ id: "checkpoint:check-a", at: instant(1), xp: 25 });
    expect(events.find(event => event.source === "portfolio")).toMatchObject({ id: "portfolio:portfolio-a", at: instant(1) });
  });

  it("unlocks First Blood for a passing check even when its record is marked duplicate", () => {
    const state = createDefaultState();
    state.attempts = [attempt({ id: "duplicate-pass", duplicateOf: "source-attempt" })];
    expect(getAchievements(state).find(item => item.id === "first-blood")).toMatchObject({ unlocked: true, unlockedAt: instant(1) });
  });

  it("uses exact cumulative level boundaries and caps at level 20", () => {
    expect(levelFor(99).level).toBe(1);
    expect(levelFor(100)).toMatchObject({ level: 2, floor: 100, next: 283, fill: 0 });
    expect(levelFor(282).level).toBe(2);
    expect(levelFor(283)).toMatchObject({ level: 3, floor: 283, next: 520, fill: 0 });
    const capped = levelFor(1_000_000);
    expect(capped).toMatchObject({ level: 20, title: "The Architect", next: null, fill: 1 });
    expect(LEVEL_TITLES).toHaveLength(20);
  });

  it("counts local-calendar streaks, including yesterday when today is inactive", () => {
    const state = createDefaultState();
    state.attempts = [attempt({ id: "d1", completedAt: "2026-04-01T23:30:00-04:00" }), attempt({ id: "d2", taskId: "foundations-read-task", completedAt: "2026-04-02T01:00:00-04:00" }), attempt({ id: "d4", taskId: "foundations-debug-task", completedAt: "2026-04-04T10:00:00-04:00" })];
    expect(getStreak(state, new Date("2026-04-04T15:00:00-04:00"))).toEqual({ current: 1, best: 2, activeToday: true });
    expect(getStreak(state, new Date("2026-04-05T09:00:00-04:00"))).toEqual({ current: 1, best: 2, activeToday: false });
    state.attempts = state.attempts.slice(0, 1);
    expect(getStreak(state, new Date("2026-04-04T15:00:00-04:00"))).toEqual({ current: 0, best: 1, activeToday: false });
  });

  it("unlocks each achievement from qualifying records, in fixed order", () => {
    const state = createDefaultState();
    const taskIds = ASSESSMENTS[0].tasks.map(task => task.id);
    const unlockedAt = instant(7);
    state.attempts = Array.from({ length: 7 }, (_, i) => attempt({ id: `pass-${i}`, taskId: `earned-task-${i}`, completedAt: instant(i + 1) }));
    state.missionRuns = Array.from({ length: 10 }, (_, i) => run(`run-${i}`, "completed", instant(i + 1)));
    state.diagnosticSessions = [session({ responses: [
      { itemId: "ordinary", skillId: "x", kind: "concept", correct: false, answer: "unknown", code: "", hintsUsed: 0, graderId: null, graderVersion: null, legacy: false, dontKnow: false, respondedAt: instant(1) },
      { itemId: "honest", skillId: "x", kind: "concept", correct: false, answer: DIAGNOSTIC_UNKNOWN_ANSWER, code: "", hintsUsed: 0, graderId: null, graderVersion: null, legacy: false, dontKnow: true, respondedAt: unlockedAt },
    ] })];
    state.assessmentAttempts = taskIds.map((taskId, index) => ({ attemptId: `checkpoint-${index}`, taskId, assessmentId: ASSESSMENTS[0].id, skillId: "x", passed: true, hintsUsed: 0, aiAssisted: false, solutionViewed: false, completedAt: unlockedAt, date: "2026-02-07", independent: true, weakenedByHints: false, mastered: true }));
    state.portfolio = [snapshot({ completedAt: unlockedAt })];
    const ach = getAchievements(state);
    expect(ach.map(item => item.id)).toEqual(["first-blood", "no-hints", "placement", "streak-3", "streak-7", "mission-1", "mission-5", "mission-10", "checkpoint", "shipped", "honest", "level-5"]);
    expect(ach.every(item => item.unlocked)).toBe(true);
    expect(ach.find(item => item.id === "honest")?.unlockedAt).toBe(unlockedAt);
    expect(ach.every(item => item.unlockedAt !== null)).toBe(true);
  });

  it("keeps locked achievements present and reports only five newest events", () => {
    const state: LearningState = createDefaultState();
    state.attempts = Array.from({ length: 7 }, (_, i) => attempt({ id: `attempt-${i}`, taskId: `foundations-${["project", "read", "debug", "scratch", "explain"][i % 5]}-task`, purpose: "project", completedAt: instant(i + 1) }));
    // Distinct curriculum tasks above include multiple task purposes; the first record per task is retained.
    const summary = getProgressSummary(state, new Date(2026, 1, 9));
    expect(summary.recent).toHaveLength(5);
    expect(summary.recent.map(event => event.at)).toEqual([...summary.recent.map(event => event.at)].sort().reverse());
    expect(summary.achievements.some(item => !item.unlocked && item.unlockedAt === null)).toBe(true);
  });
});
