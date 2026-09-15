import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Workbench } from "../app/studio/workbench";
import {
  AssessmentDetail,
  TaskRunner,
  nextAssessmentTaskIndex,
} from "../app/studio/assessment-workbench";
import { createDefaultState } from "../lib/state";
import { ASSESSMENTS } from "../curriculum/assessments";

/**
 * Accessibility regression tests for the studio workbenches.
 *
 * 1. Check pass/fail must be conveyed in text, not by color alone: a screen
 *    reader must hear each check's result (the diagnostic's CodingChecks does
 *    this with "Passed:"/"Needs changes:" text; the workbenches only rendered
 *    an aria-hidden ✓/× glyph plus the check name).
 * 2. Assessment tabs must follow the ARIA tabs pattern: each tab needs an id
 *    and aria-controls pointing at a tabpanel labelled by the tab.
 * 3. The workbench header must surface the sync/offline status (the nav's
 *    sync note is display:none on mobile, leaving mobile learners with no
 *    offline indication).
 */

// ---------------------------------------------------------------------------
// Shared stubs
// ---------------------------------------------------------------------------

const codeTask = {
  id: "t-code",
  kind: "code",
  purpose: "guided",
  title: "Code task",
  explanation: "Do the thing.",
  requirements: ["r1"],
  examples: ["in -> out"],
  hints: ["h1"],
  variants: [{ id: "v1", exerciseId: "ex", graderId: "gr" }],
};

function workbenchStudio(syncStatus: string, result: unknown) {
  const stage = { id: "s1", title: "Stage", estimatedMinutes: 10, tasks: [] };
  return {
    workbench: {
      mission: { id: "m1", title: "Mission", estimatedMinutes: 30, stages: [stage], summary: "" },
      run: { id: "r1", mode: "mission", stageIndex: 0, stages: [{ status: "active" }] },
      stage,
      task: codeTask,
      stageComplete: false,
      taskComplete: false,
      latestAttempt: undefined,
    },
    draft: {
      sourceFiles: { "main.py": "print(1)" },
      assistance: { hintsUsed: 0, aiAssisted: false, solutionViewed: false },
      response: "",
    },
    result,
    status: "Needs changes",
    busy: false,
    attemptSaved: false,
    learningMode: true,
    assistanceUsed: false,
    storageError: null,
    syncStatus,
    navigate: () => {},
    toggleLearningMode: () => {},
    continueStage: () => {},
    submitText: () => {},
    updateDraft: () => {},
    stopRun: () => {},
  } as never;
}

const gradeResult = (tests: { id: string; name: string; passed: boolean }[]) =>
  ({
    passed: tests.every(t => t.passed),
    executionOk: true,
    tests: tests.map(t => ({ ...t, required: true, detail: "" })),
    stdout: "",
    stderr: "",
  }) as never;

// ---------------------------------------------------------------------------
// 1. Check results convey pass/fail in text
// ---------------------------------------------------------------------------

describe("workbench check results", () => {
  it("announces each check's result in text, not by color alone", () => {
    const html = renderToStaticMarkup(
      <Workbench
        studio={workbenchStudio("synced", gradeResult([
          { id: "c1", name: "First check", passed: true },
          { id: "c2", name: "Second check", passed: false },
        ]))}
      />,
    );
    expect(html).toMatch(/visually-hidden[^>]*>Passed:/);
    expect(html).toMatch(/visually-hidden[^>]*>Needs changes:/);
  });
});

describe("assessment task check results", () => {
  const assessment = ASSESSMENTS[0];
  const debugTask = assessment.tasks.find(t => t.kind === "debug")!;
  const readTask = assessment.tasks.find(t => t.kind === "read")!;
  const studio = { state: createDefaultState() } as never;
  const draftOf = (overrides: object) => ({
    code: "",
    response: "",
    hintsUsed: 0,
    aiAssisted: false,
    solutionViewed: false,
    gradeResult: null,
    writtenChecks: null,
    grading: false,
    saved: false,
    ...overrides,
  });

  it("announces code check results in text", () => {
    const html = renderToStaticMarkup(
      <TaskRunner
        studio={studio}
        assessment={assessment}
        task={debugTask}
        draft={draftOf({
          gradeResult: gradeResult([
            { id: "c1", name: "Parses rows", passed: true },
            { id: "c2", name: "Rejects bad rows", passed: false },
          ]),
        })}
        setDraft={() => {}}
      />,
    );
    expect(html).toMatch(/visually-hidden[^>]*>Passed:/);
    expect(html).toMatch(/visually-hidden[^>]*>Failed:/);
  });

  it("announces written-answer check results in text", () => {
    const html = renderToStaticMarkup(
      <TaskRunner
        studio={studio}
        assessment={assessment}
        task={readTask}
        draft={draftOf({
          writtenChecks: [
            { id: "w1", passed: true, detail: "good" },
            { id: "w2", passed: false, detail: "missing the point" },
          ],
        })}
        setDraft={() => {}}
      />,
    );
    expect(html).toMatch(/visually-hidden[^>]*>Passed:/);
    expect(html).toMatch(/visually-hidden[^>]*>Failed:/);
  });
});

// ---------------------------------------------------------------------------
// 2. Assessment tabs follow the ARIA tabs pattern
// ---------------------------------------------------------------------------

describe("assessment tabs", () => {
  const assessment = ASSESSMENTS[0];
  const html = renderToStaticMarkup(
    <AssessmentDetail studio={{ state: createDefaultState() } as never} assessment={assessment} onBack={() => {}} />,
  );

  it("gives every tab an id and aria-controls pointing at its panel", () => {
    for (const task of assessment.tasks) {
      expect(html).toContain(`id="assessment-tab-${task.id}"`);
      expect(html).toContain(`aria-controls="assessment-panel-${task.id}"`);
    }
  });

  it("wraps the active task in a tabpanel labelled by its tab", () => {
    const first = assessment.tasks[0];
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain(`id="assessment-panel-${first.id}"`);
    expect(html).toContain(`aria-labelledby="assessment-tab-${first.id}"`);
  });

  it("uses roving tabindex across tabs", () => {
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map(m => m[0]);
    expect(tabs).toHaveLength(assessment.tasks.length);
    expect(tabs[0]).toMatch(/tabindex="0"/i);
    for (const tab of tabs.slice(1)) expect(tab).toMatch(/tabindex="-1"/i);
  });
});

describe("nextAssessmentTaskIndex", () => {
  it("moves right and wraps", () => {
    expect(nextAssessmentTaskIndex(0, 5, "ArrowRight")).toBe(1);
    expect(nextAssessmentTaskIndex(4, 5, "ArrowRight")).toBe(0);
  });
  it("moves left and wraps", () => {
    expect(nextAssessmentTaskIndex(0, 5, "ArrowLeft")).toBe(4);
    expect(nextAssessmentTaskIndex(2, 5, "ArrowLeft")).toBe(1);
  });
  it("jumps to first/last on Home/End", () => {
    expect(nextAssessmentTaskIndex(3, 5, "Home")).toBe(0);
    expect(nextAssessmentTaskIndex(3, 5, "End")).toBe(4);
  });
  it("ignores other keys", () => {
    expect(nextAssessmentTaskIndex(2, 5, "Enter")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Sync/offline status visible from the workbench header
// ---------------------------------------------------------------------------

describe("workbench sync status", () => {
  it("shows a live-region sync note in the header when offline", () => {
    const html = renderToStaticMarkup(
      <Workbench studio={workbenchStudio("offline", null)} />,
    );
    const header = html.slice(0, html.indexOf("</header>"));
    expect(header).toMatch(/role="status"[^>]*>[^<]*[Oo]ffline/);
  });

  it("shows a live-region sync note in the header when synced", () => {
    const html = renderToStaticMarkup(
      <Workbench studio={workbenchStudio("synced", null)} />,
    );
    const header = html.slice(0, html.indexOf("</header>"));
    expect(header).toMatch(/role="status"/);
  });
});
