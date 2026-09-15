import { missions, reviewTasks } from "./missions";
export { missions, reviewTasks };
export { DIAGNOSTIC_CORE_SKILLS, DIAGNOSTIC_ITEMS, DIAGNOSTIC_SKILLS } from "./diagnostic-items";
export type { DiagnosticItem, DiagnosticSkillId } from "./diagnostic-items";

export const skills = [
  { id: "python-functions", title: "Functions and return contracts", prerequisites: [] },
  { id: "data-structures", title: "Ordered record transformations", prerequisites: ["python-functions"] },
  { id: "csv-cleaning", title: "CSV parsing and row validation", prerequisites: ["data-structures"] },
  { id: "financial-data", title: "Exact money validation", prerequisites: ["data-structures"] },
  { id: "json-validation", title: "JSON envelopes and nested validation", prerequisites: ["data-structures"] },
];

// Compatibility view for the old workbench. Content comes from authored missions.
export const lessons = missions.map(mission => {
  const task = mission.stages[2].tasks[0];
  const variant = task.variants[0];
  return {
    id: mission.id, title: mission.title, skillId: mission.introducedSkillIds[0], estimatedMinutes: mission.estimatedMinutes,
    objectives: task.requirements.slice(0, 2), explanation: task.explanation, examples: task.examples,
    exercise: { id: variant.exerciseId, graderId: variant.graderId, starterFiles: variant.starterFiles, visibleRequirements: task.requirements, hints: task.hints },
    dailyProject: mission.summary,
  };
});
export const projects = missions.map(mission => ({ id: `project-${mission.id}`, title: mission.stages[2].tasks[0].title, skillIds: mission.stages[2].tasks[0].skillIds, objective: mission.summary }));
export const assessments: { id: string; title: string; skillIds: string[] }[] = [];
