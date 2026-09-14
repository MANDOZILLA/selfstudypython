import { z } from "zod";

export const diagnosticItemSchema = z.object({
  id: z.string().min(1), skillId: z.string(), difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  kind: z.enum(["short", "code"]), title: z.string().min(8), prompt: z.string().min(20),
  expectedBehavior: z.string().min(10), hint: z.string().min(10), context: z.string(),
  starter: z.string().optional(), graderId: z.string().optional(),
  rubric: z.object({ accepted: z.array(z.string()).optional(), elements: z.array(z.string()).optional(), reject: z.array(z.string()).optional() }).optional(),
});
export type DiagnosticItem = z.infer<typeof diagnosticItemSchema>;
export const diagnosticDraftSchema = z.object({ answer: z.string(), sourceFiles: z.record(z.string(), z.string()), hintsUsed: z.number().int().min(0).max(1), aiAssisted: z.boolean() });
export type DiagnosticDraft = z.infer<typeof diagnosticDraftSchema>;
const check = z.object({ id: z.string(), name: z.string(), passed: z.boolean(), required: z.boolean(), detail: z.string() });
export const diagnosticAttemptSchema = z.object({ id: z.string(), itemId: z.string(), sourceFiles: z.record(z.string(), z.string()), graderId: z.string(), graderVersion: z.string(), passed: z.boolean(), executionOk: z.boolean(), checks: z.array(check), hintsUsed: z.number().int().min(0).max(1), aiAssisted: z.boolean(), completedAt: z.string().datetime() });
export type DiagnosticAttempt = z.infer<typeof diagnosticAttemptSchema>;
export const diagnosticResponseSchema = z.object({ id: z.string(), itemId: z.string(), answer: z.string(), outcome: z.enum(["passed", "needs-practice", "skipped"]), feedback: z.string(), attemptId: z.string().nullable(), hintsUsed: z.number().int().min(0).max(1), aiAssisted: z.boolean(), completedAt: z.string().datetime() });
export type DiagnosticResponse = z.infer<typeof diagnosticResponseSchema>;
export const diagnosticProfileSchema = z.object({ skillId: z.string(), band: z.enum(["Strong evidence", "Working evidence", "Needs practice", "Untested"]), confidence: z.enum(["None", "Limited", "Varied", "Conflicting"]), evidenceCount: z.number().int().nonnegative(), conceptualCount: z.number().int().nonnegative(), codingCount: z.number().int().nonnegative(), latestResult: z.enum(["passed", "needs-practice", "skipped"]).nullable(), responseIds: z.array(z.string()), attemptIds: z.array(z.string()), notes: z.string() });
export type DiagnosticProfile = z.infer<typeof diagnosticProfileSchema>;
export const diagnosticSessionSchema = z.object({ id: z.string(), version: z.enum(["1.0.0", "1.1.0"]), legacy: z.boolean().optional(), status: z.enum(["active", "completed"]), currentItemId: z.string().nullable(), drafts: z.record(z.string(), diagnosticDraftSchema), attempts: z.array(diagnosticAttemptSchema), responses: z.array(diagnosticResponseSchema), profile: z.array(diagnosticProfileSchema), startedAt: z.string().datetime(), completedAt: z.string().datetime().nullable() });
export type DiagnosticSession = z.infer<typeof diagnosticSessionSchema>;
export const diagnosticStateSchema = z.object({ completed: z.boolean(), completedAt: z.string().datetime().nullable(), sessions: z.array(diagnosticSessionSchema).optional() });
export type DiagnosticState = z.infer<typeof diagnosticStateSchema>;
