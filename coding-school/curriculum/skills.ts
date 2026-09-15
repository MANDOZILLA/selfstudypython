/** Stable curriculum skill registry.
 *
 * The adaptive diagnostic probes a subset of these skills (see
 * DIAGNOSTIC_CORE_SKILLS in diagnostic-items.ts); the missions below promote
 * the diagnostic-only probes into taught skills and add the data-science
 * layer. Prerequisites form a DAG: every prerequisite appears earlier in this
 * list, so missions can introduce skills in list order without cycles.
 */
export interface CurriculumSkill {
  id: string;
  title: string;
  prerequisites: string[];
}

export const skills: CurriculumSkill[] = [
  { id: "python-functions", title: "Functions and return contracts", prerequisites: [] },
  { id: "python-exceptions", title: "Exceptions and error handling", prerequisites: ["python-functions"] },
  { id: "data-structures", title: "Ordered record transformations", prerequisites: ["python-functions"] },
  { id: "file-io", title: "File I/O with context managers", prerequisites: ["python-exceptions"] },
  { id: "csv-cleaning", title: "CSV parsing and row validation", prerequisites: ["data-structures"] },
  { id: "financial-data", title: "Exact money validation", prerequisites: ["data-structures"] },
  { id: "json-validation", title: "JSON envelopes and nested validation", prerequisites: ["data-structures"] },
  { id: "pandas-data-quality", title: "Pandas missing-data and data quality", prerequisites: ["csv-cleaning"] },
  { id: "sqlite-analytics", title: "SQLite transactions, joins and aggregation", prerequisites: ["data-structures", "python-exceptions"] },
  { id: "http-reliability", title: "HTTP reliability and retries", prerequisites: ["json-validation", "python-exceptions"] },
  { id: "llm-output-validation", title: "Validating LLM output", prerequisites: ["json-validation", "python-exceptions"] },
];

/** Stable portfolio projects that mission build tasks attach to. */
export const PORTFOLIO_PROJECTS = [
  { id: "portfolio-data-pipeline", title: "Payments data pipeline" },
  { id: "portfolio-api-normalization", title: "API response normalization" },
  { id: "portfolio-money-reconciliation", title: "Money reconciliation and anomaly detection" },
  { id: "portfolio-llm-guardrails", title: "Deterministic LLM output guardrails" },
] as const;
export type PortfolioProjectId = (typeof PORTFOLIO_PROJECTS)[number]["id"];
