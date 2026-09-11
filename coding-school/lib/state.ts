import type { MasteryRecord, ReviewSchedule } from "./adaptive";

const STORAGE_KEY = "coding-school:learner-state";
const STATE_VERSION = 1 as const;

export type DashboardTab = "overview" | "lessons" | "learned" | "assessment" | "portfolio";
export type AttemptKind = "diagnostic" | "quiz" | "exercise" | "project" | "assessment";

export type AttemptRecord = {
  id: string;
  contentId: string;
  kind: AttemptKind;
  score: number;
  hintsUsed: number;
  aiAssisted: boolean;
  independent: boolean;
  completedAt: string;
};

export type ScheduledReview = ReviewSchedule & { skillId: string };

export type PortfolioSnapshot = {
  projectId: string;
  title: string;
  sourceFiles: Record<string, string>;
  tests: Array<{ name: string; passed: boolean }>;
  feedback: string;
  score: number;
  skillIds: string[];
  completedAt: string;
};

export type LearningState = {
  version: typeof STATE_VERSION;
  dashboard: { activeTab: DashboardTab };
  diagnostic: { completed: boolean; completedAt: string | null };
  attempts: AttemptRecord[];
  mastery: Record<string, MasteryRecord>;
  reviewSchedule: Record<string, ScheduledReview>;
  portfolio: PortfolioSnapshot[];
};

const dashboardTabs: DashboardTab[] = ["overview", "lessons", "learned", "assessment", "portfolio"];
const attemptKinds: AttemptKind[] = ["diagnostic", "quiz", "exercise", "project", "assessment"];
const reviewReasons: ScheduledReview["reason"][] = ["weak-skill", "practice", "retrieval"];

export function createDefaultState(): LearningState {
  return {
    version: STATE_VERSION,
    dashboard: { activeTab: "overview" },
    diagnostic: { completed: false, completedAt: null },
    attempts: [],
    mastery: {},
    reviewSchedule: {},
    portfolio: [],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTab(value: unknown): value is DashboardTab {
  return typeof value === "string" && dashboardTabs.includes(value as DashboardTab);
}

function numberInRange(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readMastery(value: unknown): MasteryRecord | undefined {
  if (!isObject(value) || typeof value.skillId !== "string") return undefined;
  return {
    skillId: value.skillId,
    score: numberInRange(value.score, 0, 100, 0),
    confidence: numberInRange(value.confidence, 0, 1, 0),
    independentEvidence: numberInRange(value.independentEvidence, 0, Number.MAX_SAFE_INTEGER, 0),
    totalEvidence: numberInRange(value.totalEvidence, 0, Number.MAX_SAFE_INTEGER, 0),
    lastDemonstratedAt: stringOrNull(value.lastDemonstratedAt),
  };
}

function readAttempt(value: unknown): AttemptRecord | undefined {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.contentId !== "string") return undefined;
  if (typeof value.kind !== "string" || !attemptKinds.includes(value.kind as AttemptKind)) return undefined;
  if (typeof value.completedAt !== "string") return undefined;
  return {
    id: value.id,
    contentId: value.contentId,
    kind: value.kind as AttemptKind,
    score: numberInRange(value.score, 0, 1, 0),
    hintsUsed: numberInRange(value.hintsUsed, 0, Number.MAX_SAFE_INTEGER, 0),
    aiAssisted: value.aiAssisted === true,
    independent: value.independent === true,
    completedAt: value.completedAt,
  };
}

function readReview(value: unknown): ScheduledReview | undefined {
  if (!isObject(value) || typeof value.skillId !== "string" || typeof value.dueAt !== "string") return undefined;
  if (typeof value.reason !== "string" || !reviewReasons.includes(value.reason as ScheduledReview["reason"])) return undefined;
  return { skillId: value.skillId, dueAt: value.dueAt, reason: value.reason as ScheduledReview["reason"] };
}

function readPortfolio(value: unknown): PortfolioSnapshot | undefined {
  if (!isObject(value) || typeof value.projectId !== "string" || typeof value.title !== "string" || typeof value.feedback !== "string" || typeof value.completedAt !== "string") return undefined;
  if (!isObject(value.sourceFiles) || !Array.isArray(value.tests) || !Array.isArray(value.skillIds)) return undefined;
  const sourceFiles = Object.fromEntries(Object.entries(value.sourceFiles).filter(([, content]) => typeof content === "string")) as Record<string, string>;
  const tests = value.tests.flatMap((test) => isObject(test) && typeof test.name === "string" && typeof test.passed === "boolean" ? [{ name: test.name, passed: test.passed }] : []);
  const skillIds = value.skillIds.filter((skillId): skillId is string => typeof skillId === "string");
  return {
    projectId: value.projectId,
    title: value.title,
    sourceFiles,
    tests,
    feedback: value.feedback,
    score: numberInRange(value.score, 0, 1, 0),
    skillIds,
    completedAt: value.completedAt,
  };
}

function recordsFrom(value: unknown, reader: (entry: unknown) => { skillId: string } | undefined) {
  const entries = Array.isArray(value) ? value : isObject(value) ? Object.values(value) : [];
  return Object.fromEntries(entries.flatMap((entry) => {
    const record = reader(entry);
    return record ? [[record.skillId, record]] : [];
  }));
}

/** Migrates legacy payloads and discards malformed fields rather than throwing during hydration. */
export function migrateState(value: unknown): LearningState {
  const defaults = createDefaultState();
  if (!isObject(value)) return defaults;

  const dashboardSource = isObject(value.dashboard) ? value.dashboard : {};
  const diagnosticSource = isObject(value.diagnostic) ? value.diagnostic : {};
  const activeTab = isTab(dashboardSource.activeTab) ? dashboardSource.activeTab : isTab(value.activeDashboardTab) ? value.activeDashboardTab : defaults.dashboard.activeTab;
  const diagnosticCompleted = diagnosticSource.completed === true || value.diagnosticCompleted === true;
  const completedAt = stringOrNull(diagnosticSource.completedAt);
  const rawMastery = value.mastery;
  const rawReviews = value.reviewSchedule ?? value.reviews;

  return {
    version: STATE_VERSION,
    dashboard: { activeTab },
    diagnostic: { completed: diagnosticCompleted, completedAt: diagnosticCompleted ? completedAt : null },
    attempts: Array.isArray(value.attempts) ? value.attempts.flatMap((attempt) => {
      const record = readAttempt(attempt);
      return record ? [record] : [];
    }) : [],
    mastery: recordsFrom(rawMastery, readMastery) as Record<string, MasteryRecord>,
    reviewSchedule: recordsFrom(rawReviews, readReview) as Record<string, ScheduledReview>,
    portfolio: (Array.isArray(value.portfolio) ? value.portfolio : Array.isArray(value.completedProjects) ? value.completedProjects : []).flatMap((project) => {
      const snapshot = readPortfolio(project);
      return snapshot ? [snapshot] : [];
    }),
  };
}

function storage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function clone(state: LearningState): LearningState {
  return JSON.parse(JSON.stringify(state)) as LearningState;
}

export function getState(): LearningState {
  const browserStorage = storage();
  if (!browserStorage) return createDefaultState();
  try {
    const serialized = browserStorage.getItem(STORAGE_KEY);
    return serialized ? migrateState(JSON.parse(serialized)) : createDefaultState();
  } catch {
    return createDefaultState();
  }
}

export function saveState(nextState: LearningState): LearningState {
  const normalized = migrateState(nextState);
  const browserStorage = storage();
  if (browserStorage) {
    try {
      browserStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Local-first persistence is best-effort when storage is unavailable or full.
    }
  }
  return clone(normalized);
}

export function resetState(): LearningState {
  const browserStorage = storage();
  if (browserStorage) {
    try {
      browserStorage.removeItem(STORAGE_KEY);
    } catch {
      // A locked browser storage area should not prevent the UI from resetting in memory.
    }
  }
  return createDefaultState();
}
