import { z } from "zod";
import * as source from "../curriculum";
import { missionDefinitionSchema, missionTaskSchema } from "./mission-types";
import { getGrader } from "../public/grading/catalog.js";
export type { MissionDefinition, MissionStage, MissionTask, TaskVariant } from "./mission-types";

const skillSchema = z.object({ id: z.string(), title: z.string(), prerequisites: z.array(z.string()) });
const lessonSchema = z.object({ id: z.string(), title: z.string(), skillId: z.string(), estimatedMinutes: z.number(), objectives: z.array(z.string()).min(2), explanation: z.string(), examples: z.array(z.string()).min(2), exercise: z.object({ id: z.string().min(1), graderId: z.string().min(1), starterFiles: z.record(z.string(), z.string()), visibleRequirements: z.array(z.string()).min(2), hints: z.array(z.string()).length(4) }), dailyProject: z.string() });
const projectSchema = z.object({ id: z.string(), title: z.string(), skillIds: z.array(z.string()), objective: z.string() });
export const curriculumSchema = z.object({ skills: z.array(skillSchema), lessons: z.array(lessonSchema), projects: z.array(projectSchema), assessments: z.array(z.object({ id: z.string(), title: z.string(), skillIds: z.array(z.string()) })), missions: z.array(missionDefinitionSchema), reviewTasks: z.array(missionTaskSchema) }).superRefine((data, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const skills = new Set(data.skills.map(s => s.id));
  const ids: string[] = [];
  for (const skill of data.skills) if (skill.prerequisites.some(id => !skills.has(id))) fail(`Unknown prerequisite for ${skill.id}`);
  const tasks = [...data.reviewTasks];
  data.missions.forEach((mission, index) => {
    ids.push(mission.id);
    if (mission.prerequisites.some(id => !data.missions.slice(0, index).some(m => m.id === id))) fail(`Invalid prerequisite order for ${mission.id}`);
    if ([...mission.introducedSkillIds, ...mission.revisitedSkillIds].some(id => !skills.has(id))) fail(`Unknown mission skill: ${mission.id}`);
    if (mission.stages.map(s => s.kind).join() !== "review,learn,build,explain") fail(`Invalid stage order: ${mission.id}`);
    if (mission.estimatedMinutes < 30 || mission.estimatedMinutes > 60 || mission.stages.reduce((n, s) => n + s.estimatedMinutes, 0) !== mission.estimatedMinutes || mission.stages[0].estimatedMinutes > 5) fail(`Invalid pacing budget: ${mission.id}`);
    for (const stage of mission.stages) { ids.push(stage.id); tasks.push(...stage.tasks); }
  });
  for (const task of tasks) {
    ids.push(task.id);
    if ([...task.skillIds, ...task.introducedSkillIds].some(id => !skills.has(id))) fail(`Unknown task skill: ${task.id}`);
    for (const variant of task.variants) {
      if (task.kind !== "code") continue;
      const grader = getGrader(variant.exerciseId, variant.graderId);
      if (!grader) fail(`Unavailable grader for ${task.id}`);
      if (task.skillIds.some(id => !variant.skillChecks[id]?.length)) fail(`Missing skill checks: ${task.id}`);
      for (const [skillId, checks] of Object.entries(variant.skillChecks)) {
        if (!skills.has(skillId) || checks.some(id => !grader?.requiredTests.includes(id))) fail(`Invalid skill/check reference: ${task.id}`);
      }
    }
  }
  if (new Set(ids).size !== ids.length) fail("Duplicate mission, stage or task ID");
});
export const curriculum = { skills: source.skills, lessons: source.lessons, projects: source.projects, assessments: source.assessments, missions: source.missions, reviewTasks: source.reviewTasks };
export const validateCurriculum = (value: unknown) => curriculumSchema.safeParse(value);
export type Lesson = z.infer<typeof lessonSchema>;
export const getMission = (id: string) => curriculum.missions.find(m => m.id === id);
export const getTask = (id: string) => [...curriculum.missions.flatMap(m => m.stages.flatMap(s => s.tasks)), ...curriculum.reviewTasks].find(t => t.id === id);
