/** Stable curriculum skill registry — and the placement ladder.
 *
 * List order IS the learning order: placement climbs this list from the top,
 * one rung per skill, and stops at the first skill the learner does not know.
 * Missions teach the skills in the same order. Prerequisites form a DAG and
 * every prerequisite appears earlier in this list, so the ladder never asks
 * about a skill before the skills it builds on.
 *
 * Existing skill ids are kept unchanged: stored attempts reference them.
 */
export interface CurriculumSkill {
  id: string;
  title: string;
  prerequisites: string[];
}

export const skills: CurriculumSkill[] = [
  // Beginner rungs: zero to writing small programs.
  { id: "py-values", title: "Values, variables, and printing", prerequisites: [] },
  { id: "py-conditionals", title: "Booleans and if / elif / else", prerequisites: ["py-values"] },
  { id: "py-loops", title: "Loops: for, while, and range", prerequisites: ["py-conditionals"] },
  { id: "py-lists-strings", title: "Lists and strings", prerequisites: ["py-loops"] },
  { id: "python-functions", title: "Functions and return values", prerequisites: ["py-lists-strings"] },
  { id: "py-dicts", title: "Dictionaries", prerequisites: ["py-lists-strings"] },
  // Intermediate rungs: robust programs.
  { id: "python-exceptions", title: "Exceptions and error handling", prerequisites: ["python-functions"] },
  { id: "file-io", title: "Reading and writing files", prerequisites: ["python-exceptions"] },
  { id: "py-classes", title: "Classes and objects", prerequisites: ["python-functions", "py-dicts"] },
  { id: "data-structures", title: "Records: lists of dicts, comprehensions, sorting", prerequisites: ["python-functions", "py-dicts"] },
  // Applied rungs: real data work.
  { id: "csv-cleaning", title: "CSV parsing and row validation", prerequisites: ["data-structures", "file-io"] },
  { id: "financial-data", title: "Exact money with Decimal", prerequisites: ["data-structures"] },
  { id: "json-validation", title: "JSON and nested validation", prerequisites: ["data-structures", "python-exceptions"] },
  { id: "pandas-data-quality", title: "Pandas and data quality", prerequisites: ["csv-cleaning"] },
  { id: "sqlite-analytics", title: "SQL with SQLite: joins and aggregation", prerequisites: ["data-structures", "python-exceptions"] },
  { id: "http-reliability", title: "HTTP clients, retries, and timeouts", prerequisites: ["json-validation", "python-exceptions"] },
  { id: "llm-output-validation", title: "Validating LLM output", prerequisites: ["json-validation", "py-classes"] },
];

/** Stable portfolio projects that mission build tasks attach to. */
export const PORTFOLIO_PROJECTS = [
  { id: "portfolio-data-pipeline", title: "Payments data pipeline" },
  { id: "portfolio-api-normalization", title: "API response normalization" },
  { id: "portfolio-money-reconciliation", title: "Money reconciliation and anomaly detection" },
  { id: "portfolio-llm-guardrails", title: "Deterministic LLM output guardrails" },
] as const;
export type PortfolioProjectId = (typeof PORTFOLIO_PROJECTS)[number]["id"];
