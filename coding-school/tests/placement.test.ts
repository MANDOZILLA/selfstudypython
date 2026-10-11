import { describe, expect, it } from "vitest";
import { selectToday } from "../lib/adaptive";
import { curriculum } from "../lib/curriculum";
import { createDefaultState } from "../lib/state";
import { getDashboardModel, getLibraryRows } from "../lib/studio";
import { placementPlan } from "../lib/placement";
import { recommendNext } from "../lib/recommend";
import { gapForMission, placedAt, placementSession } from "./helpers/placement";

const NOW = new Date("2026-10-01T12:00:00.000Z");

describe("placement plan", () => {
  it("places a total beginner at first-steps without placing out any mission", () => {
    const state = { ...createDefaultState(), diagnosticSessions: [placementSession("py-values")] };
    const plan = placementPlan(state)!;
    expect(plan.startMissionId).toBe("first-steps");
    expect(plan.placedOutMissionIds).toEqual([]);
    expect(plan.placement.knownSkillIds).toEqual([]);
  });

  it("starts at classes-objects when py-classes is the first gap and places out eight earlier missions", () => {
    const state = { ...createDefaultState(), diagnosticSessions: [placementSession("py-classes")] };
    const plan = placementPlan(state)!;
    expect(plan.startMissionId).toBe("classes-objects");
    expect(plan.placedOutMissionIds).toEqual(curriculum.missions.slice(0, 8).map(m => m.id));
    expect(plan.placedOutMissionIds).toHaveLength(8);
  });

  it("starts at the final mission after passing every rung", () => {
    const state = { ...createDefaultState(), diagnosticSessions: [placementSession(null)] };
    expect(placementPlan(state)?.startMissionId).toBe(curriculum.missions.at(-1)?.id);
  });

  it("ignores a legacy-format session and starts at first-steps", () => {
    const current = placedAt("classes-objects");
    const legacy = { ...current, formatVersion: "2.0.0" };
    const state = { ...createDefaultState(), diagnosticSessions: [legacy] };
    expect(placementPlan(state)).toBeNull();
    expect(selectToday(state, NOW).missionId).toBe("first-steps");
  });

  it("selects the placement start mission for today", () => {
    const state = { ...createDefaultState(), diagnosticSessions: [placedAt("csv-foundations")] };
    expect(selectToday(state, NOW)).toMatchObject({ kind: "mission", missionId: "csv-foundations" });
  });

  it("marks earlier missions placed out without blocking them and unlocks the start", () => {
    const state = { ...createDefaultState(), diagnosticSessions: [placedAt("classes-objects")] };
    const rows = getLibraryRows(state);
    const placed = rows.find(row => row.mission.id === "first-steps")!;
    const start = rows.find(row => row.mission.id === "classes-objects")!;
    expect(placed.status).toBe("Placed out");
    expect(placed.blockedReason).toBeNull();
    expect(start.status).toBe("Not started");
    expect(start.blockedReason).toBeNull();
  });

  it("does not count placed-out missions as completed or progress evidence", () => {
    const state = { ...createDefaultState(), diagnosticSessions: [placedAt("classes-objects")] };
    expect(getDashboardModel(state, NOW).completedMissions).toBe(0);
    expect(getDashboardModel(state, NOW).evidence).toEqual([]);
    expect(getDashboardModel(state, NOW).reviews).toEqual([]);
    expect(getLibraryRows(state).filter(row => row.status === "Completed")).toHaveLength(0);
  });

  it("recommends the placed learner's start and names known skills and the first new topic", () => {
    const state = { ...createDefaultState(), diagnosticSessions: [placedAt("classes-objects")] };
    const recommendation = recommendNext(state, NOW);
    expect(recommendation).toMatchObject({ action: "start-mission", missionId: "classes-objects" });
    expect(recommendation.reason).toMatch(/already know/i);
    expect(recommendation.reason).toMatch(/first new topic/i);
    expect(recommendation.reason).toContain(curriculum.skills.find(s => s.id === gapForMission("classes-objects"))!.title);
  });
});
