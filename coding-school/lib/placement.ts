/**
 * Placement → starting point. The ladder scan (lib/diagnostic.ts) reports the
 * skills the learner already knows and the first one they don't. This module
 * turns that into a course position: every mission before the first mission
 * that teaches the gap skill is "placed out" — it no longer blocks unlocks,
 * stays open for practice, and never counts as completed evidence.
 */
import { curriculum } from "./curriculum";
import { DIAGNOSTIC_SESSION_VERSION, derivePlacement, latestCompletedDiagnosticSession, type PlacementResult } from "./diagnostic";
import type { LearningState } from "./state";

export interface PlacementPlan {
  placement: PlacementResult;
  /** First mission the learner should actually do. Null only for an empty curriculum. */
  startMissionId: string | null;
  /** Missions before the start, in curriculum order. */
  placedOutMissionIds: string[];
  completedAt: string;
}

/** Plan from the latest completed, current-format placement. Legacy sessions place nothing. */
export function placementPlan(state: LearningState): PlacementPlan | null {
  const session = latestCompletedDiagnosticSession(state.diagnosticSessions);
  if (!session?.completedAt || session.formatVersion !== DIAGNOSTIC_SESSION_VERSION) return null;
  const placement = derivePlacement(session);
  const missions = curriculum.missions;
  if (!missions.length) return { placement, startMissionId: null, placedOutMissionIds: [], completedAt: session.completedAt };
  const known = new Set(placement.knownSkillIds);
  let start = placement.gapSkillId
    ? missions.findIndex(m => m.introducedSkillIds.includes(placement.gapSkillId!))
    : missions.length - 1;
  // A gap no mission introduces (should not happen): fall back to the first
  // mission that introduces anything the learner has not shown.
  if (start < 0) start = missions.findIndex(m => m.introducedSkillIds.some(id => !known.has(id)));
  if (start < 0) start = missions.length - 1;
  return {
    placement,
    startMissionId: missions[start].id,
    placedOutMissionIds: missions.slice(0, start).map(m => m.id),
    completedAt: session.completedAt,
  };
}

export function placedOutMissionIds(state: LearningState): Set<string> {
  return new Set(placementPlan(state)?.placedOutMissionIds ?? []);
}
