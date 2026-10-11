import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskRunner, nextAssessmentTaskIndex } from "../app/studio/assessment-workbench";
import {
  ASSESSMENT_EDITOR_MIN_PX, ASSESSMENT_KEY_BIG_STEP, ASSESSMENT_KEY_STEP, ASSESSMENT_MAX_TOTAL, ASSESSMENT_MIN_FRACTION,
  ASSESSMENT_MIN_PANE_PX, ASSESSMENT_PANES_MIN_WIDTH, ASSESSMENT_PANES_QUERY, ASSESSMENT_ROW_FLOOR_PX, ASSESSMENT_SEP_PX,
  ASSESSMENT_SPLIT_STORAGE_KEY, DEFAULT_ASSESSMENT_SPLITS,
  assessmentBoundsFor, assessmentLayoutFor, assessmentMaxFraction, assessmentMaxTotal, assessmentMinFraction,
  assessmentSplitStorage, clampAssessmentSplits, loadAssessmentSplits, nudgeAssessmentSplit,
  parseAssessmentSplits, saveAssessmentSplits, serializeAssessmentSplits, setAssessmentSplit,
} from "../app/studio/assessment-workbench";
import type { AssessmentSplits } from "../app/studio/assessment-workbench";
import { createDefaultState } from "../lib/state";
import { ASSESSMENTS } from "../curriculum/assessments";

/**
 * Focused tests for the resizable self-assessment layout:
 * 1. Wide desktop splits the task card into instructions | editor | feedback
 *    with two labelled, keyboard-operable separators in DOM order.
 * 2. Below the breakpoint the layout stacks and the separators leave the DOM
 *    entirely, so no focusable divider survives the switch.
 * 3. The breakpoint is the first viewport width whose dashboard column can hold
 *    the panes' pixel floors — 1024px cannot, so 1024px must already be stacked.
 * 4. Split maths, keyboard steps and persistence survive bad storage. A moved
 *    pane keeps the value it asked for (it can never freeze or reverse while
 *    the other pane still holds spare width), and at every width three-pane
 *    mode applies the outer panes stay >= 240px and the editor >= 300px.
 * 5. stdout/stderr land in the output pane expanded (no disclosure), and
 *    grading, save and hint accounting all stay reachable after the restructure.
 */

const readSource = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

/**
 * The card widths three-pane mode is actually rendered at: the dashboard
 * column (viewport - 224px nav - side padding) from the 1120px breakpoint up
 * to the dashboard's 1320px cap. Everything the split maths promises has to
 * hold across exactly this range.
 */
function cardWidthRange(): { min: number; max: number } {
  const globals = readSource("app/globals.css");
  const navWidth = Number(globals.match(/\.studio-shell\s*\{[^}]*grid-template-columns:\s*(\d+)px/)?.[1]);
  const breakpointPadding = Number(globals.match(/@media \(min-width: 1024px\) and \(max-width: 1350px\)\s*\{\s*\.dashboard\s*\{\s*padding:\s*\d+px\s+(\d+)px/)?.[1]);
  const dashboard = globals.match(/\.dashboard\s*\{[^}]*max-width:\s*(\d+)px[^}]*padding:\s*\d+px\s+(\d+)px/);
  expect(navWidth).toBeGreaterThan(0);
  expect(breakpointPadding).toBeGreaterThan(0);
  expect(dashboard).not.toBeNull();
  const [, maxDashboard, widePadding] = dashboard!;
  return {
    min: ASSESSMENT_PANES_MIN_WIDTH - navWidth - breakpointPadding * 2,
    max: Number(maxDashboard) - Number(widePadding) * 2,
  };
}

const assessment = ASSESSMENTS[0];
const codeTask = assessment.tasks.find(task => task.kind === "debug")!;
const writtenTask = assessment.tasks.find(task => task.kind === "read")!;
const studio = { state: createDefaultState() } as never;

const draftOf = (overrides: Record<string, unknown> = {}) => ({
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

function renderTask(task = codeTask, overrides: Record<string, unknown> = {}, layout?: "panes" | "stacked"): string {
  return renderToStaticMarkup(
    <TaskRunner studio={studio} assessment={assessment} task={task} draft={draftOf(overrides)} setDraft={() => {}} layout={layout} />,
  );
}

function separatorTags(html: string): string[] {
  return [...html.matchAll(/<div[^>]*role="separator"[^>]*>/g)].map(match => match[0]);
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

/** Everything from the pane's opening marker to the end of the card. */
function paneTail(html: string, marker: string): string {
  const at = html.indexOf(marker);
  if (at < 0) throw new Error(`missing marker in markup: ${marker}`);
  return html.slice(at);
}

/** The instructions | editor panes only: the card's children carry no other ids. */
function between(html: string, from: string, to: string): string {
  const start = html.indexOf(from);
  const end = html.indexOf(to);
  if (start < 0 || end < 0) throw new Error(`missing marker in markup: ${start < 0 ? from : to}`);
  return html.slice(start, end);
}

function inOrder(html: string, ...markers: string[]): boolean {
  const positions = markers.map(marker => html.indexOf(marker));
  return positions.every(position => position >= 0)
    && positions.every((position, i) => i === 0 || position > positions[i - 1]);
}

// ---------------------------------------------------------------------------
// 1. Two separators, in order, keyboard operable
// ---------------------------------------------------------------------------

describe("assessment three-pane separators", () => {
  const html = renderTask();

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

  it("orders the card as instructions | resizer | editor | resizer | feedback", () => {
    const tags = separatorTags(html);
    expect(inOrder(
      html,
      'id="assessment-pane-instructions"',
      tags[0],
      'id="assessment-pane-editor"',
      tags[1],
      'id="assessment-pane-feedback"',
    )).toBe(true);
  });

  it("points each separator at the panes it divides", () => {
    const tags = separatorTags(html);
    expect(attr(tags[0], "aria-controls")).toBe("assessment-pane-instructions assessment-pane-editor");
    expect(attr(tags[1], "aria-controls")).toBe("assessment-pane-editor assessment-pane-feedback");
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
    expect(html).toContain("--as-left");
    expect(html).toContain("--as-right");
    expect(html).toContain('data-layout="panes"');
  });
});

// ---------------------------------------------------------------------------
// 2. Stacked flow: nothing focusable left over
// ---------------------------------------------------------------------------

describe("assessment stacked flow", () => {
  const stacked = renderTask(codeTask, {}, "stacked");

  it("drops both separators from the DOM", () => {
    expect(stacked).not.toContain('role="separator"');
    expect(stacked).toContain('data-layout="stacked"');
  });

  it("keeps all three regions and every control in document order", () => {
    expect(inOrder(
      stacked,
      'id="assessment-pane-instructions"',
      'id="assessment-pane-editor"',
      'id="assessment-pane-feedback"',
    )).toBe(true);
    for (const text of ["Rubric", "Run checks", "Save task result", "Need a nudge?"]) {
      expect(stacked).toContain(text);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The breakpoint: 1024px must already be stacked
// ---------------------------------------------------------------------------

/** Strip comments, then lift every @media block out of the sheet. */
function splitMediaBlocks(css: string): { media: string; outside: string } {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let media = "";
  let outside = "";
  for (let index = 0; index < source.length;) {
    const at = source.indexOf("@media", index);
    if (at === -1) { outside += source.slice(index); break; }
    outside += source.slice(index, at);
    const open = source.indexOf("{", at);
    let depth = 0;
    let end = open;
    for (; end < source.length; end++) {
      if (source[end] === "{") depth++;
      else if (source[end] === "}" && --depth === 0) break;
    }
    media += `${source.slice(open + 1, end)}\n`;
    index = end + 1;
  }
  return { media, outside };
}

describe("assessment layout breakpoint", () => {
  const css = readSource("app/studio/assessment-layout.module.css");
  const globals = readSource("app/globals.css");
  const { media, outside } = splitMediaBlocks(css);

  it("shares one query between the JS mode and the CSS grid", () => {
    expect(ASSESSMENT_PANES_QUERY).toBe(`(min-width: ${ASSESSMENT_PANES_MIN_WIDTH}px)`);
    expect(css).toContain(`@media (min-width: ${ASSESSMENT_PANES_MIN_WIDTH}px)`);
    expect(assessmentLayoutFor(true)).toBe("panes");
    expect(assessmentLayoutFor(false)).toBe("stacked");
  });

  it("stacks at 1024px and on a phone instead of squeezing three panes", () => {
    // The media gate sits above both widths we test against, so a 1024px
    // desktop and a 375px phone take the same stacked fallback.
    expect(ASSESSMENT_PANES_MIN_WIDTH).toBeGreaterThan(1024);
    expect(ASSESSMENT_PANES_MIN_WIDTH).toBeGreaterThan(375);
    expect(assessmentLayoutFor(false)).toBe("stacked");
  });

  it("gates the grid and the visible separators behind the media query only", () => {
    expect(outside).not.toContain("grid-template-columns");
    expect(outside).toMatch(/\.separator\s*\{\s*display:\s*none/);
    expect(media).toContain("grid-template-columns");
    expect(media).toMatch(/\.separator\s*\{\s*display:\s*flex/);
  });

  it("fits the pane floors into the dashboard column exactly at the breakpoint", () => {
    // globals: .studio-shell reserves 224px for the nav, and the dashboard
    // drops to 32px side padding between 1024px and 1350px.
    const navWidth = Number(globals.match(/\.studio-shell\s*\{[^}]*grid-template-columns:\s*(\d+)px/)?.[1]);
    const dashboardPadding = Number(globals.match(/@media \(min-width: 1024px\) and \(max-width: 1350px\)\s*\{\s*\.dashboard\s*\{\s*padding:\s*\d+px\s+(\d+)px/)?.[1]);
    expect(navWidth).toBeGreaterThan(0);
    expect(dashboardPadding).toBeGreaterThan(0);

    const floors = [...media.matchAll(/minmax\((\d+)px/g)].map(match => Number(match[1]));
    const separator = Number(media.match(/--as-sep,\s*(\d+)px/)?.[1]);
    expect(floors).toHaveLength(3);
    expect(separator).toBeGreaterThan(0);
    const trackSum = floors.reduce((total, floor) => total + floor, 0) + separator * 2;

    // At 1024px the column is narrower than the three panes, so stacking there
    // is correct — at the chosen breakpoint it fits, with the editor left over.
    expect(1024 - navWidth - dashboardPadding * 2).toBeLessThan(trackSum);
    expect(ASSESSMENT_PANES_MIN_WIDTH - navWidth - dashboardPadding * 2).toBeGreaterThanOrEqual(trackSum);
    // The floors the CSS renders and the floors the clamp math enforce agree.
    expect(floors[0]).toBe(ASSESSMENT_MIN_PANE_PX.left);
    expect(floors[1]).toBe(ASSESSMENT_EDITOR_MIN_PX);
    expect(floors[2]).toBe(ASSESSMENT_MIN_PANE_PX.right);
    expect(ASSESSMENT_SEP_PX).toBe(separator);
    // The JS floor maths switches on exactly the width the CSS grid needs.
    expect(ASSESSMENT_ROW_FLOOR_PX).toBe(trackSum);
    expect(ASSESSMENT_ROW_FLOOR_PX).toBeLessThanOrEqual(ASSESSMENT_PANES_MIN_WIDTH - navWidth - dashboardPadding * 2);
    const range = cardWidthRange();
    expect(range.min).toBe(ASSESSMENT_PANES_MIN_WIDTH - navWidth - dashboardPadding * 2);
    expect(range.min).toBeGreaterThanOrEqual(ASSESSMENT_ROW_FLOOR_PX);
    expect(range.max).toBeGreaterThan(range.min);
  });
});

// ---------------------------------------------------------------------------
// 4. Split maths
// ---------------------------------------------------------------------------

describe("assessment split math", () => {
  it("leaves the defaults untouched at a wide desktop width", () => {
    expect(clampAssessmentSplits(DEFAULT_ASSESSMENT_SPLITS, 1440)).toEqual(DEFAULT_ASSESSMENT_SPLITS);
    expect(clampAssessmentSplits(DEFAULT_ASSESSMENT_SPLITS)).toEqual(DEFAULT_ASSESSMENT_SPLITS);
  });

  it("enforces the pixel floors through the layout width", () => {
    expect(assessmentMinFraction("left", 1120)).toBeCloseTo(ASSESSMENT_MIN_PANE_PX.left / 1120, 6);
    expect(assessmentMinFraction("right", 1120)).toBeCloseTo(ASSESSMENT_MIN_PANE_PX.right / 1120, 6);
    expect(assessmentMinFraction("left")).toBe(ASSESSMENT_MIN_FRACTION.left);
    const clamped = clampAssessmentSplits({ left: 0.05, right: 0.05 }, 1120);
    expect(clamped.left * 1120).toBeGreaterThanOrEqual(ASSESSMENT_MIN_PANE_PX.left);
    expect(clamped.right * 1120).toBeGreaterThanOrEqual(ASSESSMENT_MIN_PANE_PX.right);
  });

  it("caps each outer pane so the editor keeps its share", () => {
    expect(assessmentMaxFraction("left")).toBe(ASSESSMENT_MAX_TOTAL - ASSESSMENT_MIN_FRACTION.right);
    expect(assessmentMaxFraction("left", 1440)).toBeCloseTo(ASSESSMENT_MAX_TOTAL - ASSESSMENT_MIN_FRACTION.right, 6);
    const wideLeft = setAssessmentSplit(DEFAULT_ASSESSMENT_SPLITS, "left", 0.99, 1440);
    const wideRight = setAssessmentSplit(DEFAULT_ASSESSMENT_SPLITS, "right", 0.99, 1440);
    expect(wideLeft.left).toBeCloseTo(assessmentMaxFraction("left", 1440), 6);
    expect(wideLeft.right).toBeCloseTo(ASSESSMENT_MIN_FRACTION.right, 6);
    expect(wideLeft.left + wideLeft.right).toBeCloseTo(ASSESSMENT_MAX_TOTAL, 6);
    expect(wideRight.left + wideRight.right).toBeCloseTo(ASSESSMENT_MAX_TOTAL, 6);
    expect(1 - wideRight.left - wideRight.right).toBeGreaterThanOrEqual(300 / 1440);
  });

  it("tightens the cap on the narrowest three-pane rows so the grid cannot overflow", () => {
    const { min, max } = cardWidthRange();
    expect(assessmentMaxTotal()).toBe(ASSESSMENT_MAX_TOTAL);
    expect(assessmentMaxTotal(min)).toBeCloseTo((min - 2 * ASSESSMENT_SEP_PX - ASSESSMENT_EDITOR_MIN_PX) / min, 9);
    expect(assessmentMaxTotal(min)).toBeLessThan(ASSESSMENT_MAX_TOTAL);
    expect(assessmentMaxTotal(max)).toBe(ASSESSMENT_MAX_TOTAL);
    // Above ~853px the authored 0.62 cap binds first; below it the 300px editor
    // floor does. Either way the total never lets the centre track shrink.
    for (let width = min; width <= max; width++) {
      expect(assessmentMaxTotal(width)).toBeLessThanOrEqual(
        (width - 2 * ASSESSMENT_SEP_PX - ASSESSMENT_EDITOR_MIN_PX) / width + 1e-12,
      );
    }
  });

  it("never lets left + right exceed the cap", () => {
    const clamped = clampAssessmentSplits({ left: 0.6, right: 0.5 }, 1440);
    expect(clamped.left + clamped.right).toBeLessThanOrEqual(ASSESSMENT_MAX_TOTAL + 1e-9);
    expect(clamped.left).toBeGreaterThanOrEqual(ASSESSMENT_MIN_FRACTION.left);
    expect(clamped.right).toBeGreaterThanOrEqual(ASSESSMENT_MIN_FRACTION.right);
  });

  it("repairs non-finite input instead of propagating it", () => {
    expect(clampAssessmentSplits({ left: Number.NaN, right: Number.POSITIVE_INFINITY })).toEqual(DEFAULT_ASSESSMENT_SPLITS);
    expect(nudgeAssessmentSplit(DEFAULT_ASSESSMENT_SPLITS, "left", Number.NaN)).toEqual(DEFAULT_ASSESSMENT_SPLITS);
  });

  it("nudges without mutating its input", () => {
    const before = { ...DEFAULT_ASSESSMENT_SPLITS };
    expect(nudgeAssessmentSplit(DEFAULT_ASSESSMENT_SPLITS, "left", ASSESSMENT_KEY_STEP).left)
      .toBeCloseTo(DEFAULT_ASSESSMENT_SPLITS.left + ASSESSMENT_KEY_STEP, 6);
    expect(nudgeAssessmentSplit(DEFAULT_ASSESSMENT_SPLITS, "right", -ASSESSMENT_KEY_BIG_STEP).right)
      .toBeCloseTo(ASSESSMENT_MIN_FRACTION.right, 6);
    expect(DEFAULT_ASSESSMENT_SPLITS).toEqual(before);
  });

  it("keeps defaults inside the bounds the separators announce", () => {
    const tags = separatorTags(renderTask());
    for (const side of ["left", "right"] as const) {
      const bounds = assessmentBoundsFor(side);
      expect(bounds.min).toBe(ASSESSMENT_MIN_FRACTION[side]);
      expect(bounds.max).toBe(assessmentMaxFraction(side));
      expect(bounds.min).toBeLessThan(bounds.max);
      const tag = tags[side === "left" ? 0 : 1];
      expect(Math.round(bounds.min * 100)).toBe(Number(attr(tag, "aria-valuemin")));
      expect(Math.round(bounds.max * 100)).toBe(Number(attr(tag, "aria-valuemax")));
      expect(clampAssessmentSplits(DEFAULT_ASSESSMENT_SPLITS, 1120)[side]).toBeGreaterThanOrEqual(bounds.min);
    }
  });
});

// ---------------------------------------------------------------------------
// 4b. A moved pane never freezes or reverses, and the floors hold everywhere
// ---------------------------------------------------------------------------

const clampTo = (value: number, min: number, max: number) => (value < min ? min : value > max ? max : value);

describe("assessment divider never freezes or reverses", () => {
  const width = 1440;

  it("gives the moved pane every bit of spare width the other pane holds", () => {
    // The pair already sums to the cap: the old clamp cancelled the move by
    // trimming the pane being dragged, so left froze at 0.38 forever even
    // though right still sat 0.06 above its floor.
    const start: AssessmentSplits = { left: 0.38, right: 0.24 };
    const moved = setAssessmentSplit(start, "left", 0.5, width);
    expect(moved.left).toBeGreaterThan(start.left);
    expect(moved.left).toBeCloseTo(assessmentMaxFraction("left", width), 9);
    expect(moved.right).toBeCloseTo(ASSESSMENT_MIN_FRACTION.right, 9);
    expect(moved.left + moved.right).toBeCloseTo(assessmentMaxTotal(width), 9);

    const other: AssessmentSplits = { left: 0.24, right: 0.38 };
    const movedRight = setAssessmentSplit(other, "right", 0.5, width);
    expect(movedRight.right).toBeGreaterThan(other.right);
    expect(movedRight.right).toBeCloseTo(assessmentMaxFraction("right", width), 9);
    expect(movedRight.left).toBeCloseTo(ASSESSMENT_MIN_FRACTION.left, 9);
  });

  it("moves only the pane the divider divides while there is room", () => {
    expect(setAssessmentSplit({ left: 0.26, right: 0.24 }, "left", 0.3, width)).toEqual({ left: 0.3, right: 0.24 });
    expect(setAssessmentSplit({ left: 0.26, right: 0.24 }, "right", 0.3, width)).toEqual({ left: 0.26, right: 0.3 });
    expect(setAssessmentSplit({ left: 0.26, right: 0.24 }, "left", 0.1, width)).toEqual({
      left: ASSESSMENT_MIN_FRACTION.left,
      right: 0.24,
    });
  });

  it("never grows the pane opposite the divider", () => {
    for (const side of ["left", "right"] as const) {
      const start: AssessmentSplits = { left: 0.3, right: 0.3 };
      const other = side === "left" ? "right" : "left";
      let previous = setAssessmentSplit(start, side, 0.05, width)[side];
      for (let step = 1; step <= 40; step++) {
        const next = setAssessmentSplit(start, side, 0.05 + step * 0.02, width);
        expect(next[other]).toBeLessThanOrEqual(start[other] + 1e-12);
        // Dragging one way never walks the pane back the other way.
        expect(next[side]).toBeGreaterThanOrEqual(previous - 1e-12);
        previous = next[side];
      }
      expect(previous).toBeCloseTo(assessmentMaxFraction(side, width), 9);
    }
  });

  it("is monotone across a whole drag and stops only on the announced bounds", () => {
    for (const side of ["left", "right"] as const) {
      const min = assessmentMinFraction(side, width);
      const max = assessmentMaxFraction(side, width);
      const anchor: AssessmentSplits = { left: 0.26, right: 0.24 };
      expect(anchor[side]).toBeCloseTo(clampTo(anchor[side], min, max), 12);

      const sweep = (from: number, to: number, step: number) => {
        let previous = setAssessmentSplit(anchor, side, from, width)[side];
        for (let value = from + step; step > 0 ? value <= to + 1e-9 : value >= to - 1e-9; value += step) {
          const next = setAssessmentSplit(anchor, side, value, width);
          expect(next[side]).toBeCloseTo(clampTo(value, min, max), 9);
          if (step > 0) expect(next[side]).toBeGreaterThanOrEqual(previous - 1e-12);
          else expect(next[side]).toBeLessThanOrEqual(previous + 1e-12);
          previous = next[side];
        }
        return previous;
      };

      expect(sweep(anchor[side], 1, 0.01)).toBeCloseTo(max, 9);
      expect(sweep(1, 0, -0.01)).toBeCloseTo(min, 9);
    }
  });

  it("lets the keyboard land on the bounds the separators announce", () => {
    for (const side of ["left", "right"] as const) {
      const bounds = assessmentBoundsFor(side, width);
      const atEnd = setAssessmentSplit(DEFAULT_ASSESSMENT_SPLITS, side, bounds.max, width);
      expect(atEnd[side]).toBeCloseTo(bounds.max, 12);
      const atHome = setAssessmentSplit(DEFAULT_ASSESSMENT_SPLITS, side, bounds.min, width);
      expect(atHome[side]).toBeCloseTo(bounds.min, 12);
      // Repeated nudges climb to the same ceiling instead of stalling short.
      let state = DEFAULT_ASSESSMENT_SPLITS;
      for (let i = 0; i < 40; i++) {
        const before = state[side];
        state = nudgeAssessmentSplit(state, side, ASSESSMENT_KEY_STEP, width);
        expect(state[side]).toBeGreaterThanOrEqual(before - 1e-12);
        expect(state.left + state.right).toBeLessThanOrEqual(assessmentMaxTotal(width) + 1e-9);
      }
      expect(state[side]).toBeCloseTo(bounds.max, 9);
      const other = side === "left" ? "right" : "left";
      expect(state[other]).toBeCloseTo(assessmentMinFraction(other, width), 9);
    }
  });
});

describe("assessment pane floors across every three-pane width", () => {
  const { min: minCard, max: maxCard } = cardWidthRange();

  function expectFloorsHold(splits: AssessmentSplits, width: number, label: string) {
    const leftPx = splits.left * width;
    const rightPx = splits.right * width;
    const editorPx = width - leftPx - rightPx - 2 * ASSESSMENT_SEP_PX;
    expect(leftPx, `${label}: left pane at ${width}px`).toBeGreaterThanOrEqual(ASSESSMENT_MIN_PANE_PX.left - 1e-6);
    expect(rightPx, `${label}: right pane at ${width}px`).toBeGreaterThanOrEqual(ASSESSMENT_MIN_PANE_PX.right - 1e-6);
    expect(editorPx, `${label}: editor at ${width}px`).toBeGreaterThanOrEqual(ASSESSMENT_EDITOR_MIN_PX - 1e-6);
    expect(splits.left + splits.right, `${label}: total at ${width}px`)
      .toBeLessThanOrEqual(assessmentMaxTotal(width) + 1e-9);
  }

  const probes: AssessmentSplits[] = [
    DEFAULT_ASSESSMENT_SPLITS,
    { left: 0.05, right: 0.05 },
    { left: 0.6, right: 0.5 },
    { left: 0.44, right: 0.44 },
    { left: 0.19, right: 0.61 },
    { left: Number.NaN, right: Number.POSITIVE_INFINITY },
  ];

  it("holds 240px outer panes and a 300px editor for every clamp", () => {
    for (let width = minCard; width <= maxCard; width++) {
      for (const probe of probes) {
        expectFloorsHold(clampAssessmentSplits(probe, width), width, `clamp ${JSON.stringify(probe)}`);
        for (const side of ["left", "right"] as const) {
          for (const value of [0.02, 0.5, 0.98]) {
            expectFloorsHold(setAssessmentSplit(probe, side, value, width), width, `set ${side}=${value}`);
          }
        }
      }
    }
  });

  it("holds them through a whole drag sweep at the extremes of the range", () => {
    for (const width of [minCard, minCard + 1, Math.floor((minCard + maxCard) / 2), maxCard - 1, maxCard]) {
      for (const side of ["left", "right"] as const) {
        let state: AssessmentSplits = { left: 0.5, right: 0.5 };
        for (let value = 0; value <= 1; value += 0.01) {
          state = setAssessmentSplit({ left: 0.5, right: 0.5 }, side, value, width);
          expectFloorsHold(state, width, `drag ${side}=${value.toFixed(2)}`);
        }
        expectFloorsHold(state, width, `drag end ${side}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Persistence
// ---------------------------------------------------------------------------

describe("assessment split persistence", () => {
  it("round-trips splits through serialize/parse", () => {
    const stored = { left: 0.3, right: 0.2 };
    expect(parseAssessmentSplits(serializeAssessmentSplits(stored))).toEqual(stored);
  });

  it("rejects corrupted or out-of-range payloads", () => {
    for (const bad of [null, "", "not json", '"0.3"', '{"left":"26","right":0.2}', '{"left":0,"right":0.2}', '{"left":1.2,"right":0.2}', "{}"]) {
      expect(parseAssessmentSplits(bad)).toBeNull();
    }
  });

  it("falls back to defaults when storage is missing or broken", () => {
    expect(loadAssessmentSplits(null)).toEqual(DEFAULT_ASSESSMENT_SPLITS);
    expect(loadAssessmentSplits({ getItem: () => { throw new Error("denied"); }, setItem: () => {} })).toEqual(DEFAULT_ASSESSMENT_SPLITS);
    expect(loadAssessmentSplits({ getItem: () => '{"left":9000,"right":-4}', setItem: () => {} })).toEqual(DEFAULT_ASSESSMENT_SPLITS);
  });

  it("persists under its own key, away from the mission workbench splits", () => {
    const written: Record<string, string> = {};
    saveAssessmentSplits({ getItem: () => null, setItem: (key, value) => { written[key] = value; } }, DEFAULT_ASSESSMENT_SPLITS);
    expect(Object.keys(written)).toEqual([ASSESSMENT_SPLIT_STORAGE_KEY]);
    expect(ASSESSMENT_SPLIT_STORAGE_KEY).not.toBe("coding-school:workbench:splits");
    expect(parseAssessmentSplits(written[ASSESSMENT_SPLIT_STORAGE_KEY])).toEqual(DEFAULT_ASSESSMENT_SPLITS);
    expect(() => saveAssessmentSplits({ getItem: () => null, setItem: () => { throw new Error("quota"); } }, DEFAULT_ASSESSMENT_SPLITS)).not.toThrow();
    expect(() => saveAssessmentSplits(null, DEFAULT_ASSESSMENT_SPLITS)).not.toThrow();
  });

  it("has no localStorage outside the browser", () => {
    expect(assessmentSplitStorage()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Output pane, and grading / save / hints still reachable
// ---------------------------------------------------------------------------

describe("assessment feedback pane", () => {
  const gradeResult = {
    passed: false,
    executionOk: true,
    stdout: "rows loaded: 12",
    stderr: "Traceback (most recent call last)",
    tests: [{ id: "c1", name: "Rejects bad rows", required: true, passed: false, detail: "expected ValueError" }],
  };

  it("shows stdout and stderr in the output pane, expanded, once code has run", () => {
    const html = renderTask(codeTask, { gradeResult });
    const feedback = paneTail(html, 'id="assessment-pane-feedback"');
    expect(feedback).toContain("rows loaded: 12");
    expect(feedback).toContain("Traceback (most recent call last)");
    // Straight into the pane — no disclosure to open first.
    expect(feedback).not.toContain("<details");
    expect(feedback).not.toContain("<summary");
    expect(feedback).toContain("Standard output");
    expect(feedback).toContain("Standard error");
    expect(feedback).toContain("expected ValueError");
    const stdoutAt = feedback.indexOf("rows loaded: 12");
    expect(stdoutAt).toBeGreaterThan(feedback.indexOf("Standard output"));
    expect(stdoutAt).toBeLessThan(feedback.indexOf("Save task result"));
  });

  it("flags a run that produced error output", () => {
    const html = renderTask(codeTask, { gradeResult: { ...gradeResult, stderr: "ZeroDivisionError: division by zero" } });
    const feedback = paneTail(html, 'id="assessment-pane-feedback"');
    expect(feedback).toContain("Standard error · has error output");
    expect(feedback).toContain("ZeroDivisionError: division by zero");
  });

  it("keeps stdout and stderr out of the instructions and editor panes", () => {
    const html = renderTask(codeTask, { gradeResult });
    const instructions = between(html, 'id="assessment-pane-instructions"', 'id="assessment-pane-editor"');
    const editor = between(html, 'id="assessment-pane-editor"', 'id="assessment-pane-feedback"');
    expect(instructions).toContain("Need a nudge?");
    expect(editor).toContain("Run checks");
    expect(instructions).not.toContain("rows loaded: 12");
    expect(editor).not.toContain("rows loaded: 12");
  });

  it("explains the empty output pane before the first run", () => {
    const html = renderTask(codeTask);
    expect(paneTail(html, 'id="assessment-pane-feedback"')).toContain("Run your code to see its checks");
    expect(html).not.toContain("console-output");
  });

  it("keeps grading, saving and hint accounting reachable in the new panes", () => {
    const html = renderTask(codeTask, { hintsUsed: 1 });
    const left = between(html, 'id="assessment-pane-instructions"', 'id="assessment-pane-editor"');
    const centre = between(html, 'id="assessment-pane-editor"', 'id="assessment-pane-feedback"');
    const feedback = paneTail(html, 'id="assessment-pane-feedback"');
    expect(left).toContain("Need a nudge?");
    expect(left).toContain(`1/${codeTask.hints.length} hints`);
    expect(left).toContain("Reveal hint 2");
    expect(left).toContain("Record other help");
    expect(centre).toContain("Run checks");
    expect(centre).toContain("Use plain text");
    expect(feedback).toContain("Save task result");
    expect(feedback).toContain("Run the checks or grade your answer before saving.");
  });

  it("puts the written answer in the centre and its feedback on the right", () => {
    const html = renderTask(writtenTask, {
      writtenChecks: [{ id: "w1", passed: true, detail: "good" }, { id: "w2", passed: false, detail: "missing the point" }],
    });
    const centre = between(html, 'id="assessment-pane-editor"', 'id="assessment-pane-feedback"');
    const feedback = paneTail(html, 'id="assessment-pane-feedback"');
    expect(centre).toContain("Your answer");
    expect(centre).toContain(`id="response-${writtenTask.id}"`);
    expect(centre).toContain("Grade answer");
    expect(centre).not.toContain("visually-hidden");
    expect(feedback).toContain("Feedback");
    expect(feedback).toContain("missing the point");
    expect(feedback).toContain("Save task result");
  });

  it("tells a learner with no grade yet where the feedback will appear", () => {
    const html = renderTask(writtenTask);
    expect(paneTail(html, 'id="assessment-pane-feedback"')).toContain("Grade your answer to see feedback");
  });
});

describe("assessment task navigation", () => {
  it("still wraps and jumps across task tabs", () => {
    expect(nextAssessmentTaskIndex(0, 5, "ArrowRight")).toBe(1);
    expect(nextAssessmentTaskIndex(4, 5, "ArrowRight")).toBe(0);
    expect(nextAssessmentTaskIndex(0, 5, "ArrowLeft")).toBe(4);
    expect(nextAssessmentTaskIndex(3, 5, "Home")).toBe(0);
    expect(nextAssessmentTaskIndex(3, 5, "End")).toBe(4);
    expect(nextAssessmentTaskIndex(2, 5, "Enter")).toBe(2);
  });
});
