import { z } from "zod";
import { attemptSchema, missionRunSchema } from "./mission-types";
import type { LearningState } from "./state";
import { diagnosticStateSchema } from "./diagnostic-types";

export const MAX_STATE_BYTES = 2_000_000;
const evidenceSchema = z.object({ skillId: z.string(), status: z.enum(["Not started", "Practicing", "Demonstrated in project", "Demonstrated again later", "Mastered"]), independentSuccesses: z.number().int().nonnegative(), distinctContexts: z.number().int().nonnegative(), attemptCount: z.number().int().nonnegative(), lastDemonstratedAt: z.string().nullable(), taughtAt: z.string().nullable(), evidenceAttemptIds: z.array(z.string()) });
export const learningStateSchema: z.ZodType<LearningState> = z.object({
  version: z.literal(2), dashboard: z.object({ activeTab: z.enum(["overview", "lessons", "learned", "assessment", "portfolio"]) }),
  diagnostic: diagnosticStateSchema,
  attempts: z.array(attemptSchema), missionRuns: z.array(missionRunSchema),
  mastery: z.record(z.string(), evidenceSchema),
  reviewSchedule: z.record(z.string(), z.object({ skillId: z.string(), dueAt: z.string().datetime(), reason: z.enum(["practice", "retrieval", "repair"]), intervalDays: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14)]) })),
  portfolio: z.array(z.object({ projectId: z.string(), title: z.string(), sourceFiles: z.record(z.string(), z.string()), tests: z.array(z.object({ name: z.string(), passed: z.boolean() })), feedback: z.string(), score: z.number().min(0).max(1), skillIds: z.array(z.string()), completedAt: z.string().datetime() })),
}).strict();
export const saveRequestSchema = z.object({ operation: z.enum(["save", "import"]), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1), requestId: z.string().uuid(), state: learningStateSchema, learningMode: z.boolean() }).strict();
export const receiptSchema = z.object({ revision: z.number().int().nonnegative(), requestId: z.string().uuid() }).strict();
export const snapshotSchema = z.object({ state: learningStateSchema, revision: z.number().int().nonnegative(), initialized: z.boolean(), legacyImported: z.boolean(), learningMode: z.boolean() }).strict();
export const errorSchema = z.object({ code: z.enum(["invalid", "conflict", "unavailable", "forbidden", "method"]), message: z.string() }).strict();
export type SaveRequest = z.infer<typeof saveRequestSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export class PersistenceError extends Error {
  constructor(public code: z.infer<typeof errorSchema>["code"]) {
    super(code === "conflict" ? "Your saved work changed in another tab. Export your pending work, then reload before continuing." : code === "invalid" ? "The saved work is invalid or too large. Export a copy for recovery." : code === "forbidden" ? "This request must come from your local studio." : code === "method" ? "This request method is not supported." : "Your local database is unavailable. Keep this page open and retry.");
  }
}
