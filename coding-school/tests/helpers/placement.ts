import { curriculum } from "../../lib/curriculum";
import { answerConcept, createDiagnosticSession, finishPlacementEarly, markUnknown, nextDiagnosticItem, recordCodingOutcome, type DiagnosticSession } from "../../lib/diagnostic";
import { DIAGNOSTIC_ITEMS } from "../../curriculum/diagnostic-items";

const right = () => ({ correct: true, detail: "test: correct" });

/**
 * A completed, current-format placement whose first gap is `gapSkillId`
 * (null = every rung passed). Built through the real diagnostic API: every
 * earlier rung is answered correctly, the gap rung gets "I do not know".
 */
export function placementSession(gapSkillId: string | null, now = new Date("2026-01-05T09:00:00Z")): DiagnosticSession {
  let session = createDiagnosticSession(now);
  for (let guard = 0; guard < 200; guard++) {
    const item = nextDiagnosticItem(session);
    if (!item) break;
    if (item.skillId === gapSkillId) { session = markUnknown(session, item, now); break; }
    session = item.kind === "concept"
      ? answerConcept(session, item, "test answer", right, now)
      : recordCodingOutcome(session, item, { kind: "graded", passed: true, executionOk: true, graderVersion: "test" }, "# test", now);
  }
  return finishPlacementEarly(session, now);
}

/** Skill a mission introduces first: placing the gap there makes that mission the start. */
export function gapForMission(missionId: string): string | null {
  const mission = curriculum.missions.find(m => m.id === missionId);
  if (!mission) throw new Error(`Unknown mission ${missionId}`);
  return mission.introducedSkillIds[0] ?? null;
}

/** Placement session that starts the learner at `missionId`. */
export function placedAt(missionId: string, now?: Date): DiagnosticSession {
  return placementSession(gapForMission(missionId), now);
}

export { DIAGNOSTIC_ITEMS };
