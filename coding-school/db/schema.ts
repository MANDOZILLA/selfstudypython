import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// The versioned SQL migration owns all checks, FKs and indexes. These mappings
// give repository reads/writes typed Drizzle bindings without copying curriculum.
export const learnerMeta = sqliteTable("learner_meta", {
  id: integer("id").primaryKey(), revision: integer("revision").notNull(), initialized: integer("initialized", { mode: "boolean" }).notNull(),
  legacyImported: integer("legacy_imported", { mode: "boolean" }).notNull(), activeTab: text("active_tab").notNull(), learningMode: integer("learning_mode", { mode: "boolean" }).notNull(),
});
export const missionRuns = sqliteTable("mission_runs", { id: text("id").primaryKey(), missionId: text("mission_id").notNull(), missionVersion: text("mission_version").notNull(), status: text("status").notNull(), stageIndex: integer("stage_index").notNull(), position: integer("position").notNull(), payload: text("payload").notNull() });
export const missionStages = sqliteTable("mission_stages", { runId: text("run_id").notNull(), stageId: text("stage_id").notNull(), position: integer("position").notNull(), status: text("status").notNull(), payload: text("payload").notNull() });
export const missionDrafts = sqliteTable("mission_drafts", { runId: text("run_id").notNull(), taskId: text("task_id").notNull(), payload: text("payload").notNull() });
export const attempts = sqliteTable("attempts", { id: text("id").primaryKey(), runId: text("run_id").notNull(), stageId: text("stage_id").notNull(), taskId: text("task_id").notNull(), position: integer("position").notNull(), passed: integer("passed", { mode: "boolean" }).notNull(), completedAt: text("completed_at").notNull(), payload: text("payload").notNull() });
export const attemptChecks = sqliteTable("attempt_checks", { attemptId: text("attempt_id").notNull(), position: integer("position").notNull(), checkId: text("check_id").notNull(), passed: integer("passed", { mode: "boolean" }).notNull(), payload: text("payload").notNull() });
export const attemptOutcomes = sqliteTable("attempt_outcomes", { attemptId: text("attempt_id").notNull(), position: integer("position").notNull(), skillId: text("skill_id").notNull(), payload: text("payload").notNull() });
export const reviewSchedules = sqliteTable("review_schedules", { skillId: text("skill_id").primaryKey(), dueAt: text("due_at").notNull(), intervalDays: integer("interval_days").notNull(), payload: text("payload").notNull() });
export const portfolioSnapshots = sqliteTable("portfolio_snapshots", { position: integer("position").primaryKey(), projectId: text("project_id").notNull(), payload: text("payload").notNull() });
export const diagnosticSessions = sqliteTable("diagnostic_sessions", { id: text("id").primaryKey(), completed: integer("completed", { mode: "boolean" }).notNull(), completedAt: text("completed_at"), profileJson: text("profile_json").notNull() });
export const saveReceipts = sqliteTable("save_receipts", { requestId: text("request_id").primaryKey(), payloadHash: text("payload_hash").notNull(), revision: integer("revision").notNull() });
