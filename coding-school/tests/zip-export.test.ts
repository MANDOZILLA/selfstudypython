import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { CURRICULUM_VERSION } from "../lib/curriculum";
import { findPortfolioComponent, getPortfolioProject } from "../curriculum/portfolio-projects";
import { createPortfolioSnapshot, type PortfolioSnapshot } from "../lib/portfolio";
import {
  ZipSafetyError,
  assertSafeZipPath,
  buildExportFileList,
  generatePortfolioZip,
  sanitizeDirName,
  scanForSecrets,
} from "../lib/zip-export";
import { reference as csvReference } from "./grading.test";
import { jsonReference } from "./mission-graders.test";
import {
  httpProjectReference,
  llmProjectReference,
  moneyProjectReference,
  pandasProjectReference,
  recoveryProjectReference,
} from "./mission-graders-2.test";

const AT = "2026-09-14T12:00:00.000Z";
const TASK_SOURCES: Record<string, string> = {
  "csv-project": csvReference,
  "crash-log-scanner": recoveryProjectReference,
  "pandas-quality-project": pandasProjectReference,
  "money-csv-project": moneyProjectReference,
  "json-project": jsonReference,
  "http-pagination-project": httpProjectReference,
  "llm-pipeline-project": llmProjectReference,
};

function snapshotFor(taskId: string): PortfolioSnapshot {
  const found = findPortfolioComponent(taskId);
  if (!found) throw new Error(`No portfolio component for ${taskId}`);
  return createPortfolioSnapshot({
    projectId: found.project.id,
    projectVersion: found.project.version,
    componentId: taskId,
    title: found.component.title,
    objective: found.component.objective,
    sourceFiles: { "main.py": TASK_SOURCES[taskId] },
    fixtures: { ...found.component.fixtureFiles },
    exportFiles: { [found.component.testFileName]: found.component.testFileContent },
    tests: [],
    score: 1,
    result: "passed",
    assistance: { hintsUsed: 0, aiAssisted: false, solutionViewed: false },
    skillsDemonstrated: [],
    reflection: "",
    completedAt: AT,
    graderId: found.component.graderId,
    graderVersion: "1.0.0",
    curriculumVersion: CURRICULUM_VERSION,
  });
}

function snapshotsForProject(projectId: string): PortfolioSnapshot[] {
  const project = getPortfolioProject(projectId);
  if (!project) throw new Error(`Unknown project ${projectId}`);
  return project.components.map((c) => snapshotFor(c.taskId));
}

async function extractZip(buffer: Buffer, dir: string): Promise<void> {
  const zip = await JSZip.loadAsync(buffer);
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const content = await entry.async("nodebuffer");
    const target = join(dir, path);
    mkdirSync(join(dir, path.split("/").slice(0, -1).join("/")), { recursive: true });
    writeFileSync(target, content);
  }
}

function readmeShellBlocks(readme: string): string[] {
  return [...readme.matchAll(/```sh\n([\s\S]*?)```/g)].map((m) => m[1].trim()).filter(Boolean);
}

describe("zip export safety", () => {
  it("sanitizes project directory names", () => {
    expect(sanitizeDirName("Payments Data Pipeline")).toBe("payments-data-pipeline");
    expect(sanitizeDirName("My Cool_Project! v2")).toBe("my-cool-project-v2");
    expect(sanitizeDirName("../../../etc")).toBe("etc");
    expect(sanitizeDirName("")).toBe("project");
    expect(sanitizeDirName("---")).toBe("project");
  });

  it("rejects path traversal and absolute paths", () => {
    for (const bad of ["../../evil.py", "a/../../b.py", "/etc/passwd", "..\\win.py", "", "a/\0b.py", "fixtures/..\\..\\x"]) {
      expect(() => assertSafeZipPath(bad), bad).toThrow(ZipSafetyError);
    }
    for (const good of ["main.py", "fixtures/sample.csv", "README.md", ".gitignore", "test_main.py"]) {
      expect(() => assertSafeZipPath(good)).not.toThrow();
    }
  });

  it("refuses to export content that looks like a secret", () => {
    expect(() => scanForSecrets({ "main.py": 'API_KEY = "sk-abcdefghijklmnopqrstuvwx"' })).toThrow(ZipSafetyError);
    expect(() => scanForSecrets({ "main.py": "key = 'AKIAIOSFODNN7EXAMPLE'" })).toThrow(ZipSafetyError);
    expect(() => scanForSecrets({ "notes.txt": "-----BEGIN PRIVATE KEY-----\nabc" })).toThrow(ZipSafetyError);
    // A field merely named api_key with a short placeholder value is not a secret.
    expect(() => scanForSecrets({ "main.py": 'payload = {"api_key": "test"}' })).not.toThrow();
    expect(() => scanForSecrets({ "main.py": "def solve(text):\n    return []\n" })).not.toThrow();
  });

  it("excludes hidden solution, env, database, and history files", () => {
    const clean = snapshotFor("csv-project");
    // Re-seal with hostile extra files: the export must drop them, not fail.
    const hostile = createPortfolioSnapshot({
      projectId: clean.projectId,
      projectVersion: clean.projectVersion,
      componentId: clean.componentId,
      title: clean.title,
      objective: clean.objective,
      sourceFiles: { ...clean.sourceFiles, "solution.py": "reference", "reference_final.py": "reference" },
      fixtures: { ...clean.fixtures, ".env": "APP_MODE=test", "learner.db": "binary" },
      exportFiles: clean.exportFiles,
      tests: clean.tests,
      score: clean.score,
      result: clean.result,
      assistance: clean.assistance,
      skillsDemonstrated: clean.skillsDemonstrated,
      reflection: clean.reflection,
      completedAt: clean.completedAt,
      graderId: clean.graderId,
      graderVersion: clean.graderVersion,
      curriculumVersion: clean.curriculumVersion,
    });
    const files = buildExportFileList("portfolio-data-pipeline", [
      hostile,
      snapshotFor("crash-log-scanner"),
      snapshotFor("pandas-quality-project"),
    ]);
    const paths = files.map((f) => f.path);
    expect(paths.some((p) => p.includes("solution.py"))).toBe(false);
    expect(paths.some((p) => p.includes("reference_final.py"))).toBe(false);
    expect(paths.some((p) => p.includes(".env"))).toBe(false);
    expect(paths.some((p) => p.includes("learner.db"))).toBe(false);
    expect(paths.some((p) => p.endsWith("/main.py"))).toBe(true);
  });

  it("rejects traversal file names instead of silently rewriting them", () => {
    const clean = snapshotFor("csv-project");
    const hostile = createPortfolioSnapshot({
      projectId: clean.projectId,
      projectVersion: clean.projectVersion,
      componentId: clean.componentId,
      title: clean.title,
      objective: clean.objective,
      sourceFiles: { ...clean.sourceFiles, "../../evil.py": "print('x')" },
      fixtures: clean.fixtures,
      exportFiles: clean.exportFiles,
      tests: clean.tests,
      score: clean.score,
      result: clean.result,
      assistance: clean.assistance,
      skillsDemonstrated: clean.skillsDemonstrated,
      reflection: clean.reflection,
      completedAt: clean.completedAt,
      graderId: clean.graderId,
      graderVersion: clean.graderVersion,
      curriculumVersion: clean.curriculumVersion,
    });
    expect(() => buildExportFileList("portfolio-data-pipeline", [
      hostile,
      snapshotFor("crash-log-scanner"),
      snapshotFor("pandas-quality-project"),
    ])).toThrow(ZipSafetyError);
  });

  it("fails closed on unknown projects and components", () => {
    const snapshot = snapshotFor("csv-project");
    expect(() => buildExportFileList("no-such-project", [snapshot])).toThrow();
    const badComponent: PortfolioSnapshot = { ...snapshot, componentId: "no-such-task" };
    expect(() => buildExportFileList("portfolio-data-pipeline", [badComponent])).toThrow();
  });

  it("produces byte-identical zips across runs", async () => {
    const snapshots = snapshotsForProject("portfolio-data-pipeline");
    const first = await generatePortfolioZip("portfolio-data-pipeline", snapshots, "nodebuffer");
    const second = await generatePortfolioZip("portfolio-data-pipeline", snapshots, "nodebuffer");
    expect(first.equals(second)).toBe(true);
    expect(first.length).toBeGreaterThan(1000);
  });

  it("contains the GitHub-ready file set", async () => {
    const snapshots = snapshotsForProject("portfolio-data-pipeline");
    const buffer = await generatePortfolioZip("portfolio-data-pipeline", snapshots, "nodebuffer");
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    expect(names).toContain("payments-data-pipeline/README.md");
    expect(names).toContain("payments-data-pipeline/requirements.txt");
    expect(names).toContain("payments-data-pipeline/.gitignore");
    expect(names).toContain("payments-data-pipeline/csv-repair/main.py");
    expect(names).toContain("payments-data-pipeline/csv-repair/fixtures/sample-payments.csv");
    expect(names).toContain("payments-data-pipeline/csv-repair/test_csv_repair.py");
    expect(names).toContain("payments-data-pipeline/data-quality/test_data_quality.py");
    const readme = await zip.files["payments-data-pipeline/README.md"].async("string");
    expect(readme).toContain("Payments data pipeline");
    expect(readmeShellBlocks(readme).length).toBeGreaterThan(0);
  });
});

describe("exported projects run after extraction", () => {
  it.each([
    ["portfolio-data-pipeline", 3],
    ["portfolio-money-reconciliation", 1],
    ["portfolio-api-normalization", 2],
    ["portfolio-llm-guardrails", 1],
  ])("README commands pass for %s (%i components)", async (projectId, components) => {
    const snapshots = snapshotsForProject(projectId);
    expect(snapshots).toHaveLength(components);
    const buffer = await generatePortfolioZip(projectId, snapshots, "nodebuffer");
    const dir = mkdtempSync(join(tmpdir(), "portfolio-export-"));
    await extractZip(buffer, dir);

    const zip = await JSZip.loadAsync(buffer);
    const root = Object.keys(zip.files).find((n) => n.endsWith("/README.md") && n.split("/").length === 2);
    expect(root).toBeDefined();
    const projectDir = root!.split("/")[0];
    const readme = await zip.files[root!].async("string");
    const blocks = readmeShellBlocks(readme);
    expect(blocks.length).toBe(components);
    for (const block of blocks) {
      execFileSync("sh", ["-c", block], { cwd: join(dir, projectDir), timeout: 180000, stdio: "pipe" });
    }
  }, 300000);
});
