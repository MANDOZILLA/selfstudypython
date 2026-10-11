import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CONCEPT_RUN_IDLE, ConceptSandbox, DiagnosticStudio, conceptRunRequest, conceptScratchDraft,
  conceptSandboxOutput, nextDiagnosticPanel, type ConceptRunState,
} from "../app/studio/diagnostic";
import type { Studio } from "../app/studio/use-studio";
import { COMPACT_MAX_WIDTH, NAV_WIDTH_PX, THREE_PANE_MIN_WIDTH } from "../app/studio/workbench-resizer";
import { DIAGNOSTIC_ITEMS } from "../curriculum";
import { createDiagnosticSession, DIAGNOSTIC_UNKNOWN_ANSWER, saveDiagnosticDraft, type DiagnosticSession } from "../lib/diagnostic";
import { createDefaultState } from "../lib/state";
import { runStatus } from "../lib/studio";
import { executedResult, validRequest, verifyWorkerResult } from "../public/grading/protocol.js";

/**
 * Focused presentation tests for the diagnostic studio:
 * 1. A visible "I do not know" action on both question kinds — honest
 *    evidence, never a graded answer.
 * 2. The coding view is instructions | editor | checks on desktop, split by
 *    two labelled keyboard-operable separators, with the mobile tab flow.
 * 3. Placement copy names the AP CSP starting point and the flexible coding
 *    evidence (runs or declarations).
 * 4. The Monaco theme comes from useTheme()/monacoThemeFor, never a hardcoded
 *    "light" theme.
 * 5. The concept workspace puts directions/hints on top, the written answer on
 *    the left and a scratch Python sandbox (editor + always-visible output) on
 *    the right, stacked by CSS at narrow widths — with no tabs. Its run is
 *    execute-only: it can never grade, count as evidence, or advance the
 *    session, and its draft lives in session.draftCode.
 */

const readSource = (file: string) => readFileSync(new URL(`../app/${file}`, import.meta.url), "utf8");

const conceptItem = DIAGNOSTIC_ITEMS.find(item => item.kind === "concept")!;
const codingItem = DIAGNOSTIC_ITEMS.find(item => item.kind === "coding")!;

function sessionOn(itemId: string): DiagnosticSession {
  const session = createDiagnosticSession();
  return { ...session, currentItemId: itemId };
}

function studioFor(session: DiagnosticSession, overrides: Record<string, unknown> = {}): Studio {
  return {
    state: { ...createDefaultState(), diagnosticSessions: [session] },
    route: { destination: "today", diagnosticSessionId: session.id },
    storageError: null,
    diagnosticResult: null,
    diagnosticStatus: "Ready",
    diagnosticBusy: false,
    diagnosticStale: false,
    navigate: () => {},
    startDiagnostic: () => {},
    retakeDiagnostic: () => {},
    openDiagnosticSession: () => {},
    updateDiagnosticDraft: () => {},
    revealDiagnosticHint: () => {},
    answerDiagnosticConcept: () => {},
    markDiagnosticUnknown: () => {},
    runDiagnosticCode: () => {},
    stopDiagnosticRun: () => {},
    finishDiagnostic: () => {},
    ...overrides,
  } as unknown as Studio;
}

const render = (studio: Studio) => renderToStaticMarkup(<DiagnosticStudio studio={studio} />);
const separatorTags = (html: string) => [...html.matchAll(/<div[^>]*role="separator"[^>]*>/g)].map(match => match[0]);
const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const runButtonTag = (html: string) => html.match(/<button[^>]*id="diagnostic-run-scratch"[^>]*>/)?.[0] ?? "";

describe("I do not know actions", () => {
  it("offers a visible declaration button on concept questions", () => {
    const html = render(studioFor(sessionOn(conceptItem.id)));
    expect(html).toContain(`>${DIAGNOSTIC_UNKNOWN_ANSWER}</button>`);
    expect(html).toContain("Submit answer");
    expect(html).toContain("recorded as a knowledge gap");
    // The declaration must not pre-fill the typed answer box.
    expect(html).toContain('id="diagnostic-answer"');
  });

  it("offers the same declaration on coding questions, beside the run action", () => {
    const html = render(studioFor(sessionOn(codingItem.id)));
    expect(html).toContain(`>${DIAGNOSTIC_UNKNOWN_ANSWER}</button>`);
    expect(html).toContain('id="diagnostic-run-checks"');
    expect(html).toContain("knowledge gap");
    expect(html).toContain("never counts as a successful run");
  });

  it("keeps hints available on both question kinds", () => {
    for (const item of [conceptItem, codingItem]) {
      const html = render(studioFor(sessionOn(item.id)));
      expect(html).toContain(`Reveal hint 1 of ${item.hints.length}`);
    }
  });
});

describe("coding view layout", () => {
  const html = render(studioFor(sessionOn(codingItem.id)));

  it("renders exactly two separators, focusable and labelled", () => {
    const tags = separatorTags(html);
    expect(tags).toHaveLength(2);
    for (const tag of tags) {
      expect(attr(tag, "tabindex")).toBe("0");
      expect(attr(tag, "aria-orientation")).toBe("vertical");
      expect(attr(tag, "aria-label")).toMatch(/^Resize .+ panes$/);
      expect(attr(tag, "aria-valuetext")).toMatch(/percent$/);
    }
    expect(attr(tags[0], "data-split")).toBe("left");
    expect(attr(tags[1], "data-split")).toBe("right");
  });

  it("orders panes as instructions | resizer | code | resizer | checks", () => {
    const tags = separatorTags(html);
    const order = [
      html.indexOf('id="diagnostic-panel-instructions"'),
      html.indexOf(tags[0]),
      html.indexOf('id="diagnostic-panel-code"'),
      html.indexOf(tags[1]),
      html.indexOf('id="diagnostic-panel-checks"'),
    ];
    expect(order.every(position => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });

  it("points each separator at the panes it divides", () => {
    const tags = separatorTags(html);
    expect(attr(tags[0], "aria-controls")).toBe("diagnostic-panel-instructions diagnostic-panel-code");
    expect(attr(tags[1], "aria-controls")).toBe("diagnostic-panel-code diagnostic-panel-checks");
  });

  it("publishes a value inside its declared range", () => {
    for (const tag of separatorTags(html)) {
      const now = Number(attr(tag, "aria-valuenow"));
      const min = Number(attr(tag, "aria-valuemin"));
      const max = Number(attr(tag, "aria-valuemax"));
      expect(Number.isFinite(now)).toBe(true);
      expect(now).toBeGreaterThanOrEqual(min);
      expect(now).toBeLessThanOrEqual(max);
    }
  });

  it("exposes the split proportions as CSS custom properties", () => {
    expect(html).toContain("--dg-left");
    expect(html).toContain("--dg-right");
  });

  it("keeps the mobile tab flow: three tabs with roving tabindex", () => {
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map(match => match[0]);
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toContain('id="diagnostic-tab-instructions"');
    expect(tabs[0]).toContain('aria-selected="true"');
    expect(tabs[0]).toMatch(/tabindex="0"/i);
    for (const tab of tabs.slice(1)) expect(tab).toMatch(/tabindex="-1"/i);
    expect(html).toContain('aria-controls="diagnostic-panel-code"');
    expect(html).toContain('role="tablist"');
  });

  it("renders checks and output as a labelled region with a live status", () => {
    expect(html).toContain('aria-label="Checks and output"');
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"/);
    expect(html).toContain("Run your Python to see each check");
  });
});

describe("nextDiagnosticPanel", () => {
  it("moves right and wraps", () => {
    expect(nextDiagnosticPanel("instructions", "ArrowRight")).toBe("code");
    expect(nextDiagnosticPanel("checks", "ArrowRight")).toBe("instructions");
  });
  it("moves left and wraps", () => {
    expect(nextDiagnosticPanel("code", "ArrowLeft")).toBe("instructions");
    expect(nextDiagnosticPanel("instructions", "ArrowLeft")).toBe("checks");
  });
  it("jumps to first/last on Home/End", () => {
    expect(nextDiagnosticPanel("checks", "Home")).toBe("instructions");
    expect(nextDiagnosticPanel("instructions", "End")).toBe("checks");
  });
  it("ignores other keys", () => {
    expect(nextDiagnosticPanel("code", "Enter")).toBe("code");
  });
});

describe("placement copy", () => {
  const html = render(studioFor(sessionOn(conceptItem.id)));

  it("names the placement scan and keeps the intro concise", () => {
    expect(html).toContain("Placement scan");
    expect(html).toContain("Your results guide practice");
    expect(html).not.toContain("AP CSP");
    expect(html).not.toContain("% complete");
  });

  it("shows question number, skill chip, and accessible progress", () => {
    expect(html).toContain('class="chip chip-cyan">Q 1');
    expect(html).toContain('class="chip chip-violet"');
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("of up to");
  });

  it("explains the honest unknown path and wires the shared answer constant to its button", () => {
    expect(html).toContain(`title="Record a knowledge gap instead of answering. It is never graded."`);
    expect(html).toContain(`>${DIAGNOSTIC_UNKNOWN_ANSWER}</button>`);
    expect(html).toContain(`Choose “${DIAGNOSTIC_UNKNOWN_ANSWER}”`);
  });
});

describe("dark Monaco theme", () => {
  it("derives the diagnostic editor theme from useTheme instead of hardcoding it", () => {
    const source = readSource("studio/diagnostic.tsx");
    expect(source).not.toMatch(/theme="(light|vs|vs-dark)"/);
    expect(source).toContain("monacoThemeFor(theme)");
    expect(source).toMatch(/import \{[^}]*\bmonacoThemeFor\b[^}]*\buseTheme\b[^}]*\} from "\.\/theme"/);
  });
});

describe("console output after a run", () => {
  const runResult = {
    executionOk: false,
    passed: false,
    score: 0,
    graderVersion: 1,
    stdout: "hello from print()",
    stderr: "Traceback (most recent call last): boom",
    tests: [{ id: "prints", name: "prints a greeting", passed: true }],
  };

  it("shows stdout and stderr in the checks pane, not behind a disclosure", () => {
    const html = render(studioFor(sessionOn(codingItem.id), { diagnosticResult: runResult }));
    const checks = html.indexOf('aria-label="Checks and output"');
    const consoleBlock = html.indexOf("Console output");
    expect(checks).toBeGreaterThanOrEqual(0);
    expect(consoleBlock).toBeGreaterThan(checks);
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    expect(html).toContain("Standard output");
    expect(html).toContain("Standard error");
    expect(html).toContain("hello from print()");
    expect(html).toContain("Traceback (most recent call last): boom");
  });

  it("says so plainly when the run printed nothing", () => {
    const html = render(studioFor(sessionOn(codingItem.id), { diagnosticResult: { ...runResult, stdout: "", stderr: "" } }));
    expect(html).not.toContain("<details");
    expect(html).toContain("produced no standard output or errors");
  });

  it("keeps the console block out of the pane before a run", () => {
    const html = render(studioFor(sessionOn(codingItem.id)));
    expect(html).not.toContain("Console output");
  });
});

describe("responsive handoff to tabs", () => {
  const css = readSource("studio/diagnostic-layout.module.css");
  const source = readSource("studio/diagnostic.tsx");
  /** minmax() floors plus both 12px separators from the module grid. */
  const PANE_MIN_PX = 240 + 12 + 320 + 12 + 240;
  /** globals .dashboard side padding in the 1024-1350px band. */
  const DASHBOARD_GUTTER_PX = 64;
  /** Pane space left for the grid at a given viewport width. */
  const paneSpace = (viewport: number) => viewport < 1024
    // Mobile shell: the nav is a top bar, dashboard padding is 24px a side.
    ? viewport - 48
    : viewport - NAV_WIDTH_PX - DASHBOARD_GUTTER_PX;

  it("runs the three-pane grid only at 1200px and above", () => {
    expect(css).toContain("@media (min-width: 1200px)");
    expect(css).toContain("@media (max-width: 1199px)");
    expect(css).not.toMatch(/1023px|min-width:\s*1024px/);
    const start = css.indexOf("@media (min-width: 1200px)");
    const gridBand = css.slice(start, css.indexOf("@media (max-width: 1199px)"));
    const tabBand = css.slice(css.indexOf("@media (max-width: 1199px)"));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(gridBand).toContain("grid-template-columns");
    expect(gridBand).toContain("display: grid");
    expect(tabBand).not.toContain("grid-template-columns");
    expect(tabBand).toMatch(/\.tabs\s*\{\s*display: flex/);
  });

  it("reads the shared compact query instead of a narrower one of its own", () => {
    expect(source).toContain("COMPACT_QUERY");
    expect(source).not.toContain("max-width: 1023px");
    expect(THREE_PANE_MIN_WIDTH).toBe(COMPACT_MAX_WIDTH + 1);
  });

  it("hands off to tabs before the panes would clip (1024, 1100, 375)", () => {
    for (const viewport of [1024, 1100, 375]) expect(paneSpace(viewport)).toBeLessThan(PANE_MIN_PX);
  });

  it("shows all three panes at the desktop widths (1200, 1280)", () => {
    for (const viewport of [THREE_PANE_MIN_WIDTH, 1280]) expect(paneSpace(viewport)).toBeGreaterThanOrEqual(PANE_MIN_PX);
  });

  it("keeps every width where panes would clip inside the tab band", () => {
    const firstFit = PANE_MIN_PX + NAV_WIDTH_PX + DASHBOARD_GUTTER_PX;
    expect(paneSpace(firstFit - 1)).toBeLessThan(PANE_MIN_PX);
    expect(COMPACT_MAX_WIDTH).toBeGreaterThanOrEqual(firstFit - 1);
  });
});

describe("concept workspace layout", () => {
  const html = render(studioFor(sessionOn(conceptItem.id)));

  it("keeps the question, the written answer and the sandbox on one screen", () => {
    // No tabs: both regions stay mounted at every width, stacked by CSS only.
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('role="tab"');
    expect(html).toContain('id="diagnostic-answer"');
    expect(html).toContain('id="diagnostic-run-scratch"');
    expect(html).toContain('aria-label="Scratch run output"');
  });

  it("orders directions and hints first, then the answer side, then the sandbox", () => {
    const order = [
      html.indexOf('class="diagnostic-prompt"'),
      html.indexOf("Reveal hint 1 of"),
      html.indexOf('id="diagnostic-answer"'),
      html.indexOf('id="diagnostic-run-scratch"'),
      html.indexOf('aria-label="Scratch run output"'),
    ];
    expect(order.every(position => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });

  it("keeps the original written actions beside the answer box", () => {
    const answer = html.indexOf('id="diagnostic-answer"');
    const submit = html.indexOf(">Submit answer");
    const unknown = html.indexOf(`>${DIAGNOSTIC_UNKNOWN_ANSWER}</button>`);
    expect(answer).toBeGreaterThanOrEqual(0);
    expect(submit).toBeGreaterThan(answer);
    expect(unknown).toBeGreaterThan(submit);
    expect(unknown).toBeLessThan(html.indexOf('id="diagnostic-run-scratch"'));
  });

  it("mounts the Monaco editor with the shared loading fallback", () => {
    expect(html).toContain("Loading code editor");
    expect(html).toContain("Use plain text");
    expect(html).not.toContain('theme="light"');
    expect(html).not.toContain('theme="vs-dark"');
  });

  it("never exposes the graded coding runner on a concept question", () => {
    expect(html).not.toContain('id="diagnostic-run-checks"');
    expect(html).not.toContain("Checks and output");
    expect(html).not.toContain("Run checks");
    // A pre-existing graded result must not leak into the concept view either.
    const withResult = render(studioFor(sessionOn(conceptItem.id), {
      diagnosticResult: { executionOk: true, passed: true, score: 1, stdout: "GRADED_RESULT_MARKER", stderr: "", tests: [], graderVersion: "1.0.0" },
      diagnosticStatus: "Passed",
      diagnosticBusy: true,
    }));
    expect(withResult).not.toContain("GRADED_RESULT_MARKER");
    expect(withResult).toContain('aria-label="Scratch run output"');
  });
});

describe("concept sandbox run lifecycle", () => {
  const session = sessionOn(conceptItem.id);
  const sandbox = (run: ConceptRunState) => renderToStaticMarkup(
    <ConceptSandbox studio={studioFor(session)} session={session} item={conceptItem} run={run} onRun={() => {}} onStop={() => {}} />,
  );

  it("starts idle: a run action, a live status, and an always-visible output pane", () => {
    const html = sandbox(CONCEPT_RUN_IDLE);
    expect(html).toContain(">Run Python<");
    expect(html).toContain("Ready to run");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("nothing it prints is graded");
    expect(html).not.toContain("Stop run");
    expect(runButtonTag(html)).not.toContain("disabled");
  });

  it("while loading it shows the phase, disables Run, and offers Stop", () => {
    const html = sandbox({ requestId: "r1", busy: true, status: "Loading Python", result: null });
    expect(html).toContain("Loading Python");
    expect(html).toContain(">Stop run<");
    expect(runButtonTag(html)).toContain("disabled");
    expect(html).toContain('aria-live="polite"');
  });

  it("renders stdout and stderr plainly once the run finishes", () => {
    const request = conceptRunRequest("r2", session, conceptItem, "print(1)");
    const result = executedResult(request, { status: "ok" }, "hello", "a warning");
    const html = sandbox({ requestId: "r2", busy: false, status: runStatus(result), result });
    expect(html).toContain("Program output");
    expect(html).toContain("hello");
    expect(html).toContain("a warning");
    expect(html).toContain("Standard output");
    expect(html).toContain("Standard error");
    expect(html).not.toContain("<details");
  });

  it("says so when the program printed nothing at all", () => {
    const request = conceptRunRequest("r3", session, conceptItem, "");
    const html = sandbox({ requestId: "r3", busy: false, status: "Ran successfully", result: executedResult(request, { status: "ok" }, "", "") });
    expect(html).toContain("finished without printing anything");
    expect(html).not.toContain("Program output");
  });

  it("surfaces a crash with its message instead of a bare failure", () => {
    const request = conceptRunRequest("r4", session, conceptItem, "boom()");
    const result = executedResult(request, { status: "error", kind: "runtime", file: "main.py", line: 3, message: "name 'boom' is not defined" }, "partial", "");
    const html = sandbox({ requestId: "r4", busy: false, status: "Run failed", result });
    expect(html).toContain("The run stopped with an error.");
    expect(html).toContain('File &quot;main.py&quot;, line 3: name &#x27;boom&#x27; is not defined');
    expect(html).toContain("partial");
  });
});

describe("scratch runs are never graded or advanced", () => {
  const session = sessionOn(conceptItem.id);

  it("builds an execute-only request that the worker protocol accepts", () => {
    const request = conceptRunRequest("req-1", session, conceptItem, "print('hi')");
    expect(validRequest(request)).toBe(true);
    expect(request.mode).toBe("execute");
    expect(request.files).toEqual({ "main.py": "print('hi')" });
    expect(request.entrypoint).toBe("main.py");
    expect(request.graderId).toBe("");
    expect(request.exerciseId).toBe(conceptItem.id);
    expect(request.sessionId).toBe(session.id);
    expect(request.taskId).toBe(conceptItem.id);
  });

  it("accepts an empty buffer so the editor can be cleared to nothing", () => {
    expect(validRequest(conceptRunRequest("req-2", session, conceptItem, ""))).toBe(true);
  });

  it("can never come back as evidence: execute results carry no checks or score", () => {
    const request = conceptRunRequest("req-3", session, conceptItem, "x = 1");
    const ok = executedResult(request, { status: "ok" }, "hello", "");
    expect(ok.mode).toBe("executed");
    expect(ok.passed).toBe(false);
    expect(ok.score).toBe(0);
    expect(ok.tests).toEqual([]);
    expect(verifyWorkerResult(request, ok)).toEqual(ok);
    const failed = executedResult(request, { status: "error", kind: "runtime", file: "main.py", line: 1, message: "boom" }, "", "");
    expect(failed.executionOk).toBe(false);
    expect(verifyWorkerResult(request, failed)?.passed).toBe(false);
  });

  it("drops output that belongs to another run, session, or question", () => {
    const request = conceptRunRequest("req-4", session, conceptItem, "1");
    const stale = executedResult({ ...request, requestId: "req-older" }, { status: "ok" }, "old", "");
    expect(verifyWorkerResult(request, stale)).toBeNull();
    const otherSession = executedResult({ ...request, sessionId: "another-session" }, { status: "ok" }, "old", "");
    expect(verifyWorkerResult(request, otherSession)).toBeNull();
    const otherItem = executedResult({ ...request, taskId: "another-item" }, { status: "ok" }, "old", "");
    expect(verifyWorkerResult(request, otherItem)).toBeNull();
  });

  it("maps every outcome to a distinct output state", () => {
    const request = conceptRunRequest("req-5", session, conceptItem, "");
    expect(conceptSandboxOutput(null)).toEqual({ kind: "idle" });
    expect(conceptSandboxOutput(executedResult(request, { status: "ok" }, "", ""))).toEqual({ kind: "no-output" });
    expect(conceptSandboxOutput(executedResult(request, { status: "ok" }, "out", "err"))).toEqual({ kind: "output", stdout: "out", stderr: "err" });
    const error = executedResult(request, { status: "error", kind: "syntax", file: "main.py", line: 1, message: "invalid syntax" }, "partial", "");
    expect(conceptSandboxOutput(error)).toEqual({ kind: "error", message: error.stderr, stdout: "partial" });
  });
});

describe("concept scratch draft", () => {
  const session = sessionOn(conceptItem.id);

  it("reads the persisted draft straight from the session", () => {
    expect(conceptScratchDraft({ ...session, draftCode: "kept = 1" }, studioFor(session)).value).toBe("kept = 1");
    expect(conceptScratchDraft({ ...session, draftCode: "" }, studioFor(session)).value).toBe("");
  });

  it("writes only the code field, never the answer or a grading path", () => {
    const calls: string[] = [];
    const studio = studioFor(session, {
      updateDiagnosticDraft: () => calls.push("draft"),
      answerDiagnosticConcept: () => calls.push("submit"),
      markDiagnosticUnknown: () => calls.push("unknown"),
      runDiagnosticCode: () => calls.push("grade"),
      revealDiagnosticHint: () => calls.push("hint"),
    });
    conceptScratchDraft(session, studio).onChange("print(1)");
    expect(calls).toEqual(["draft"]);
  });

  it("persists an edit into session.draftCode without touching the response record", () => {
    let next: DiagnosticSession = session;
    const studio = studioFor(session, {
      updateDiagnosticDraft: (patch: { answer?: string; code?: string; hints?: number }) => { next = saveDiagnosticDraft(next, patch); },
    });
    conceptScratchDraft(next, studio).onChange("print('kept')");
    expect(next.draftCode).toBe("print('kept')");
    expect(next.draftAnswer).toBe(session.draftAnswer);
    expect(next.draftHints).toBe(session.draftHints);
    expect(next.responses).toEqual(session.responses);
    expect(next.currentItemId).toBe(session.currentItemId);
    expect(next.codingSuccessCount).toBe(session.codingSuccessCount);
  });
});

describe("concept workspace layout css", () => {
  const css = readSource("studio/diagnostic-layout.module.css");

  it("splits into two equal flexible regions with the directions spanning both", () => {
    const concept = css.slice(css.indexOf(".concept {"), css.indexOf("@media (min-width: 1200px)"));
    expect(concept).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)");
    expect(concept).toContain("grid-column: 1 / -1");
    expect(concept).toContain("min-width: 0");
  });

  it("stacks to a single track at narrow widths instead of tabbing away", () => {
    const stacked = css.match(/@media \(max-width: 879px\)\s*\{\s*\.concept\s*\{[^}]*/)?.[0] ?? "";
    expect(stacked).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(stacked).not.toContain("minmax(0, 1fr) minmax(0, 1fr)");
    expect(css).not.toMatch(/1023px|min-width:\s*1024px/);
  });

  it("gives the sandbox a definite editor track and an unhidden output pane", () => {
    const sandboxStart = css.indexOf(".conceptSandbox {");
    const answerEnd = css.indexOf(".conceptAnswer :global(.button-row)");
    expect(sandboxStart).toBeGreaterThanOrEqual(0);
    expect(answerEnd).toBeGreaterThan(sandboxStart);
    const sandbox = css.slice(sandboxStart, answerEnd);
    expect(sandbox).toContain("minmax(300px, 1fr)");
    expect(css).toMatch(/\.scratchOutput\s*\{[^}]*min-height/);
  });

  it("leaves the coding three-pane handoff exactly where it was", () => {
    expect(css).toContain("@media (min-width: 1200px)");
    expect(css).toContain("@media (max-width: 1199px)");
    const tabBand = css.slice(css.indexOf("@media (max-width: 1199px)"));
    expect(tabBand).not.toContain("grid-template-columns");
  });
});
