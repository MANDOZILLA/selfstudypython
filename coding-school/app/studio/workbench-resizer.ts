/** Sizing + persistence helpers for the desktop workbench resizers.
 *  Splits are fractions of the coding-layout row: `left` = instructions pane,
 *  `right` = checks pane, the code pane takes the remainder. */

export interface WorkbenchSplits { left: number; right: number }
export type SplitSide = keyof WorkbenchSplits;

export interface SplitBounds { min: number; max: number }

export interface SplitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_SPLITS: WorkbenchSplits = { left: 0.26, right: 0.24 };
export const SPLIT_STORAGE_KEY = "coding-school:workbench:splits";
/** Per-pane floors as fractions of the row; MIN_PANE_PX mirrors the minmax()
 *  floors in workbench-layout.module.css so stored and rendered sizes agree. */
export const MIN_FRACTION: Record<SplitSide, number> = { left: 0.14, right: 0.16 };
export const MIN_PANE_PX: Record<SplitSide, number> = { left: 280, right: 260 };
/** Mirrors the code pane's minmax() floor and --wb-sep in the module CSS. */
export const MIN_CODE_PX = 340;
export const SEPARATOR_PX = 12;
/** Narrowest layout row the three pixel floors can coexist in:
 *  280 + 12 + 340 + 12 + 260. Below it there are no resizers to size, so the
 *  pixel floors must not be applied (they would exceed their own maxima). */
export const THREE_PANE_FLOOR_PX =
  MIN_PANE_PX.left + SEPARATOR_PX + MIN_CODE_PX + SEPARATOR_PX + MIN_PANE_PX.right;
/** Width of the sticky nav the workbench sits beside (globals .studio-shell). */
export const NAV_WIDTH_PX = 224;
/** Smallest viewport that shows all three resizable panes at once:
 *  224 nav + 280 + 12 + 340 + 12 + 260 panes = 1128, plus slack for a
 *  classic scrollbar. Below it the workbench falls back to the tabbed
 *  single-pane flow instead of clipping panes off the right edge. */
export const THREE_PANE_MIN_WIDTH = 1200;
export const COMPACT_MAX_WIDTH = THREE_PANE_MIN_WIDTH - 1;
/** Media query the workbench reads for the tabbed flow; kept next to
 *  THREE_PANE_MIN_WIDTH so the JS and the module CSS stay in step. */
export const COMPACT_QUERY = `(max-width: ${COMPACT_MAX_WIDTH}px)`;
/** left + right never exceed this, so the code pane keeps >= 38% of the row. */
export const MAX_TOTAL = 0.62;
export const KEY_STEP = 0.02;
export const KEY_BIG_STEP = 0.1;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function otherSide(side: SplitSide): SplitSide {
  return side === "left" ? "right" : "left";
}

/** Fraction floor for a pane: the larger of the authored fraction and the
 *  CSS pixel floor measured against the live layout width. On rows narrower
 *  than THREE_PANE_FLOOR_PX the pixel floors cannot fit alongside the code
 *  pane's share, so only the authored fraction applies — otherwise clamp()
 *  would receive a minimum above its maximum and corrupt the splits on every
 *  compact round-trip (the tabbed flow has no resizers to honour anyway). */
export function minFraction(side: SplitSide, containerWidth?: number): number {
  const base = MIN_FRACTION[side];
  if (!containerWidth || containerWidth <= 0) return base;
  if (containerWidth < THREE_PANE_FLOOR_PX) return base;
  return Math.max(base, MIN_PANE_PX[side] / containerWidth);
}

/** Cap on left + right for a row of this width. MAX_TOTAL keeps >= 38% of the
 *  row for the code pane, but on rows narrower than ~958px the code pane's
 *  340px floor plus the two separators binds first, so honour the tighter of
 *  the two. Guarded exactly like minFraction(): below THREE_PANE_FLOOR_PX the
 *  tabbed flow owns the page, there are no resizers to size, and the code
 *  floor would push the cap under its own floors (min > max corruption). */
export function maxTotalFor(containerWidth?: number): number {
  if (!containerWidth || containerWidth <= 0) return MAX_TOTAL;
  if (containerWidth < THREE_PANE_FLOOR_PX) return MAX_TOTAL;
  return Math.min(MAX_TOTAL, 1 - (MIN_CODE_PX + 2 * SEPARATOR_PX) / containerWidth);
}

/** Largest share a pane can actually reach: the width's cap minus the other
 *  outer pane's width-dependent floor. The width-free call keeps the authored
 *  cap (MAX_TOTAL minus the other side's authored floor) for aria ranges and
 *  for rows where the pixel floors do not bind. Declaring the authored cap
 *  while the clamp can only deliver cap - pixelFloor(other) made End/Home land
 *  off the announced range: the separator froze before the value it promised. */
export function maxFraction(side: SplitSide, containerWidth?: number): number {
  return maxTotalFor(containerWidth) - minFraction(otherSide(side), containerWidth);
}

export function boundsFor(side: SplitSide, containerWidth?: number): SplitBounds {
  return { min: minFraction(side, containerWidth), max: maxFraction(side, containerWidth) };
}

export function clampSplits(
  splits: WorkbenchSplits,
  containerWidth?: number,
  keep?: SplitSide,
): WorkbenchSplits {
  const leftMin = minFraction("left", containerWidth);
  const rightMin = minFraction("right", containerWidth);
  const cap = maxTotalFor(containerWidth);
  let left = clamp(finite(splits.left, DEFAULT_SPLITS.left), leftMin, maxFraction("left", containerWidth));
  let right = clamp(finite(splits.right, DEFAULT_SPLITS.right), rightMin, maxFraction("right", containerWidth));
  const over = left + right - cap;
  if (over > 0) {
    // Give up room from the other pane first: the pane the caller is moving
    // keeps the room it asked for. Trimming the edited side would cancel the
    // nudge (the pair often already sums to MAX_TOTAL), freezing its separator
    // in both directions. Only once the other pane is on its floor does the
    // edited side give ground. No `keep` (observer/reload repair) trims left.
    const value = { left, right };
    const floor = { left: leftMin, right: rightMin };
    const order: SplitSide[] = keep === "left" ? ["right", "left"] : ["left", "right"];
    let remaining = over;
    for (const side of order) {
      const cut = Math.min(remaining, Math.max(0, value[side] - floor[side]));
      value[side] -= cut;
      remaining -= cut;
      if (remaining <= 0) break;
    }
    left = value.left;
    right = value.right;
  }
  return { left, right };
}

export function setSplit(
  splits: WorkbenchSplits,
  side: SplitSide,
  value: number,
  containerWidth?: number,
): WorkbenchSplits {
  const next: WorkbenchSplits = side === "left" ? { ...splits, left: value } : { ...splits, right: value };
  return clampSplits(next, containerWidth, side);
}

export function nudgeSplit(
  splits: WorkbenchSplits,
  side: SplitSide,
  delta: number,
  containerWidth?: number,
): WorkbenchSplits {
  return setSplit(splits, side, finite(splits[side], 0) + delta, containerWidth);
}

export function parseSplits(raw: string | null | undefined): WorkbenchSplits | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { left, right } = parsed as Partial<WorkbenchSplits>;
    if (typeof left !== "number" || typeof right !== "number") return null;
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    if (left <= 0 || left >= 1 || right <= 0 || right >= 1) return null;
    return { left, right };
  } catch {
    return null;
  }
}

export function serializeSplits(splits: WorkbenchSplits): string {
  const clamped = clampSplits(splits);
  return JSON.stringify({ left: Number(clamped.left.toFixed(4)), right: Number(clamped.right.toFixed(4)) });
}

export function browserStorage(): SplitStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSplits(storage: SplitStorage | null | undefined): WorkbenchSplits {
  if (!storage) return { ...DEFAULT_SPLITS };
  try {
    const stored = parseSplits(storage.getItem(SPLIT_STORAGE_KEY));
    return stored ? clampSplits(stored) : { ...DEFAULT_SPLITS };
  } catch {
    return { ...DEFAULT_SPLITS };
  }
}

export function saveSplits(storage: SplitStorage | null | undefined, splits: WorkbenchSplits): void {
  if (!storage) return;
  try {
    storage.setItem(SPLIT_STORAGE_KEY, serializeSplits(splits));
  } catch {
    /* private mode / quota: the layout still works, it just won't persist */
  }
}
