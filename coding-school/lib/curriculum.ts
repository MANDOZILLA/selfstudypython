import { z } from "zod";
import * as source from "../curriculum";

const skillSchema = z.object({ id: z.string(), title: z.string(), prerequisites: z.array(z.string()) });
const lessonSchema = z.object({ id: z.string(), title: z.string(), skillId: z.string(), estimatedMinutes: z.number(), objectives: z.array(z.string()).min(2), explanation: z.string(), examples: z.array(z.string()).min(2), exercise: z.object({ id: z.string().min(1), graderId: z.string().min(1), starterFiles: z.record(z.string(), z.string()), visibleRequirements: z.array(z.string()).min(2), hints: z.array(z.string()).length(4) }), dailyProject: z.string() });
const projectSchema = z.object({ id: z.string(), title: z.string(), skillIds: z.array(z.string()), objective: z.string() });
export const curriculumSchema = z.object({ skills: z.array(skillSchema), lessons: z.array(lessonSchema), projects: z.array(projectSchema), assessments: z.array(z.object({ id: z.string(), title: z.string(), skillIds: z.array(z.string()) })) });
export const curriculum = { skills: source.skills, lessons: source.lessons, projects: source.projects, assessments: source.assessments };
export const validateCurriculum = (value: unknown) => curriculumSchema.safeParse(value);
export type Lesson = z.infer<typeof lessonSchema>;
