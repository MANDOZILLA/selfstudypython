#!/usr/bin/env node
/**
 * End-to-end verification of the diagnostic Python sandbox.
 *
 * Spawns its own fresh `next dev` on :3112 with a temporary CODING_SCHOOL_DB_PATH
 * and a temporary browser profile, so no real learner state is ever read or
 * written. Covers, at desktop 1440, intermediate 1100 and mobile 375:
 *   - layout: directions above; written answer left, Python editor/output
 *     right on desktop; stacked below the directions on mobile; no page
 *     horizontal overflow at any width
 *   - Monaco loads with its accessible label, plain-editor fallback works
 *   - written-answer and Python drafts survive a reload; hints reveal
 *   - scratch Run prints visible output through the real Pyodide worker and
 *     MUST NOT advance the question (responses / codingSuccessCount frozen)
 *   - syntax errors, runtime errors, empty scripts, Stop on an infinite loop,
 *     and editing code across repeated runs
 *   - Submit and "I do not know" both advance the isolated session correctly
 *
 * Generic sandbox code only (greeting prints, raised errors) — never the
 * curriculum's diagnostic answers. Any console error or pageerror fails the
 * run. Screenshots land in a task temp directory (paths printed at the end).
 *
 * Usage:
 *   node scripts/verify-diagnostic-sandbox.mjs            # fresh server on :3112
 *   BASE_URL=http://localhost:3100 node scripts/verify-diagnostic-sandbox.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 3112;
const EXTERNAL_BASE_URL = process.env.BASE_URL ?? null;
const BASE_URL = EXTERNAL_BASE_URL ?? `http://localhost:${PORT}`;
const SHOT_DIR = join(tmpdir(), "opencode", "diagnostic-sandbox-verify");

let failures = 0;
function check(name, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

/** Console errors and pageerrors are product failures, never just noise.
 *  Only a missing favicon is tolerated. */
function watchErrors(page) {
  const errors = [];
  page.on("pageerror", error => errors.push(`pageerror: ${String(error).split("\n")[0]}`));
  page.on("console", message => {
    if (message.type() === "error" && !/favicon/i.test(message.text())) {
      errors.push(`console: ${message.text().slice(0, 200)}`);
    }
  });
  return errors;
}

async function waitForServer(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(`server never came up at ${url}`);
}

/** Kill the whole tree of a process we started — and only that tree. */
function stopTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

const metaCounts = {
  async of(page) {
    const text = await page.locator(".diagnostic-meta").innerText().catch(() => "");
    return {
      answered: Number(/(\d+) of up to/.exec(text)?.[1] ?? -1),
      successes: Number(/(\d+) successful Python run/.exec(text)?.[1] ?? -1),
      declarations: Number(/(\d+)\s+["“]?I do not know/.exec(text)?.[1] ?? -1),
      text: text.replace(/\n/g, " "),
    };
  },
};

/** First visible locator from a candidate list (selectors may shift as the
 *  sandbox UI evolves; adaptation stays a one-line change here). */
async function firstVisible(candidates) {
  for (const locator of candidates) {
    const first = locator.first();
    if (await first.isVisible().catch(() => false)) return first;
  }
  return null;
}

const directionsOf = page => [
  page.locator(".diagnostic-prompt").first(),
  page.getByRole("region", { name: /directions|instructions/i }),
  page.locator("[aria-label*='directions' i]"),
  page.locator(".instruction-pane"),
];
const writtenAnswerOf = page => [
  page.locator("#diagnostic-answer"),
  page.locator("textarea.diagnostic-answer"),
  page.getByLabel(/written answer|your answer/i),
];
const editorOf = page => [
  page.locator(".plain-editor"),
  page.locator(".monaco-editor"),
  page.locator(".editor-canvas"),
  page.locator(".code-pane"),
];
const outputOf = page => [
  page.locator("[aria-label='Scratch run output']"),
  page.locator(".checks-panel"),
  page.locator(".console-output"),
];
const scratchRunButton = page =>
  page.locator("#diagnostic-run-scratch").or(page.getByRole("button", { name: /^(run|run python|run code|scratch run)\b/i }));
const submitButton = page =>
  page.getByRole("button", { name: /submit/i });
const unknownButton = page =>
  page.getByRole("button", { name: /I do not know/i });
const stopButton = page =>
  page.getByRole("button", { name: /^stop\b/i });

/** Semantic inline code nodes the DiagnosticPrompt helper renders; adapted to
 *  the helper's own class names once app/studio/diagnostic-prompt.tsx lands. */
const PROMPT_CODE_NODE = "code.inline-code, pre code, code";

async function isCodingView(page) {
  return firstVisible([
    page.locator("#diagnostic-run-scratch"),
    ...editorOf(page),
    scratchRunButton(page),
    page.locator("#diagnostic-run-checks"),
  ]) !== null;
}

/** Wait for the current run to settle: the run control re-enabled and no
 *  busy status text left in the actions row. */
async function waitForRunSettle(page, timeout = 180000) {
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll("button")];
    const run = buttons.find(b => /^run\b/i.test((b.textContent ?? "").trim()) || b.id === "diagnostic-run-scratch");
    if (!run) return true;
    const busy = /loading python|running checks|running code/i.test((run.textContent ?? "").trim());
    return !run.disabled && !busy;
  }, null, { timeout }).catch(() => {});
}

async function ensurePlainEditor(page) {
  const toggle = page.getByRole("button", { name: /use plain text/i });
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
  await page.locator(".plain-editor").waitFor({ state: "visible", timeout: 15000 });
}

async function fillCode(page, code) {
  await ensurePlainEditor(page);
  await page.locator(".plain-editor").fill(code);
}

/** Generic, safe sample: comment, def, function call, for/while keywords,
 *  string and number tokens — never a diagnostic answer. */
const HIGHLIGHT_SAMPLE = [
  "# generic sample comment",
  "def greet(name):",
  "    for step in range(3):",
  '        print("hello " + name)',
  "    return 12",
  "",
  'greet("world")',
  "",
].join("\n");

async function switchToMonaco(page) {
  const toggle = page.getByRole("button", { name: /use code editor/i });
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
  await page.locator(".monaco-editor").waitFor({ state: "visible", timeout: 30000 });
}

/** Distinct computed colours of Monaco's Python token spans. Waits until the
 *  tokenizer has produced at least three colours (layout can settle late). */
async function monacoTokenColors(page) {
  await page.waitForFunction(() => {
    const colors = new Set();
    for (const span of document.querySelectorAll(".monaco-editor span")) {
      if (![...span.classList].some(c => /^mtk\d+$/.test(c))) continue;
      colors.add(getComputedStyle(span).color);
    }
    return colors.size >= 3;
  }, null, { timeout: 20000 }).catch(() => {});
  return page.evaluate(() => {
    const colors = new Set();
    for (const span of document.querySelectorAll(".monaco-editor span")) {
      if (![...span.classList].some(c => /^mtk\d+$/.test(c))) continue;
      const color = getComputedStyle(span).color;
      if (color && color !== "rgba(0, 0, 0, 0)") colors.add(color);
    }
    return [...colors];
  });
}

/** DOM focus semantics of Monaco's real editing surface (never the hidden IME
 *  textarea): installed Monaco with a native EditContext keeps a DIV, older
 *  builds fall back to the textarea.inputarea. Reported for the log line. */
const MONACO_EDIT_SURFACE = ".monaco-editor .native-edit-context, .monaco-editor textarea.inputarea:not([readonly]):not([aria-hidden='true'])";

/** Click a real code line, never Monaco's empty editor gutters, and prove the
 *  editor's editing surface owns focus — the editable native-edit-context DIV
 *  (or a genuinely writable textarea.inputarea), never the readonly
 *  aria-hidden IME textarea. Then drive the accessible textbox locator so
 *  every public locator method focuses the actual editing control, and the
 *  text travels the editor's real input path into the bound draft. A
 *  standalone headless page.keyboard press has proven unreliable against
 *  Monaco's native EditContext: correct focused DIV, editContext=true, yet no
 *  text — whereas the accessible locator types successfully in a real browser
 *  window. */
async function probeMonacoEditable(page) {
  await page.bringToFront();
  await page.locator(".monaco-editor").waitFor({ state: "visible", timeout: 30000 });
  await page.locator(".monaco-editor .view-line").first().click({ timeout: 15000 });

  // Pure DOM focus: this never asserts app/model state, only focus semantics.
  const focusState = () => page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return { tag: null, cls: "", role: null, editableSurface: false, editContext: false, inMonaco: false, documentHasFocus: document.hasFocus(), detail: "activeElement=null" };
    // A real editing surface, never "editContext" merely existing on the
    // prototype: the native-edit-context DIV that owns a live EditContext, or
    // a writable textarea.inputarea — never the readonly aria-hidden one.
    const editableSurface =
      (el.classList.contains("native-edit-context") && Boolean(el.editContext)) ||
      (el.tagName === "TEXTAREA" && el.classList.contains("inputarea") &&
        !el.readOnly && el.getAttribute("aria-hidden") !== "true");
    return {
      tag: el.tagName,
      cls: typeof el.className === "string" ? el.className : "",
      role: el.getAttribute("role"),
      editableSurface: Boolean(editableSurface),
      editContext: Boolean(el.editContext),
      inMonaco: Boolean(el.closest(".monaco-editor")),
      documentHasFocus: document.hasFocus(),
      detail:
        `tag=${el.tagName} class="${typeof el.className === "string" ? el.className : ""}" ` +
        `role=${el.getAttribute("role")} contenteditable=${el.getAttribute("contenteditable")} ` +
        `editContext=${Boolean(el.editContext)} closestMonaco=${Boolean(el.closest(".monaco-editor"))} ` +
        `documentHasFocus=${document.hasFocus()}`,
    };
  });

  const state = await focusState();
  if (!state.inMonaco || !state.editableSurface) {
    // The click reached the gutter, not the editing surface: focus the real
    // editing surface directly, then judge focus once.
    const surface = page.locator(MONACO_EDIT_SURFACE).first();
    await surface.waitFor({ state: "attached", timeout: 15000 });
    await surface.focus();
  }

  const focused = await focusState();
  const focusedIsEditingSurface = focused.inMonaco && focused.editableSurface;
  if (!focusedIsEditingSurface) {
    throw new Error(
      "Monaco editing surface never took DOM focus " +
      `(after click: ${state.detail}; after: ${focused.detail}); ` +
      "activeElement must live inside .monaco-editor and be an editable " +
      "editing surface: a .native-edit-context DIV owning an EditContext, or " +
      "a writable textarea.inputarea"
    );
  }
  console.log(`monaco focus: ${focused.detail}`);

  // Accessible input, not the global keyboard: every locator method resolves and
  // focuses the real editing control before sending keys, which is what a human
  // driving the actual in-app browser gets.
  const input = page.getByRole("textbox", { name: /^Scratch Python editor\./ });
  await input.press("Control+End");
  await input.press("Enter");
  await input.pressSequentially("monacoeditprobe", { delay: 40 });
  await sleep(500);
  return { state: focused.detail, marker: "monacoeditprobe" };
}

async function setTheme(page, want) {
  const toggle = page.locator("button.theme-toggle").first();
  const isDark = async () => (await toggle.getAttribute("aria-pressed").catch(() => null)) === "true";
  if ((await isDark()) !== (want === "dark")) {
    await toggle.click({ timeout: 15000 });
    await sleep(800);
  }
  return isDark();
}

/** Highlighted code fragments inside the question text (DiagnosticPrompt):
 *  semantic <code> nodes, colour-coded token spans, no literal backticks,
 *  and the authored prose still readable. */
async function checkPromptHighlighting(page, label = "question prompt", requireCode = true) {
  const prompt = page.locator(".diagnostic-prompt").first();
  const norm = value => value.replace(/\s+/g, " ").trim();
  const raw = norm(await prompt.textContent().catch(() => ""));
  const rendered = norm(await prompt.innerText().catch(() => ""));
  check(`${label} shows no literal backticks`, raw.length > 0 && !raw.includes("`"), raw.slice(0, 90));
  check(`${label} prose stays readable`,
    raw === rendered && raw.split(" ").length >= 8 && /\?/.test(raw),
    `chars=${raw.length} words=${raw.split(" ").length}`);

  const codeNodes = prompt.locator(PROMPT_CODE_NODE);
  const count = await codeNodes.count().catch(() => 0);
  // Only prompts that author code fragments can render code nodes; a question
  // without inline code still has to be backtick-free and readable.
  check(`${label} renders semantic code nodes`,
    requireCode ? count > 0 : true,
    `${count} node(s)${requireCode ? "" : " (not authored)"}`);
  if (count > 0) {
    const codeText = norm(await codeNodes.first().textContent().catch(() => ""));
    check(`${label} code node carries code text`, codeText.length > 0 && !codeText.includes("`"), codeText.slice(0, 60));
    const box = await codeNodes.first().boundingBox();
    check(`${label} code fragment is visible`, Boolean(box && box.width > 0 && box.height > 0));
  }
  const styled = await prompt.evaluate(node => {
    const proseColor = getComputedStyle(node).color;
    const proseBg = getComputedStyle(node).backgroundColor;
    const seen = new Set();
    for (const el of node.querySelectorAll("span, code, pre")) {
      const style = getComputedStyle(el);
      if (style.color !== proseColor || style.backgroundColor !== proseBg) {
        seen.add(`${style.color}@${style.backgroundColor}`);
      }
    }
    return [...seen];
  });
  // Styled nodes exist exactly when code fragments were authored: a prose-only
  // question must render no styled code at all, rather than being forgiven.
  check(`${label} highlights code with coloured spans`,
    count > 0 ? styled.length >= 1 : styled.length === 0,
    `${count} code node(s), ${styled.length} styled set(s): ${styled.slice(0, 4).join(" | ") || "none"}`);
}

/** Layout contract at one viewport width. Returns nothing; records checks. */
async function probeLayout(page, label, width, height) {
  await page.setViewportSize({ width, height });
  await sleep(600);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${label}: no horizontal overflow at ${width}px`, scrollWidth <= width, `scrollWidth=${scrollWidth}`);

  const directions = await firstVisible(directionsOf(page));
  const answer = await firstVisible(writtenAnswerOf(page));
  const editor = await firstVisible(editorOf(page));
  const output = await firstVisible(outputOf(page));
  check(`${label}: directions, written answer and editor all render`,
    Boolean(directions && answer && editor),
    `directions=${Boolean(directions)} answer=${Boolean(answer)} editor=${Boolean(editor)}`);
  if (!directions || !answer || !editor) return;

  const d = await directions.boundingBox();
  const a = await answer.boundingBox();
  const e = await editor.boundingBox();
  check(`${label}: directions sit above the written answer and the editor`,
    d.y + d.height <= a.y + 4 && d.y + d.height <= e.y + 4,
    `directions.bottom=${(d.y + d.height).toFixed(0)} answer.top=${a.y.toFixed(0)} editor.top=${e.y.toFixed(0)}`);

  if (width >= 880) {
    check(`${label}: written answer sits left of the Python editor`,
      a.x + a.width / 2 < e.x,
      `answer.centerX=${(a.x + a.width / 2).toFixed(0)} editor.x=${e.x.toFixed(0)}`);
    if (output) {
      const o = await output.boundingBox();
      check(`${label}: output sits in the right column with the editor`,
        o.x + o.width / 2 > e.x - 4 && o.x > a.x + a.width / 2,
        `output.x=${o.x.toFixed(0)} editor.x=${e.x.toFixed(0)}`);
    }
  } else {
    check(`${label}: written answer stacks above the editor`,
      a.y + a.height <= e.y + 4,
      `answer.bottom=${(a.y + a.height).toFixed(0)} editor.top=${e.y.toFixed(0)}`);
  }
}

/** Answer concept questions until the coding sandbox view appears. */
async function reachCodingView(page) {
  for (let step = 0; step < 40; step++) {
    if (await isCodingView(page)) return true;
    const answer = page.locator("#diagnostic-answer");
    if (await answer.isVisible().catch(() => false)) {
      await answer.fill("I am reasoning through this diagnostic question in my own words.");
      await submitButton(page).first().click();
      await sleep(600);
      continue;
    }
    const unknown = unknownButton(page);
    if (await unknown.isVisible().catch(() => false)) {
      await unknown.click();
      await sleep(600);
      continue;
    }
    break;
  }
  return isCodingView(page);
}

async function sandboxFlow(page) {
  check("dashboard offers the diagnostic entry",
    await page.getByRole("button", { name: /take the placement diagnostic|resume diagnostic/i }).first().isVisible({ timeout: 20000 }).catch(() => false));
  await page.getByRole("button", { name: /take the placement diagnostic|resume diagnostic/i }).first().click();
  await page.waitForURL(/diagnostic\?session=/, { timeout: 20000 });

  check("reached a question with the Python sandbox", await reachCodingView(page));

  // Monaco must load with its accessible label, then fall back to plain text
  // for reliable automation.
  await page.locator(".monaco-editor").waitFor({ state: "visible", timeout: 90000 }).catch(() => {});
  const monacoVisible = await page.locator(".monaco-editor").isVisible().catch(() => false);
  check("Monaco editor loads", monacoVisible);
  check("Monaco exposes an accessible Python aria-label",
    (await page.locator(".monaco-editor textarea[aria-label*='Python' i], [aria-label*='Python editor' i]").count()) > 0);
  await ensurePlainEditor(page);
  check("plain-editor fallback renders", await page.locator(".plain-editor").isVisible());

  // Layout contract at all three widths, before any run mutates the session.
  await probeLayout(page, "desktop 1440", 1440, 900);
  await probeLayout(page, "intermediate 1100", 1100, 900);
  await page.screenshot({ path: join(SHOT_DIR, "diagnostic-sandbox-1100.png") });
  await probeLayout(page, "mobile 375", 375, 812);
  await page.screenshot({ path: join(SHOT_DIR, "diagnostic-sandbox-mobile-375.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(600);

  // Draft persistence: written answer + Python draft survive a reload.
  const promptBefore = await page.locator(".diagnostic-prompt").first().innerText().catch(() => "");
  const answer = await firstVisible(writtenAnswerOf(page));
  if (answer) await answer.fill("Sandbox written-answer draft marker 42.");
  await fillCode(page, 'print("sandbox-draft-marker")\n');
  await page.reload({ waitUntil: "networkidle" });
  await ensurePlainEditor(page).catch(() => {});
  const restoredCode = await page.locator(".plain-editor").inputValue().catch(() => "");
  check("Python draft restored after reload", restoredCode.includes("sandbox-draft-marker"), restoredCode.slice(0, 60));
  const answerAfter = await firstVisible(writtenAnswerOf(page));
  const restoredAnswer = answerAfter ? await answerAfter.inputValue().catch(() => "") : "";
  check("written-answer draft restored after reload",
    restoredAnswer.includes("Sandbox written-answer draft marker 42."),
    restoredAnswer.slice(0, 60));

  // Hints.
  const hintButton = page.getByRole("button", { name: /reveal hint/i }).first();
  if (await hintButton.isVisible().catch(() => false)) {
    await hintButton.click();
    check("revealing a hint shows its text", await page.locator(".diagnostic-hints").getByText(/Hint 1/).first().isVisible().catch(() => false));
  } else {
    check("coding question exposes at least one hint", false, "no reveal-hint control visible");
  }

  // DiagnosticPrompt: highlighted code fragments, no literal backticks.
  await checkPromptHighlighting(page);

  const scratch = scratchRunButton(page);
  const hasScratch = await scratch.first().isVisible().catch(() => false);
  check("scratch Run control is present", hasScratch);
  const hasSubmit = await submitButton(page).first().isVisible().catch(() => false);
  check("Submit control is present on the coding question", hasSubmit);

  if (hasScratch) {
    const before = await metaCounts.of(page);

    // Scratch print: real Pyodide output, zero session mutation.
    await fillCode(page, 'print("sandbox-scratch-ok")\n');
    await scratch.first().click();
    await waitForRunSettle(page);
    check("scratch print shows visible output",
      await page.getByText("sandbox-scratch-ok").first().isVisible({ timeout: 60000 }).catch(() => false));
    let after = await metaCounts.of(page);
    check("scratch print leaves responses and codingSuccessCount unchanged",
      after.answered === before.answered && after.successes === before.successes,
      `${before.answered}/${before.successes} -> ${after.answered}/${after.successes}`);
    check("scratch print does not advance the question",
      (await page.locator(".diagnostic-prompt").first().innerText().catch("")) === promptBefore);

    // Syntax error.
    await fillCode(page, "def broken(:\n    pass\n");
    await scratch.first().click();
    await waitForRunSettle(page);
    check("syntax error surfaces an error message",
      await page.getByText(/The run stopped with an error|SyntaxError/i).first().isVisible({ timeout: 30000 }).catch(() => false));
    after = await metaCounts.of(page);
    check("syntax error records nothing",
      after.answered === before.answered && after.successes === before.successes,
      after.text);

    // Runtime error.
    await fillCode(page, 'raise RuntimeError("sandbox-boom")\n');
    await scratch.first().click();
    await waitForRunSettle(page);
    check("runtime error output is visible",
      await page.getByText(/sandbox-boom|RuntimeError/).first().isVisible({ timeout: 30000 }).catch(() => false));
    after = await metaCounts.of(page);
    check("runtime error records nothing",
      after.answered === before.answered && after.successes === before.successes, after.text);

    // Editing across repeated runs.
    await fillCode(page, 'print("sandbox-edit-one")\n');
    await scratch.first().click();
    await waitForRunSettle(page);
    check("edited code run shows its new output",
      await page.getByText("sandbox-edit-one").first().isVisible({ timeout: 60000 }).catch(() => false));
    await fillCode(page, 'print("sandbox-edit-two")\n');
    await scratch.first().click();
    await waitForRunSettle(page);
    check("second edit replaces the previous run output",
      await page.getByText("sandbox-edit-two").first().isVisible({ timeout: 60000 }).catch(() => false));

    // Empty script.
    await fillCode(page, "");
    await scratch.first().click();
    await waitForRunSettle(page);
    after = await metaCounts.of(page);
    check("empty script neither crashes nor records anything",
      after.answered === before.answered && after.successes === before.successes, after.text);

    // Infinite loop + Stop.
    await fillCode(page, "while True:\n    pass\n");
    await scratch.first().click();
    const stop = stopButton(page);
    check("Stop control appears while a long run is busy",
      await stop.first().isVisible({ timeout: 60000 }).catch(() => false));
    await stop.first().click().catch(() => {});
    await waitForRunSettle(page, 90000);
    after = await metaCounts.of(page);
    check("stopping the infinite loop leaves the session untouched",
      after.answered === before.answered && after.successes === before.successes, after.text);

    // Final desktop scene, before Submit: fill the generic sample through the
    // plain editor, run it for visible output, then switch to the real Monaco
    // editor and verify highlighting in light and dark themes.
    await fillCode(page, HIGHLIGHT_SAMPLE);
    await scratch.first().click();
    await waitForRunSettle(page);
    check("final scene shows the successful print output",
      await page.getByText("hello world").first().isVisible({ timeout: 60000 }).catch(() => false));

    await switchToMonaco(page);
    const lightColors = await monacoTokenColors(page);
    check("Monaco shows several distinct Python token colours (light theme)",
      lightColors.length >= 3, lightColors.join(" | "));

    const probe = await probeMonacoEditable(page);
    await ensurePlainEditor(page);
    const plainAfterProbe = await page.locator(".plain-editor").inputValue();
    check("accessible Monaco input stays editable: marker lands in the bound draft",
      plainAfterProbe.includes(probe.marker),
      `focus=${probe.state} plain=${plainAfterProbe.includes(probe.marker)} value=${plainAfterProbe.slice(-80)}`);
    await page.reload({ waitUntil: "networkidle" });
    await ensurePlainEditor(page);
    const persistedProbe = await page.locator(".plain-editor").inputValue();
    check("Monaco probe text survives a reload",
      persistedProbe.includes(probe.marker),
      persistedProbe.slice(-80));
    await switchToMonaco(page);

    await page.screenshot({ path: join(SHOT_DIR, "diagnostic-sandbox-monaco-light-1440.png") });
    check("dark theme engages for the Monaco check", (await setTheme(page, "dark")) === true);
    const darkColors = await monacoTokenColors(page);
    check("Monaco shows several distinct Python token colours (dark theme)",
      darkColors.length >= 3, darkColors.join(" | "));
    check("dark theme repaints Monaco token colours",
      darkColors.join("|") !== lightColors.join("|"), `${lightColors.length} light vs ${darkColors.length} dark`);
    await page.screenshot({ path: join(SHOT_DIR, "diagnostic-sandbox-monaco-dark-1440.png") });

    // Mobile 375 with Monaco: layout and syntax highlighting must hold at phone
    // width in both themes, with the viewport returned to 1440 and the theme to
    // light before Submit.
    await page.setViewportSize({ width: 375, height: 812 });
    await setTheme(page, "dark");
    await probeLayout(page, "Monaco mobile 375 dark", 375, 812);
    const mobileDarkColors = await monacoTokenColors(page);
    check("Monaco shows several distinct Python token colours (mobile 375, dark theme)",
      mobileDarkColors.length >= 3, mobileDarkColors.join(" | "));
    await page.screenshot({ path: join(SHOT_DIR, "diagnostic-sandbox-monaco-mobile-dark-375.png"), fullPage: true });
    await setTheme(page, "light");
    await probeLayout(page, "Monaco mobile 375 light", 375, 812);
    const mobileLightColors = await monacoTokenColors(page);
    check("Monaco shows several distinct Python token colours (mobile 375, light theme)",
      mobileLightColors.length >= 3, mobileLightColors.join(" | "));
    await page.screenshot({ path: join(SHOT_DIR, "diagnostic-sandbox-monaco-mobile-light-375.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await sleep(600);

    check("light theme restored", (await setTheme(page, "light")) === false);
    await sleep(500);

    await page.screenshot({ path: join(SHOT_DIR, "diagnostic-sandbox-desktop-1440.png") });
  } else {
    await page.screenshot({ path: join(SHOT_DIR, "diagnostic-sandbox-desktop-1440.png") });
  }

  // Submit advances the isolated session.
  const beforeSubmit = await metaCounts.of(page);
  if (hasSubmit) {
    await fillCode(page, 'print("sandbox-submit-probe")\n');
    await submitButton(page).first().click();
    await page.waitForFunction((n) => {
      const meta = document.querySelector(".diagnostic-meta")?.textContent ?? "";
      return new RegExp(`${n + 1}\\s+of up to`).test(meta.replace(/\s+/g, " "));
    }, beforeSubmit.answered, { timeout: 60000 }).catch(() => {});
    const afterSubmit = await metaCounts.of(page);
    check("Submit advances the question count",
      afterSubmit.answered === beforeSubmit.answered + 1,
      `${beforeSubmit.answered} -> ${afterSubmit.answered}`);
  }

  // "I do not know" also advances, as a declaration, never a success.
  const beforeUnknown = await metaCounts.of(page);
  const unknown = unknownButton(page).first();
  if (await unknown.isVisible().catch(() => false)) {
    await unknown.click();
    await page.waitForFunction((n) => {
      const meta = document.querySelector(".diagnostic-meta")?.textContent ?? "";
      return new RegExp(`${n + 1}\\s+of up to`).test(meta.replace(/\s+/g, " "));
    }, beforeUnknown.answered, { timeout: 60000 }).catch(() => {});
    const afterUnknown = await metaCounts.of(page);
    check("I do not know advances the question count",
      afterUnknown.answered === beforeUnknown.answered + 1,
      `${beforeUnknown.answered} -> ${afterUnknown.answered}`);
    check("I do not know never counts as a successful run",
      afterUnknown.successes === beforeUnknown.successes,
      `${beforeUnknown.successes} -> ${afterUnknown.successes}`);
  } else {
    check("I do not know is offered on the next question", false, "control not visible");
  }

  // The next question exercises the prompt helper again: prose may author no
  // code fragments at all, so code nodes are only required when authored.
  await checkPromptHighlighting(page, "next question prompt", false);
}

async function main() {
  const { chromium } = await import("playwright");
  mkdirSync(SHOT_DIR, { recursive: true });

  let server = null;
  let tempRoot = null;
  let context = null;
  try {
    if (!EXTERNAL_BASE_URL) {
      const busy = await fetch(BASE_URL).then(() => true).catch(() => false);
      if (busy) throw new Error(`port ${PORT} is already in use — free it so the run tests its own fresh server`);
      tempRoot = mkdtempSync(join(tmpdir(), "coding-school-sandbox-verify-"));
      const dbPath = join(tempRoot, "coding-school.db");
      spawnSync(process.execPath, ["scripts/prepare-editor.mjs"], { cwd: ROOT, stdio: "ignore" });
      const env = { ...process.env, CODING_SCHOOL_DB_PATH: dbPath };
      delete env.OPENROUTER_API_KEY;
      server = spawn(process.execPath,
        [createRequire(import.meta.url).resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(PORT)],
        { cwd: ROOT, stdio: "ignore", env });
      await waitForServer(BASE_URL);
      console.log(`fresh dev server up at ${BASE_URL} (CODING_SCHOOL_DB_PATH=${dbPath})`);
    }

    // Temporary browser profile: no real learner storage is ever touched.
    const profileDir = join(tempRoot ?? mkdtempSync(join(tmpdir(), "coding-school-sandbox-profile-")), "browser-profile");
    context = await chromium.launchPersistentContext(profileDir, {
      args: ["--no-sandbox"],
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await sandboxFlow(page);
    check("zero console/page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
  } finally {
    if (context) await context.close().catch(() => {});
    stopTree(server);
    if (tempRoot) {
      try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
  console.log(failures === 0 ? "\nAll sandbox checks passed." : `\n${failures} check(s) failed.`);
  console.log(`screenshots: ${SHOT_DIR}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(error => { console.error(`FATAL: ${error.message}`); process.exit(2); });
