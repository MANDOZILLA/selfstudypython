import { z } from "zod";

export const assistanceSchema = z.object({ hintsUsed: z.number().int().nonnegative(), aiAssisted: z.boolean(), solutionViewed: z.boolean() });
export const taskVariantSchema = z.object({
  id: z.string().min(1), contextId: z.string().min(1), exerciseId: z.string(), graderId: z.string(),
  starterFiles: z.record(z.string(), z.string()),
  skillChecks: z.record(z.string(), z.array(z.string()).min(1)),
});
export const missionTaskSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), kind: z.enum(["instruction", "code", "explanation"]),
  purpose: z.enum(["instruction", "guided-practice", "project", "retrieval", "reflection"]),
  skillIds: z.array(z.string()), introducedSkillIds: z.array(z.string()),
  explanation: z.string().min(20), examples: z.array(z.string()).min(1),
  requirements: z.array(z.string()).min(1), hints: z.array(z.string()),
  variants: z.array(taskVariantSchema).min(1),
});
export const missionStageSchema = z.object({
  id: z.string().min(1), kind: z.enum(["review", "learn", "build", "explain"]), title: z.string(),
  estimatedMinutes: z.number().positive(), advanceRule: z.enum(["attempt-review", "complete-tasks"]), tasks: z.array(missionTaskSchema),
});
export const missionDefinitionSchema = z.object({
  id: z.string().min(1), version: z.string().min(1), title: z.string(), summary: z.string(),
  prerequisites: z.array(z.string()), introducedSkillIds: z.array(z.string()), revisitedSkillIds: z.array(z.string()),
  estimatedMinutes: z.number().positive(), stages: z.array(missionStageSchema).length(4),
});
export type MissionDefinition = z.infer<typeof missionDefinitionSchema>;
export type MissionStage = z.infer<typeof missionStageSchema>;
export type MissionTask = z.infer<typeof missionTaskSchema>;
export type TaskVariant = z.infer<typeof taskVariantSchema>;
export type Assistance = z.infer<typeof assistanceSchema>;

const date = z.string().datetime();
export const draftSchema = z.object({ sourceFiles: z.record(z.string(), z.string()), response: z.string(), assistance: assistanceSchema, updatedAt: date });
export const missionRunSchema = z.object({
  mode: z.enum(["mission", "review"]),
  id: z.string().min(1), missionId: z.string(), missionVersion: z.string(), status: z.enum(["active", "paused", "completed"]),
  stageIndex: z.number().int().min(0).max(3),
  stages: z.array(z.object({ stageId: z.string(), status: z.enum(["pending", "active", "completed"]), taskIds: z.array(z.string()), attemptIds: z.array(z.string()), completedAt: date.nullable() })).length(4),
  drafts: z.record(z.string(), draftSchema), attemptIds: z.array(z.string()), startedAt: date, updatedAt: date, completedAt: date.nullable(),
});
export const checkSchema = z.object({ id: z.string(), name: z.string(), required: z.boolean(), passed: z.boolean(), detail: z.string() });
export const attemptSchema = z.object({
  id: z.string().min(1), runId: z.string(), missionId: z.string(), missionVersion: z.string(), stageId: z.string(), taskId: z.string(), variantId: z.string(), contextId: z.string(),
  graderId: z.string(), graderVersion: z.string(), sourceFiles: z.record(z.string(), z.string()), sourceHash: z.string(), resultHash: z.string(),
  checks: z.array(checkSchema), skillOutcomes: z.array(z.object({ skillId: z.string(), passed: z.boolean(), checkIds: z.array(z.string()) })),
  introducedSkillIds: z.array(z.string()), assistance: assistanceSchema, purpose: missionTaskSchema.shape.purpose,
  passed: z.boolean(), executionOk: z.boolean(), response: z.string(), completedAt: date, duplicateOf: z.string().nullable(),
});
export type MissionRun = z.infer<typeof missionRunSchema>;
export type MissionDraft = z.infer<typeof draftSchema>;
export type AttemptRecord = z.infer<typeof attemptSchema>;
export type AttemptSubmission = {
  variantId: string; sourceFiles: Record<string, string>; assistance: Assistance; response?: string;
  result?: { graderVersion: string; executionOk: boolean; tests: z.infer<typeof checkSchema>[] };
};
