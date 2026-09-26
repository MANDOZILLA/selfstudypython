import { missions as missions1, reviewTasks as reviewTasks1 } from "./missions";
import { MISSIONS_2, MISSION_2_REVIEW_TASKS } from "./missions-2";
import { skills as skillRegistry } from "./skills";

export const missions = [...missions1, ...MISSIONS_2];
export const reviewTasks = [...reviewTasks1, ...MISSION_2_REVIEW_TASKS];
export { DIAGNOSTIC_CORE_SKILLS, DIAGNOSTIC_ITEMS, DIAGNOSTIC_SKILLS } from "./diagnostic-items";
export type { DiagnosticItem, DiagnosticSkillId } from "./diagnostic-items";
export { PORTFOLIO_PROJECTS } from "./skills";
export type { PortfolioProjectId } from "./skills";

export const skills = skillRegistry;

// Compatibility view for the old workbench. Content comes from authored missions.
export const lessons = missions.map(mission => {
  const task = mission.stages[2].tasks[0];
  const variant = task.variants[0];
  return {
    id: mission.id, title: mission.title, skillId: mission.introducedSkillIds[0] ?? mission.revisitedSkillIds[0], estimatedMinutes: mission.estimatedMinutes,
    objectives: task.requirements.slice(0, 2), explanation: task.explanation, examples: task.examples,
    exercise: { id: variant.exerciseId, graderId: variant.graderId, starterFiles: variant.starterFiles, visibleRequirements: task.requirements, hints: task.hints },
    dailyProject: mission.summary,
  };
});
export const projects = missions.map(mission => ({ id: `project-${mission.id}`, title: mission.stages[2].tasks[0].title, skillIds: mission.stages[2].tasks[0].skillIds, objective: mission.summary }));
import { ASSESSMENTS } from "./assessments";
export { ASSESSMENTS } from "./assessments";
export type { Assessment, AssessmentTask, AssessmentTaskKind } from "./assessments";
// Backwards-compatible summary view (existing curriculum schema shape).
export const assessments: { id: string; title: string; skillIds: string[] }[] = ASSESSMENTS.map(a => ({
  id: a.id,
  title: a.title,
  skillIds: [...new Set(a.tasks.map(t => t.skillId))],
}));
