import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Workbench } from "../app/studio/workbench";
import {
  COMPACT_MAX_WIDTH, COMPACT_QUERY, DEFAULT_SPLITS, KEY_BIG_STEP, KEY_STEP, MAX_TOTAL,
  MIN_CODE_PX, MIN_FRACTION, MIN_PANE_PX, NAV_WIDTH_PX, SEPARATOR_PX, SPLIT_STORAGE_KEY,
  THREE_PANE_FLOOR_PX, THREE_PANE_MIN_WIDTH,
  boundsFor, browserStorage, clampSplits, loadSplits, maxFraction, maxTotalFor, minFraction,
  nudgeSplit, parseSplits, saveSplits, serializeSplits, setSplit,
} from "../app/studio/workbench-resizer";

/**
 * Focused tests for the desktop three-pane workbench layout:
 * 1. Two labelled, keyboard-operable separators sit between the three panes
 *    in DOM order, without disturbing the mobile tab flow.
 * 2. The split math keeps pane minimums, caps the outer panes so the code
 *    pane always keeps room, and survives bad localStorage contents.
 * 3. The three-pane band only opens where those minimums actually fit beside
 *    the 224px nav (the 1024px clipping bug), and the JS query, the CSS media
 *    queries, and the minimums all agree.
 * 4. The separators are painted with theme tokens, so dark mode matches.
 */

const layoutCss = readFileSync(resolve(__dirname, "../app/studio/workbench-layout.module.css"), "utf8");

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

function codeStudio(overrides: Record<string, unknown> = {}) {
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
    result: null,
    status: "Needs changes",
    busy: false,
    attemptSaved: false,
    learningMode: true,
    assistanceUsed: false,
    storageError: null,
    syncStatus: "synced",
    navigate: () => {},
    toggleLearningMode: () => {},
    continueStage: () => {},
    submitText: () => {},
    updateDraft: () => {},
    stopRun: () => {},
    ...overrides,
  } as never;
}

function separatorTags(html: string): string[] {
  return [...html.matchAll(/<div[^>]*role="separator"[^>]*>/g)].map(match => match[0]);
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

const html = renderToStaticMarkup(<Workbench studio={codeStudio()} />);

describe("workbench three-pane resizers", () => {
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
      html.indexOf('id="panel-instructions"'),
      html.indexOf(tags[0]),
      html.indexOf('id="panel-code"'),
      html.indexOf(tags[1]),
      html.indexOf('id="panel-checks"'),
    ];
    expect(order.every(position => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });

  it("points each separator at the panes it divides", () => {
    const tags = separatorTags(html);
    expect(attr(tags[0], "aria-controls")).toBe("panel-instructions panel-code");
    expect(attr(tags[1], "aria-controls")).toBe("panel-code panel-checks");
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
    expect(html).toContain("--wb-left");
    expect(html).toContain("--wb-right");
  });

  it("keeps the mobile tab flow: three tabs with roving tabindex", () => {
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)]
      .map(match => match[0])
      .filter(tag => tag.includes('id="tab-'));
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toMatch(/id="tab-instructions"/);
    expect(tabs[0]).toMatch(/aria-selected="true"/);
    expect(tabs[0]).toMatch(/tabindex="0"/i);
    for (const tab of tabs.slice(1)) expect(tab).toMatch(/tabindex="-1"/i);
    expect(html).toContain('aria-controls="panel-code"');
  });
});

describe("workbench split math", () => {
  it("leaves the defaults untouched at a normal desktop width", () => {
    expect(clampSplits(DEFAULT_SPLITS, 1440)).toEqual(DEFAULT_SPLITS);
    expect(clampSplits(DEFAULT_SPLITS)).toEqual(DEFAULT_SPLITS);
  });

  it("enforces the pixel floors through the layout width", () => {
    expect(minFraction("left", 1024)).toBeCloseTo(280 / 1024, 6);
    expect(minFraction("right", 1024)).toBeCloseTo(260 / 1024, 6);
    expect(minFraction("left")).toBe(MIN_FRACTION.left);
    const clamped = clampSplits({ left: 0.05, right: 0.05 }, 1024);
    expect(clamped.left * 1024).toBeGreaterThanOrEqual(280);
    expect(clamped.right * 1024).toBeGreaterThanOrEqual(260);
  });

  it("ignores pixel floors on rows too narrow to hold them", () => {
    // A compact (tabbed) row has no resizers, but the layout observer still
    // runs: feeding it floors that exceed their own maxima asks clamp() for
    // min > max and corrupts the stored splits on every 1024 -> 1280 hop.
    expect(THREE_PANE_FLOOR_PX).toBe(904);
    expect(minFraction("left", THREE_PANE_FLOOR_PX - 1)).toBe(MIN_FRACTION.left);
    expect(minFraction("left", THREE_PANE_FLOOR_PX)).toBeCloseTo(280 / THREE_PANE_FLOOR_PX, 6);
    const authored = { left: 0.3, right: 0.28 };
    const visited = clampSplits(authored, 800);
    expect(visited).toEqual(authored);
    expect(clampSplits(visited, 1056)).toEqual(authored);
    expect(clampSplits(clampSplits(authored, 358), 1056)).toEqual(authored);
  });

  it("caps each outer pane so the code pane keeps its share", () => {
    expect(maxFraction("left")).toBe(MAX_TOTAL - MIN_FRACTION.right);
    const wideLeft = setSplit(DEFAULT_SPLITS, "left", 0.99, 1440);
    const wideRight = setSplit(DEFAULT_SPLITS, "right", 0.99, 1440);
    // The pane being set keeps the room it asked for (capped by its own
    // max); the other outer pane gives way down to its floor instead, so the
    // code pane always keeps >= 38% of the row either way.
    expect(wideLeft.left).toBeCloseTo(MAX_TOTAL - minFraction("right", 1440), 6);
    expect(wideLeft.right).toBeCloseTo(minFraction("right", 1440), 6);
    expect(wideLeft.left).toBeLessThanOrEqual(maxFraction("left"));
    expect(wideRight.left).toBeCloseTo(minFraction("left", 1440), 6);
    expect(wideRight.right).toBeCloseTo(MAX_TOTAL - wideRight.left, 6);
    expect(wideRight.right).toBeLessThanOrEqual(maxFraction("right"));
    expect(wideLeft.left + wideLeft.right).toBeCloseTo(MAX_TOTAL, 6);
    expect(wideRight.left + wideRight.right).toBeCloseTo(MAX_TOTAL, 6);
  });

  it("never lets left + right exceed MAX_TOTAL", () => {
    const clamped = clampSplits({ left: 0.6, right: 0.5 }, 1440);
    expect(clamped.left + clamped.right).toBeLessThanOrEqual(MAX_TOTAL + 1e-9);
    expect(clamped.left).toBeGreaterThanOrEqual(MIN_FRACTION.left);
    expect(clamped.right).toBeGreaterThanOrEqual(MIN_FRACTION.right);
  });

  it("keeps a floor-pinned separator movable by trimming the other pane", () => {
    // 1280px viewport beside the 224px nav: left parked on its 280px floor
    // with the pair already at MAX_TOTAL. Shrinking the left pane to make
    // room would cancel the nudge and freeze the separator in place.
    const width = 1056;
    const floorLeft = MIN_PANE_PX.left / width;
    const pinned = clampSplits({ left: floorLeft, right: MAX_TOTAL - floorLeft }, width);
    expect(pinned.left + pinned.right).toBeCloseTo(MAX_TOTAL, 6);
    const nudged = nudgeSplit(pinned, "left", KEY_STEP, width);
    expect(nudged.left).toBeGreaterThan(pinned.left);
    expect(nudged.right).toBeLessThan(pinned.right);
    expect(nudged.left + nudged.right).toBeLessThanOrEqual(MAX_TOTAL + 1e-9);
    const back = nudgeSplit(pinned, "right", -KEY_STEP, width);
    expect(back.right).toBeGreaterThanOrEqual(minFraction("right", width));
  });

  it("repairs non-finite input instead of propagating it", () => {
    expect(clampSplits({ left: Number.NaN, right: Number.POSITIVE_INFINITY })).toEqual(DEFAULT_SPLITS);
    expect(nudgeSplit(DEFAULT_SPLITS, "left", Number.NaN)).toEqual(DEFAULT_SPLITS);
  });

  it("nudges without mutating its input", () => {
    const before = { ...DEFAULT_SPLITS };
    expect(nudgeSplit(DEFAULT_SPLITS, "left", KEY_STEP).left).toBeCloseTo(DEFAULT_SPLITS.left + KEY_STEP, 6);
    expect(nudgeSplit(DEFAULT_SPLITS, "right", -KEY_BIG_STEP).right).toBeCloseTo(MIN_FRACTION.right, 6);
    expect(nudgeSplit(DEFAULT_SPLITS, "right", -KEY_STEP).right).toBeCloseTo(DEFAULT_SPLITS.right - KEY_STEP, 6);
    expect(DEFAULT_SPLITS).toEqual(before);
  });

  it("reports bounds that stay inside the aria ranges", () => {
    for (const side of ["left", "right"] as const) {
      const bounds = boundsFor(side);
      expect(bounds.min).toBe(MIN_FRACTION[side]);
      expect(bounds.max).toBe(maxFraction(side));
      expect(bounds.min).toBeLessThan(bounds.max);
      expect(clampSplits(DEFAULT_SPLITS, 1024)[side]).toBeGreaterThanOrEqual(bounds.min);
      expect(clampSplits(DEFAULT_SPLITS, 1024)[side]).toBeLessThanOrEqual(bounds.max);
    }
  });
});

describe("workbench split persistence", () => {
  it("round-trips splits through serialize/parse", () => {
    const stored = { left: 0.3, right: 0.2 };
    expect(parseSplits(serializeSplits(stored))).toEqual(stored);
  });

  it("rejects corrupted or out-of-range payloads", () => {
    for (const bad of [null, "", "not json", '"0.3"', '{"left":"26","right":0.2}', '{"left":0,"right":0.2}', '{"left":1.2,"right":0.2}', "{}"]) {
      expect(parseSplits(bad)).toBeNull();
    }
  });

  it("falls back to defaults when storage is missing or broken", () => {
    expect(loadSplits(null)).toEqual(DEFAULT_SPLITS);
    expect(loadSplits({ getItem: () => { throw new Error("denied"); }, setItem: () => {} })).toEqual(DEFAULT_SPLITS);
    expect(loadSplits({ getItem: () => '{"left":9000,"right":-4}', setItem: () => {} })).toEqual(DEFAULT_SPLITS);
  });

  it("loads valid stored proportions", () => {
    const stored = serializeSplits({ left: 0.31, right: 0.22 });
    expect(loadSplits({ getItem: () => stored, setItem: () => {} })).toEqual({ left: 0.31, right: 0.22 });
  });

  it("persists under the shared key and survives a blocked storage", () => {
    const written: Record<string, string> = {};
    saveSplits({ getItem: () => null, setItem: (key, value) => { written[key] = value; } }, DEFAULT_SPLITS);
    expect(Object.keys(written)).toEqual([SPLIT_STORAGE_KEY]);
    expect(parseSplits(written[SPLIT_STORAGE_KEY])).toEqual(DEFAULT_SPLITS);
    expect(() => saveSplits({ getItem: () => null, setItem: () => { throw new Error("quota"); } }, DEFAULT_SPLITS)).not.toThrow();
    expect(() => saveSplits(null, DEFAULT_SPLITS)).not.toThrow();
  });

  it("has no localStorage outside the browser", () => {
    expect(browserStorage()).toBeNull();
  });
});

describe("workbench responsive breakpoint", () => {
  const threePaneFloor = MIN_PANE_PX.left + SEPARATOR_PX + MIN_CODE_PX + SEPARATOR_PX + MIN_PANE_PX.right;

  it("reads the shared compact query instead of a hard-coded one", () => {
    const source = readFileSync(resolve(__dirname, "../app/studio/workbench.tsx"), "utf8");
    expect(source).toContain("window.matchMedia(COMPACT_QUERY)");
    expect(source).not.toContain("(max-width: 1023px)");
  });

  it("keeps the JS query and the CSS media queries in step", () => {
    expect(COMPACT_QUERY).toBe(`(max-width: ${COMPACT_MAX_WIDTH}px)`);
    expect(COMPACT_MAX_WIDTH).toBe(THREE_PANE_MIN_WIDTH - 1);
    expect(layoutCss).toContain(`@media (min-width: 1024px) and (max-width: ${COMPACT_MAX_WIDTH}px)`);
    expect(layoutCss).toContain(`@media (min-width: ${THREE_PANE_MIN_WIDTH}px)`);
    expect(layoutCss).toContain(":global(.workbench-tabs).tabs");
  });

  it("opens the three panes only where every minimum fits beside the nav", () => {
    expect(threePaneFloor).toBe(904);
    expect(NAV_WIDTH_PX + threePaneFloor).toBe(1128);
    expect(THREE_PANE_MIN_WIDTH).toBeGreaterThanOrEqual(NAV_WIDTH_PX + threePaneFloor + 40);
    for (const side of ["left", "right"] as const) {
      expect(layoutCss).toContain(`minmax(${MIN_PANE_PX[side]}px`);
    }
    expect(layoutCss).toContain(`minmax(${MIN_CODE_PX}px`);
  });

  it("tabs the panes at the widths that used to clip, three-panes at 1280", () => {
    // 1024 and 1100 leave 800px / 876px next to the nav: short of the 904px
    // the panes plus separators need, so both must stay in the tabbed band.
    for (const viewport of [1024, 1100]) {
      expect(viewport).toBeLessThanOrEqual(COMPACT_MAX_WIDTH);
      expect(viewport - NAV_WIDTH_PX).toBeLessThan(threePaneFloor);
    }
    expect(1280).toBeGreaterThanOrEqual(THREE_PANE_MIN_WIDTH);
    expect(1280 - NAV_WIDTH_PX).toBeGreaterThanOrEqual(threePaneFloor);
  });
});

describe("workbench separator theming", () => {
  it("paints the separators with theme tokens, not light-only literals", () => {
    expect(layoutCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(layoutCss).toContain("background: var(--surface-sunken)");
    expect(layoutCss).toContain("background: var(--border-field)");
    expect(layoutCss).toContain("background: var(--action)");
    expect(layoutCss).toContain("outline: 3px solid var(--action)");
    expect(layoutCss).toContain("inset 1px 0 0 var(--line)");
  });
});


// ---------------------------------------------------------------------------
// Clamp invariants swept across every operable row width
// (promoted from the temporary zz-scratch fuzz harness)
// ---------------------------------------------------------------------------

const EPS = 1e-9;
const OPERABLE_WIDTHS: number[] = [];
for (let w = THREE_PANE_FLOOR_PX; w <= 2400; w += 1) OPERABLE_WIDTHS.push(w);
/** Representative widths: the floor row, the narrowest three-pane row beside
 *  the nav, and plain desktop widths. */
const SAMPLE_WIDTHS = [THREE_PANE_FLOOR_PX, 961, 1056, 1280, 1440, 1920, 2400];

function fuzzRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("workbench clamp invariants at every operable width", () => {
  it("keeps both pane floors, the code-pane floor and the sum cap", () => {
    const rand = fuzzRng(7);
    const violations: string[] = [];
    for (const w of OPERABLE_WIDTHS) {
      for (let i = 0; i < 40; i++) {
        const input = { left: rand() * 1.2, right: rand() * 1.2 };
        const mode = i % 3;
        const next = mode === 0
          ? clampSplits(input, w)
          : mode === 1
            ? setSplit(input, "left", input.left, w)
            : setSplit(input, "right", input.right, w);
        const leftPx = next.left * w;
        const rightPx = next.right * w;
        const codePx = w - leftPx - rightPx - 2 * SEPARATOR_PX;
        if (leftPx < MIN_PANE_PX.left - EPS) violations.push(`w=${w} leftPx=${leftPx.toFixed(2)}`);
        if (rightPx < MIN_PANE_PX.right - EPS) violations.push(`w=${w} rightPx=${rightPx.toFixed(2)}`);
        if (codePx < MIN_CODE_PX - EPS) violations.push(`w=${w} codePx=${codePx.toFixed(2)} -> ${JSON.stringify(next)}`);
        if (next.left + next.right > MAX_TOTAL + EPS) violations.push(`w=${w} sum=${next.left + next.right}`);
        const again = clampSplits(next, w);
        if (Math.abs(again.left - next.left) > EPS || Math.abs(again.right - next.right) > EPS) {
          violations.push(`w=${w} not idempotent ${JSON.stringify(next)} -> ${JSON.stringify(again)}`);
        }
      }
    }
    expect(violations.slice(0, 12)).toEqual([]);
    expect(violations).toHaveLength(0);
  });

  it("caps the row by the code-pane floor before MAX_TOTAL can eat into it", () => {
    // 38% of a 904-957px row leaves the code pane under its 340px floor once
    // the two separators are taken out, so the tighter cap has to win there.
    expect(maxTotalFor()).toBe(MAX_TOTAL);
    expect(maxTotalFor(THREE_PANE_FLOOR_PX - 1)).toBe(MAX_TOTAL);
    expect(maxTotalFor(THREE_PANE_FLOOR_PX)).toBeCloseTo(1 - (MIN_CODE_PX + 2 * SEPARATOR_PX) / THREE_PANE_FLOOR_PX, 12);
    expect(maxTotalFor(THREE_PANE_FLOOR_PX)).toBeLessThan(MAX_TOTAL);
    expect(maxTotalFor(1440)).toBe(MAX_TOTAL);
    for (const w of [THREE_PANE_FLOOR_PX, 940, 1024, 1440]) {
      expect(maxTotalFor(w)).toBeGreaterThanOrEqual(minFraction("left", w) + minFraction("right", w) - EPS);
    }
  });

  it("announces bounds the clamp can actually reach", () => {
    const bad: string[] = [];
    for (const w of OPERABLE_WIDTHS) {
      for (const side of ["left", "right"] as const) {
        const declared = boundsFor(side, w);
        const authored = boundsFor(side);
        if (declared.min > declared.max + EPS) bad.push(`w=${w} ${side} min ${declared.min} exceeds max ${declared.max}`);
        if (declared.min < authored.min - EPS || declared.max > authored.max + EPS) {
          bad.push(`w=${w} ${side} ${declared.min}..${declared.max} escapes authored ${authored.min}..${authored.max}`);
        }
        const atMax = setSplit(DEFAULT_SPLITS, side, declared.max, w);
        const atMin = setSplit(DEFAULT_SPLITS, side, declared.min, w);
        if (Math.abs(atMax[side] - declared.max) > EPS) bad.push(`w=${w} ${side} End lands on ${atMax[side]} not ${declared.max}`);
        if (Math.abs(atMin[side] - declared.min) > EPS) bad.push(`w=${w} ${side} Home lands on ${atMin[side]} not ${declared.min}`);
      }
    }
    expect(bad.slice(0, 12)).toEqual([]);
    expect(bad).toHaveLength(0);
  });

  it("never reverses a nudge and never stops short of a bound", () => {
    const rand = fuzzRng(23);
    const bad: string[] = [];
    for (const w of SAMPLE_WIDTHS) {
      for (let i = 0; i < 40; i++) {
        const state = clampSplits({ left: rand(), right: rand() }, w);
        for (const side of ["left", "right"] as const) {
          const bounds = boundsFor(side, w);
          for (const [direction, delta] of [["grow", KEY_STEP], ["shrink", -KEY_STEP]] as const) {
            const next = nudgeSplit(state, side, delta, w);
            const moved = next[side] - state[side];
            if (delta > 0 ? moved < -EPS : moved > EPS) {
              bad.push(`w=${w} ${side} ${direction} reversed ${state[side]} -> ${next[side]}`);
            }
            const parked = delta > 0 ? state[side] >= bounds.max - EPS : state[side] <= bounds.min + EPS;
            if (Math.abs(moved) <= EPS && !parked) {
              bad.push(`w=${w} ${side} ${direction} froze at ${state[side]} inside ${bounds.min}..${bounds.max}`);
            }
          }
        }
      }
    }
    expect(bad.slice(0, 12)).toEqual([]);
    expect(bad).toHaveLength(0);
  });

  it("holds position once a separator parks on a bound", () => {
    const bad: string[] = [];
    for (const w of OPERABLE_WIDTHS) {
      for (const side of ["left", "right"] as const) {
        const bounds = boundsFor(side, w);
        let parkedHigh = setSplit(DEFAULT_SPLITS, side, bounds.max, w);
        for (let i = 0; i < 40; i++) {
          const next = nudgeSplit(parkedHigh, side, KEY_STEP, w);
          if (next[side] < parkedHigh[side] - EPS) bad.push(`w=${w} ${side} outward nudge shrank ${parkedHigh[side]} -> ${next[side]}`);
          if (next[side] > bounds.max + EPS) bad.push(`w=${w} ${side} climbed past max ${next[side]}`);
          parkedHigh = next;
        }
        let parkedLow = setSplit(DEFAULT_SPLITS, side, bounds.min, w);
        for (let i = 0; i < 40; i++) {
          const next = nudgeSplit(parkedLow, side, -KEY_STEP, w);
          if (next[side] > parkedLow[side] + EPS) bad.push(`w=${w} ${side} inward nudge grew ${parkedLow[side]} -> ${next[side]}`);
          if (next[side] < bounds.min - EPS) bad.push(`w=${w} ${side} slipped below min ${next[side]}`);
          parkedLow = next;
        }
      }
    }
    expect(bad.slice(0, 12)).toEqual([]);
    expect(bad).toHaveLength(0);
  });

  it("walks each separator down to its floor exactly, never under it", () => {
    const rand = fuzzRng(41);
    for (const w of SAMPLE_WIDTHS) {
      const start = clampSplits({ left: rand(), right: rand() }, w);
      for (const side of ["left", "right"] as const) {
        const floor = minFraction(side, w);
        let splits = start;
        for (let i = 0; i < 60; i++) {
          const next = nudgeSplit(splits, side, -KEY_BIG_STEP, w);
          expect(next[side]).toBeGreaterThanOrEqual(floor - EPS);
          expect(next[side]).toBeLessThanOrEqual(splits[side] + EPS);
          splits = next;
        }
        expect(Math.abs(splits[side] - floor)).toBeLessThanOrEqual(EPS);
      }
    }
  });

  it("round-trips stored splits back through load at every width", () => {
    const bad: string[] = [];
    for (const w of OPERABLE_WIDTHS.filter((_, i) => i % 7 === 0)) {
      for (const splits of [{ left: 0.14, right: 0.48 }, { left: 0.46, right: 0.16 }, { left: 0.3, right: 0.3 }]) {
        const stored = serializeSplits(setSplit(splits, "left", splits.left, w));
        const loaded = loadSplits({ getItem: () => stored, setItem: () => {} });
        const applied = clampSplits(loaded, w);
        const codePx = w - (applied.left + applied.right) * w - 2 * SEPARATOR_PX;
        if (codePx < MIN_CODE_PX - EPS) bad.push(`w=${w} ${JSON.stringify(splits)} -> ${JSON.stringify(applied)} codePx=${codePx.toFixed(2)}`);
        if (applied.left + applied.right > MAX_TOTAL + EPS) bad.push(`w=${w} sum=${applied.left + applied.right}`);
      }
    }
    expect(bad.slice(0, 12)).toEqual([]);
    expect(bad).toHaveLength(0);
  });

  it("reads the live row width into the separators' aria ranges", () => {
    // SSR cannot measure, so the source is the contract: once the row is
    // measured the separators must announce the width-aware bounds, not the
    // authored ones the clamp can no longer deliver at that width.
    const source = readFileSync(resolve(__dirname, "../app/studio/workbench.tsx"), "utf8");
    expect(source).toContain("boundsFor(side, width > 0 ? width : undefined)");
    expect(source).toContain("width={rowWidth}");
    expect(source).toContain("setRowWidth(observed)");
    expect(source).not.toContain("MIN_FRACTION[side]");
  });
});

describe("workbench run output in the Checks pane", () => {
  const runResult = {
    mode: "executed",
    executionOk: false,
    passed: false,
    execution: { status: "error", file: "main.py", line: 3, message: "NameError: name 'rows' is not defined" },
    tests: [],
    stdout: "rows loaded: 12",
    stderr: "Traceback (most recent call last): boom",
  };

  function renderChecks(result: unknown, status = "Ran successfully") {
    const html = renderToStaticMarkup(<Workbench studio={codeStudio({ result, status })} />);
    return html.slice(html.indexOf('aria-label="Checks and output"'));
  }

  it("shows stdout and stderr immediately, with no disclosure to open", () => {
    const checks = renderChecks(runResult);
    expect(checks).toContain("Console output");
    expect(checks).not.toContain("<details");
    expect(checks).not.toContain("<summary");
    expect(checks).toContain("Standard output");
    expect(checks).toContain("Standard error");
    expect(checks).toContain("rows loaded: 12");
    expect(checks).toContain("Traceback (most recent call last): boom");
    expect(checks).toContain("NameError: name");
  });

  it("says so plainly when the run printed nothing", () => {
    const checks = renderChecks({ ...runResult, stdout: "", stderr: "" });
    expect(checks).not.toContain("<details");
    expect(checks).toContain("produced no standard output or errors");
  });

  it("keeps the console block out of the pane before a run", () => {
    expect(renderChecks(null, "Needs changes")).not.toContain("Console output");
    expect(renderChecks(null, "Needs changes")).not.toContain("<details");
  });

  it("styles the block from the workbench module, not the disclosure", () => {
    expect(layoutCss).toContain(":global(.console-output).console");
    expect(layoutCss).toContain(".consoleLabel");
    expect(layoutCss).toContain(".consoleLabelError");
    expect(layoutCss).not.toContain("summary");
  });
});
