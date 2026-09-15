import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { AttemptRecord, MissionRun } from "../lib/mission-types";
import type { DiagnosticSession } from "../lib/diagnostic";
import type { ReviewSchedule } from "../lib/adaptive";

/**
 * Durable learner state. Tables are explicit per entity (preferred over a
 * single kv table) so sessions, attempts, and runs stay queryable; each row
 * carries the full validated payload as JSON because learner state is
 * document-shaped and always re-validated through zod on load.
 */
export const attempts = sqliteTable("attempts", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  updatedAt: text("updated_at").notNull(),
  payload: text("payload", { mode: "json" }).$type<AttemptRecord>().notNull(),
});

export const missionRuns = sqliteTable("mission_runs", {
  id: text("id").primaryKey(),
  updatedAt: text("updated_at").notNull(),
  payload: text("payload", { mode: "json" }).$type<MissionRun>().notNull(),
});

export const diagnosticSessions = sqliteTable("diagnostic_sessions", {
  id: text("id").primaryKey(),
  updatedAt: text("updated_at").notNull(),
  payload: text("payload", { mode: "json" }).$type<DiagnosticSession>().notNull(),
});

export const reviewState = sqliteTable("review_state", {
  skillId: text("skill_id").primaryKey(),
  updatedAt: text("updated_at").notNull(),
  payload: text("payload", { mode: "json" }).$type<ReviewSchedule>().notNull(),
});

/** Singleton row (id "singleton") holding dashboard tab, diagnostic summary, and portfolio. */
export const stateMeta = sqliteTable("state_meta", {
  id: text("id").primaryKey(),
  updatedAt: text("updated_at").notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
});

export const dbMeta = sqliteTable("db_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
