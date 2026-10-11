/**
 * Gamification engine: XP, levels, streaks, achievements.
 *
 * Every value here is a pure derivation of the saved LearningState — no
 * writes, no persistence, no clock reads beyond the optional `now` argument
 * (its default is the only `Date` construction in this module). Ordering is
 * deterministic: events follow record order per source and are then stably
 * sorted newest-first. XP measures effort only; it gates nothing.
 */
import { ASSESSMENTS } from "../curriculum/assessments";
import { getTask } from "./curriculum";
import { DIAGNOSTIC_UNKNOWN_ANSWER } from "./diagnostic";
import type { AttemptRecord } from "./mission-types";
import type { LearningState } from "./state";

export type XpSource = "mission" | "review" | "checkpoint" | "placement" | "portfolio";

export interface XpEvent {
  id: string;
  label: string;
  xp: number;
  at: string;
  source: XpSource;
  independent: boolean;
}

const XP_BY_PURPOSE: Record<AttemptRecord["purpose"], number> = {
  project: 150,
  "guided-practice": 40,
  retrieval: 30,
  reflection: 15,
  instruction: 5,
};
const CHECKPOINT_XP = 50;
const PLACEMENT_XP = 100;
const PORTFOLIO_XP = 75;

interface Assistance {
  hintsUsed: number;
  aiAssisted: boolean;
  solutionViewed: boolean;
}

/** Zero hints, no AI, no revealed solution. */
const isIndependent = (assistance: Assistance): boolean =>
  assistance.hintsUsed === 0 && !assistance.aiAssisted && !assistance.solutionViewed;

/** Assisted success is worth half (rounded down); every hint past the second
 *  costs 10, but never below 25% of the base so help never zeroes the effort. */
function adjustForAssistance(base: number, assistance: Assistance): number {
  let xp = assistance.aiAssisted || assistance.solutionViewed ? Math.floor(base * 0.5) : base;
  xp -= Math.max(0, assistance.hintsUsed - 2) * 10;
  return Math.max(xp, Math.floor(base * 0.25));
}

function earliest<T>(items: readonly T[], at: (item: T) => string): T | null {
  let best: T | null = null;
  for (const item of items) if (best === null || at(item) < at(best)) best = item;
  return best;
}

function latest<T>(items: readonly T[], at: (item: T) => string): T | null {
  let best: T | null = null;
  for (const item of items) if (best === null || at(item) > at(best)) best = item;
  return best;
}

export function getXpEvents(state: LearningState): XpEvent[] {
  const events: XpEvent[] = [];
  const runMode = new Map(state.missionRuns.map(run => [run.id, run.mode]));

  // Missions and reviews: the first passing, non-duplicate attempt per task.
  const seenTasks = new Set<string>();
  for (const attempt of state.attempts) {
    if (attempt.duplicateOf !== null || !attempt.passed || !attempt.executionOk) continue;
    if (seenTasks.has(attempt.taskId)) continue;
    seenTasks.add(attempt.taskId);
    const task = getTask(attempt.taskId);
    const source: XpSource = runMode.get(attempt.runId) === "review" ? "review" : "mission";
    events.push({
      id: `${source}:${attempt.id}`,
      label: task?.title ?? attempt.taskId,
      xp: adjustForAssistance(XP_BY_PURPOSE[task?.purpose ?? attempt.purpose], attempt.assistance),
      at: attempt.completedAt,
      source,
      independent: isIndependent(attempt.assistance),
    });
  }

  // Checkpoints: the first passing record per assessment task.
  const seenCheckpoints = new Set<string>();
  for (const record of state.assessmentAttempts) {
    if (!record.passed || seenCheckpoints.has(record.taskId)) continue;
    seenCheckpoints.add(record.taskId);
    const assessment = ASSESSMENTS.find(candidate => candidate.id === record.assessmentId);
    const label =
      assessment?.tasks.find(task => task.id === record.taskId)?.title ??
      assessment?.title ??
      "Checkpoint";
    events.push({
      id: `checkpoint:${record.attemptId}`,
      label,
      xp: record.independent ? CHECKPOINT_XP : Math.floor(CHECKPOINT_XP * 0.5),
      at: record.completedAt,
      source: "checkpoint",
      independent: record.independent,
    });
  }

  // Placement: the first completed diagnostic session only.
  const placement = earliest(
    state.diagnosticSessions.filter(session => session.status === "completed"),
    session => session.completedAt ?? session.startedAt,
  );
  if (placement) {
    events.push({
      id: `placement:${placement.id}`,
      label: "Placement scan",
      xp: PLACEMENT_XP,
      at: placement.completedAt ?? placement.startedAt,
      source: "placement",
      // A placement scan carries no assistance record, so it claims nothing.
      independent: false,
    });
  }

  // Portfolio: the first passing snapshot per component.
  const seenComponents = new Set<string>();
  for (const snapshot of state.portfolio) {
    if (snapshot.result !== "passed" || seenComponents.has(snapshot.componentId)) continue;
    seenComponents.add(snapshot.componentId);
    events.push({
      id: `portfolio:${snapshot.id}`,
      label: snapshot.title,
      xp: PORTFOLIO_XP,
      at: snapshot.completedAt,
      source: "portfolio",
      independent: isIndependent(snapshot.assistance),
    });
  }

  // Newest first; Array.prototype.sort is stable, so same-instant records keep
  // source/record order and the result never depends on the host environment.
  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export function getTotalXp(state: LearningState): number {
  return getXpEvents(state).reduce((total, event) => total + event.xp, 0);
}

export interface LevelInfo {
  level: number;
  title: string;
  xp: number;
  floor: number;
  next: number | null;
  /** 0..1 within the current level. */
  fill: number;
}

export const LEVEL_TITLES: readonly string[] = [
  "Hello World",
  "Script Kiddie",
  "Loop Runner",
  "Bug Hunter",
  "Stack Tracer",
  "Data Wrangler",
  "Regex Ronin",
  "Pipeline Smith",
  "Query Crafter",
  "Packet Whisperer",
  "Byte Sorcerer",
  "Exception Tamer",
  "Async Ninja",
  "Schema Warden",
  "Root Access",
  "Kernel Monk",
  "Daemon Lord",
  "Neural Hacker",
  "Zero-Day",
  "The Architect",
];

const MAX_LEVEL = LEVEL_TITLES.length;

/** Cumulative XP required to hold `level`. Level 1 starts at 0. */
function thresholdFor(level: number): number {
  if (level <= 1) return 0;
  return Math.round(100 * Math.pow(level - 1, 1.5));
}

export function levelFor(xp: number): LevelInfo {
  const total = Math.max(0, xp);
  let level = 1;
  for (let candidate = MAX_LEVEL; candidate >= 2; candidate--) {
    if (total >= thresholdFor(candidate)) {
      level = candidate;
      break;
    }
  }
  const floor = thresholdFor(level);
  const next = level >= MAX_LEVEL ? null : thresholdFor(level + 1);
  const fill = next === null ? 1 : Math.min(1, Math.max(0, (total - floor) / (next - floor)));
  return { level, title: LEVEL_TITLES[level - 1], xp: total, floor, next, fill };
}

export interface StreakInfo {
  current: number;
  best: number;
  activeToday: boolean;
}

const DAY_MS = 86_400_000;

/** Local calendar day as an integer index, so consecutive local days differ by exactly 1. */
function dayIndex(date: Date): number {
  if (Number.isNaN(date.getTime())) return Number.NaN;
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

function localDayIndex(iso: string): number {
  return dayIndex(new Date(iso));
}

function activeDays(state: LearningState): Set<number> {
  const days = new Set<number>();
  for (const attempt of state.attempts) {
    const day = localDayIndex(attempt.completedAt);
    if (!Number.isNaN(day)) days.add(day);
  }
  for (const record of state.assessmentAttempts) {
    const day = localDayIndex(record.completedAt);
    if (!Number.isNaN(day)) days.add(day);
  }
  return days;
}

function bestRunLength(days: Set<number>): number {
  const sorted = [...days].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let previous = Number.NaN;
  for (const day of sorted) {
    run = day === previous + 1 ? run + 1 : 1;
    previous = day;
    if (run > best) best = run;
  }
  return best;
}

function runLengthEndingAt(days: Set<number>, lastDay: number): number {
  let cursor = lastDay;
  let run = 0;
  while (days.has(cursor)) {
    run++;
    cursor--;
  }
  return run;
}

export function getStreak(state: LearningState, now: Date = new Date()): StreakInfo {
  const days = activeDays(state);
  const today = dayIndex(now);
  const activeToday = !Number.isNaN(today) && days.has(today);
  // Today has not happened yet? Count back from yesterday instead of reporting zero.
  const anchor = activeToday ? today : today - 1;
  return {
    current: Number.isNaN(anchor) ? 0 : runLengthEndingAt(days, anchor),
    best: bestRunLength(days),
    activeToday,
  };
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  glyph: string;
  unlocked: boolean;
  unlockedAt: string | null;
}

const ACHIEVEMENT_ORDER: readonly { id: string; title: string; description: string; glyph: string }[] = [
  { id: "first-blood", title: "First Blood", description: "Pass your first check.", glyph: "▲" },
  { id: "no-hints", title: "Clean Run", description: "Ship a project with no hints, no AI, no revealed solution.", glyph: "◆" },
  { id: "placement", title: "Mapped", description: "Complete a placement scan.", glyph: "◎" },
  { id: "streak-3", title: "On Fire", description: "Practice three days in a row.", glyph: "✦" },
  { id: "streak-7", title: "Unstoppable", description: "Practice seven days in a row.", glyph: "✹" },
  { id: "mission-1", title: "Mission Zero", description: "Complete your first mission run.", glyph: "■" },
  { id: "mission-5", title: "Halfway Hacker", description: "Complete five mission runs.", glyph: "▣" },
  { id: "mission-10", title: "Full Clearance", description: "Complete ten mission runs.", glyph: "◉" },
  { id: "checkpoint", title: "Checkpoint Cleared", description: "Pass every task in one checkpoint.", glyph: "⬢" },
  { id: "shipped", title: "Shipped", description: "Seal your first passing portfolio snapshot.", glyph: "⬡" },
  { id: "honest", title: "Honest Agent", description: 'Declare "I do not know" during a placement scan.', glyph: "?" },
  { id: "level-5", title: "Rank Up", description: "Reach rank 5.", glyph: "★" },
];

/** Timestamp of the record that qualified the streak milestone, or null. */
function streakMilestoneAt(state: LearningState, days: Set<number>, target: number): string | null {
  const sorted = [...days].sort((a, b) => a - b);
  const stamps = [...state.attempts, ...state.assessmentAttempts].map(record => record.completedAt);
  let run = 0;
  let previous = Number.NaN;
  for (const day of sorted) {
    run = day === previous + 1 ? run + 1 : 1;
    previous = day;
    if (run >= target) return earliest(stamps.filter(stamp => localDayIndex(stamp) === day), stamp => stamp);
  }
  return null;
}

function nthCompletedRunAt(state: LearningState, count: number): string | null {
  const times = state.missionRuns
    .filter(run => run.status === "completed")
    .map(run => run.completedAt ?? "")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return times[count - 1] || null;
}

function levelMilestoneAt(state: LearningState, targetLevel: number): string | null {
  const oldestFirst = [...getXpEvents(state)].reverse();
  let total = 0;
  for (const event of oldestFirst) {
    total += event.xp;
    if (levelFor(total).level >= targetLevel) return event.at;
  }
  return null;
}

function achievementState(state: LearningState, id: string): { unlocked: boolean; at: string | null } {
  const unlocked = (at: string | null): { unlocked: boolean; at: string | null } => ({ unlocked: true, at });
  const locked: { unlocked: boolean; at: string | null } = { unlocked: false, at: null };

  switch (id) {
    case "first-blood": {
      const first = earliest(
        state.attempts.filter(a => a.passed && a.executionOk && a.duplicateOf === null),
        a => a.completedAt,
      );
      return first ? unlocked(first.completedAt) : locked;
    }
    case "no-hints": {
      const clean = earliest(
        state.attempts.filter(a => {
          const task = getTask(a.taskId);
          return (
            a.passed &&
            a.executionOk &&
            a.duplicateOf === null &&
            (task?.purpose ?? a.purpose) === "project" &&
            isIndependent(a.assistance)
          );
        }),
        a => a.completedAt,
      );
      return clean ? unlocked(clean.completedAt) : locked;
    }
    case "placement": {
      const session = earliest(
        state.diagnosticSessions.filter(s => s.status === "completed"),
        s => s.completedAt ?? s.startedAt,
      );
      if (session) return unlocked(session.completedAt ?? session.startedAt);
      return state.diagnostic.completed ? unlocked(state.diagnostic.completedAt) : locked;
    }
    case "streak-3":
    case "streak-7": {
      const target = id === "streak-3" ? 3 : 7;
      const days = activeDays(state);
      return bestRunLength(days) >= target ? unlocked(streakMilestoneAt(state, days, target)) : locked;
    }
    case "mission-1":
    case "mission-5":
    case "mission-10": {
      const target = id === "mission-1" ? 1 : id === "mission-5" ? 5 : 10;
      const completed = state.missionRuns.filter(run => run.status === "completed").length;
      return completed >= target ? unlocked(nthCompletedRunAt(state, target)) : locked;
    }
    case "checkpoint": {
      for (const assessment of ASSESSMENTS) {
        const taskIds = assessment.tasks.map(task => task.id);
        const passed = state.assessmentAttempts.filter(
          record => record.assessmentId === assessment.id && record.passed && taskIds.includes(record.taskId),
        );
        const passedIds = new Set(passed.map(record => record.taskId));
        if (taskIds.every(taskId => passedIds.has(taskId))) {
          return unlocked(latest(passed, record => record.completedAt)?.completedAt ?? null);
        }
      }
      return locked;
    }
    case "shipped": {
      const snapshot = earliest(
        state.portfolio.filter(item => item.result === "passed"),
        item => item.completedAt,
      );
      return snapshot ? unlocked(snapshot.completedAt) : locked;
    }
    case "honest": {
      const declaration = earliest(
        state.diagnosticSessions.flatMap(session => session.responses)
          .filter(response => response.answer === DIAGNOSTIC_UNKNOWN_ANSWER),
        response => response.respondedAt,
      );
      return declaration ? unlocked(declaration.respondedAt) : locked;
    }
    case "level-5": {
      const info = levelFor(getTotalXp(state));
      return info.level >= 5 ? unlocked(levelMilestoneAt(state, 5)) : locked;
    }
    default:
      return locked;
  }
}

export function getAchievements(state: LearningState): Achievement[] {
  return ACHIEVEMENT_ORDER.map(spec => {
    const { unlocked, at } = achievementState(state, spec.id);
    return { ...spec, unlocked, unlockedAt: unlocked ? at : null };
  });
}

export interface ProgressSummary {
  xp: number;
  level: LevelInfo;
  streak: StreakInfo;
  achievements: Achievement[];
  unlocked: number;
  /** Newest first, at most 5. */
  recent: XpEvent[];
}

export function getProgressSummary(state: LearningState, now: Date = new Date()): ProgressSummary {
  const events = getXpEvents(state);
  const achievements = getAchievements(state);
  return {
    xp: events.reduce((total, event) => total + event.xp, 0),
    level: levelFor(events.reduce((total, event) => total + event.xp, 0)),
    streak: getStreak(state, now),
    achievements,
    unlocked: achievements.filter(achievement => achievement.unlocked).length,
    recent: events.slice(0, 5),
  };
}
