import type { MissionDefinition, MissionRun } from "../../lib/mission-types";

export function StageRail({ mission, run }: { mission: MissionDefinition; run?: MissionRun }) {
  return <ol className="stage-rail" aria-label="Mission stages">
    {mission.stages.map((stage, index) => {
      const completed = run?.stages[index].status === "completed";
      const current = Boolean(run && run.stageIndex === index && run.status !== "completed");
      return <li key={stage.id} className={current ? "current" : ""} aria-current={current ? "step" : undefined}>
        <span className="stage-number" aria-hidden="true">{completed ? "✓" : index + 1}</span>
        <span><strong>{stage.title}</strong><small>{stage.estimatedMinutes} min{current ? " · Current" : completed ? " · Done" : ""}</small></span>
      </li>;
    })}
  </ol>;
}
