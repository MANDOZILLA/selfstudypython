import JSZip from "jszip";
import { getPortfolioProject } from "../curriculum/portfolio-projects";
import { verifyPortfolioSnapshot, type PortfolioSnapshot } from "./portfolio";

/**
 * Deterministic GitHub-ready ZIP export for portfolio projects.
 *
 * The export is derived only from frozen completion snapshots: README,
 * .gitignore, the learner's source, fixtures, and the named unittest files.
 * Output is byte-identical across runs (sorted entries, fixed timestamps,
 * stored compression) and fails closed on unsafe paths or secret-looking
 * content.
 */

export class ZipSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipSafetyError";
  }
}

export interface ExportFile {
  /** Path inside the zip, relative to the archive root. */
  path: string;
  content: string;
}

/** Fixed timestamp for every zip entry, so builds are byte-identical. */
const ZIP_ENTRY_DATE = new Date("2020-01-01T00:00:00Z");

/** Collapse a title into a safe directory name; never empty. */
export function sanitizeDirName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "project";
}

/**
 * Reject any zip path that could escape the archive: absolute paths,
 * parent-directory traversal (either separator), null bytes, or empty names.
 */
export function assertSafeZipPath(path: string): void {
  if (!path) throw new ZipSafetyError("Zip entry path must not be empty");
  if (path.includes("\0")) throw new ZipSafetyError(`Zip entry path contains a null byte: ${path}`);
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("/")) throw new ZipSafetyError(`Zip entry path must be relative: ${path}`);
  if (/^[a-zA-Z]:\//.test(normalized)) throw new ZipSafetyError(`Zip entry path must not be a drive path: ${path}`);
  if (normalized.split("/").some((part) => part === "..")) {
    throw new ZipSafetyError(`Zip entry path must not traverse directories: ${path}`);
  }
}

const EXCLUDED_FILE_PATTERN =
  /(^|\/)\.env(\.|$)|(^|\/)secrets?(\.|$)|(^|\/)credentials?(\.|$)|(^|\/)id_rsa|(^|\/)\.pem$|\.pem$|\.key$|\.p12$|\.pfx$|\.db$|\.sqlite3?$|\.db-shm$|\.db-wal$|(^|\/)solution[^/]*$|(^|\/)reference[^/]*$|(^|\/)answer[^/]*$|(^|\/)history[^/]*\.json$|(^|\/)recovery[^/]*\.json$|(^|\/)state[^/]*\.json$/i;

function isExcludedFileName(name: string): boolean {
  return EXCLUDED_FILE_PATTERN.test(name);
}

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{16,}/,
  /AKIA[0-9A-Z]{16}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:api[_-]?key|api[_-]?secret|secret[_-]?key|access[_-]?token|bearer)\b\s*[:=]\s*["'][A-Za-z0-9_\-+/=]{16,}["']/i,
];

/**
 * Fail closed when any exported file looks like it contains a real secret.
 * Short placeholder values (e.g. `"api_key": "test"`) are allowed.
 */
export function scanForSecrets(files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        throw new ZipSafetyError(`Refusing to export ${name}: content looks like a secret`);
      }
    }
  }
}

const GITIGNORE = `# Python
__pycache__/
*.py[cod]
*.egg-info/
.venv/
venv/
# Test and coverage artifacts
.pytest_cache/
.coverage
htmlcov/
# OS and editor noise
.DS_Store
Thumbs.db
*.swp
# Local secrets and state (never commit these)
.env
.env.*
*.db
*.sqlite3
`;

const REQUIREMENTS = `# Runtime dependencies for this portfolio project.
#
# Standard library only, unless noted per component below.
# - csv-repair, crash-log-scanner, json-normalization, money-reconciliation,
#   http-pagination, llm-guardrails: Python 3.10+ standard library only.
# - data-quality: pandas (pip install pandas)
`;

function componentReadme(component: { title: string; objective: string; directory: string; testFileName: string; fixtureFiles: Record<string, string> }): string {
  const fixtures = Object.keys(component.fixtureFiles).sort();
  return [
    `## ${component.title}`,
    ``,
    component.objective,
    ``,
    `### Layout`,
    ``,
    `- \`${component.directory}/main.py\` — the learner's completed solution.`,
    ...fixtures.map((f) => `- \`${component.directory}/fixtures/${f}\` — sample input fixture.`),
    `- \`${component.directory}/${component.testFileName}\` — exported named tests (unittest).`,
    ``,
    `### Run the checks`,
    ``,
    "```sh",
    `cd ${component.directory}`,
    `python3 -m unittest discover -s . -p "test_*.py"`,
    "```",
    ``,
  ].join("\n");
}

function projectReadme(
  project: { title: string; objective: string },
  components: { title: string; objective: string; directory: string; testFileName: string; fixtureFiles: Record<string, string> }[],
  snapshots: PortfolioSnapshot[],
): string {
  const lines = [
    `# ${projectTitle(project.title)}`,
    ``,
    project.objective,
    ``,
    `Completed ${snapshots.length} component${snapshots.length === 1 ? "" : "s"} in the Workbench School portfolio track.`,
    `Each component below is self-contained: its own source, fixtures, and named tests.`,
    ``,
    ...components.flatMap((c) => componentReadme(c)),
    `## Integrity`,
    ``,
    `Each component directory was sealed into an immutable completion snapshot when its build task passed. The snapshot records the learner's source, fixtures, named test outcomes, score, assistance used, skills demonstrated, reflection, grader version, and a SHA-256 content hash.`,
    ``,
  ];
  return lines.join("\n");
}

function projectTitle(title: string): string {
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * Build the ordered file list for a project's export. All content comes from
 * the frozen snapshots (never from live curriculum definitions), unsafe
 * paths and excluded files are rejected, and every file is secret-scanned.
 */
export function buildExportFileList(projectId: string, snapshots: PortfolioSnapshot[]): ExportFile[] {
  const project = getPortfolioProject(projectId);
  if (!project) throw new ZipSafetyError(`Unknown portfolio project: ${projectId}`);
  const byComponent = new Map(snapshots.map((s) => [s.componentId, s]));
  for (const snapshot of snapshots) {
    const label = snapshot.id;
    if (!verifyPortfolioSnapshot(snapshot)) {
      throw new ZipSafetyError(`Snapshot ${label} failed integrity verification`);
    }
    if (snapshot.projectId !== projectId) {
      throw new ZipSafetyError(`Snapshot ${label} does not belong to project ${projectId}`);
    }
  }

  const root = sanitizeDirName(project.title);
  const files: ExportFile[] = [];
  const seen = new Set<string>();
  const addFile = (path: string, content: string) => {
    assertSafeZipPath(path);
    const fileName = path.split("/").pop() ?? "";
    if (isExcludedFileName(fileName)) return;
    const full = `${root}/${path}`;
    if (seen.has(full)) throw new ZipSafetyError(`Duplicate export path: ${full}`);
    seen.add(full);
    files.push({ path: full, content });
  };

  const components = project.components.map((component) => {
    const snapshot = byComponent.get(component.taskId);
    if (!snapshot) throw new ZipSafetyError(`Missing snapshot for component ${component.taskId}`);
    return { component, snapshot };
  });

  for (const { component, snapshot } of components) {
    const dir = component.directory;
    assertSafeZipPath(dir);
    for (const [name, content] of Object.entries(snapshot.sourceFiles)) addFile(`${dir}/${name}`, content);
    for (const [name, content] of Object.entries(snapshot.fixtures)) addFile(`${dir}/fixtures/${name}`, content);
    for (const [name, content] of Object.entries(snapshot.exportFiles)) addFile(`${dir}/${name}`, content);
  }

  files.push({
    path: `${root}/README.md`,
    content: projectReadme(project, project.components, snapshots),
  });
  files.push({ path: `${root}/.gitignore`, content: GITIGNORE });
  files.push({ path: `${root}/requirements.txt`, content: REQUIREMENTS });

  scanForSecrets(Object.fromEntries(files.map((f) => [f.path, f.content])));
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Generate the deterministic zip archive. Pass "nodebuffer" in tests and
 * server-side code, "blob" for the browser download path.
 */
export async function generatePortfolioZip(
  projectId: string,
  snapshots: PortfolioSnapshot[],
  output: "nodebuffer",
): Promise<Buffer>;
export async function generatePortfolioZip(
  projectId: string,
  snapshots: PortfolioSnapshot[],
  output: "blob",
): Promise<Blob>;
export async function generatePortfolioZip(
  projectId: string,
  snapshots: PortfolioSnapshot[],
  output: "nodebuffer" | "blob",
): Promise<Buffer | Blob> {
  const files = buildExportFileList(projectId, snapshots);
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.path, file.content, { date: ZIP_ENTRY_DATE, compression: "STORE" });
  }
  if (output === "blob") return zip.generateAsync({ type: "blob" });
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer as Buffer;
}
