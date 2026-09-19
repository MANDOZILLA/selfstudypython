/** Explicit fresh profile for the isolated verification database. */
export function createEmptyVerificationState() {
  return {
    version: 3,
    dashboard: { activeTab: "overview" },
    diagnostic: { completed: false, completedAt: null },
    attempts: [],
    missionRuns: [],
    diagnosticSessions: [],
    assessmentAttempts: [],
    mastery: {},
    reviewSchedule: {},
    portfolio: [],
  };
}
