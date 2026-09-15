import { z } from "zod";

/** Structured tutor response. Matches the spec's suggested schema exactly.
 *  Both the deterministic tutor and the OpenRouter provider path return this
 *  shape; the route zod-validates provider output against it and falls back
 *  to the deterministic tutor on any mismatch. */
export const tutorReferenceSchema = z.object({
  label: z.string().min(1),
  url: z.string().min(1),
});
export const tutorResponseSchema = z.object({
  summary: z.string().min(1),
  diagnosis: z.array(z.string().min(1)),
  nextSteps: z.array(z.string().min(1)),
  hintLevel: z.number().int().nonnegative(),
  references: z.array(tutorReferenceSchema),
});
export type TutorResponse = z.infer<typeof tutorResponseSchema>;

export interface TutorExecution {
  status: string;
  kind?: string;
  file?: string;
  line?: number;
  message?: string;
}

export interface TutorContext {
  taskId: string;
  taskTitle: string;
  requirements: string[];
  hints: string[];
  hintsUsed: number;
  code: string;
  execution: TutorExecution | null;
  failedTests: string[];
  /** Local route to the task's lesson (hash or path). References never leave the app. */
  taskUrl: string;
}

/** Mechanism-based explanations for common Python errors. Keyed by the error
 *  kind reported in the structured execution status; each entry explains the
 *  mechanism (what actually went wrong) rather than matching keywords. */
const ERROR_GUIDANCE: Record<string, string> = {
  SyntaxError:
    "Python could not parse the file, so nothing ran. Check brackets, colons, and indentation around the reported line.",
  IndentationError:
    "A block is indented inconsistently. Python uses indentation to group statements: make every line in a block use the same indent.",
  NameError:
    "A name was used before it was defined (or it was misspelled). Every variable and function must be assigned or defined before the line that uses it.",
  TypeError:
    "An operation received a value of the wrong type, e.g. adding a string to a number or calling something that is not a function.",
  ValueError:
    "The type was right but the value was not acceptable, e.g. int('abc') or a date that does not exist.",
  KeyError:
    "A dictionary lookup used a key the dictionary does not contain. Check the key spelling, or use .get() with a default when the key may be absent.",
  IndexError:
    "A list index is out of range. Remember indices start at 0, so the last valid index is len(list) - 1.",
  AttributeError:
    "The object does not have that attribute or method. Check the object's type: you may be calling a list method on a dict, or similar.",
  ImportError:
    "The import failed. Only the standard library and the packages listed for this task are available; anything else fails honestly.",
  ModuleNotFoundError:
    "The module could not be found. Only the standard library and the packages listed for this task are available.",
  ZeroDivisionError:
    "Division by zero. Guard the divisor, or skip rows where it is zero.",
  TimeoutError:
    "The run exceeded its time limit. Look for a loop whose exit condition never becomes true.",
};

function errorGuidance(kind: string | undefined): string | null {
  if (!kind) return null;
  const direct = ERROR_GUIDANCE[kind];
  if (direct) return direct;
  const base = kind.replace(/Error$/, "");
  return ERROR_GUIDANCE[`${base}Error`] ?? null;
}

/** Deterministic tutor: no API key, no network. It explains errors from the
 *  structured execution status, names the failed checks, and personalizes the
 *  next step from the task's own authored hint ladder (the next unrevealed
 *  rung). It only reads the context and returns a response: it never mutates
 *  curriculum, mastery, attempts, reviews, or project results. */
export function deterministicTutor(ctx: TutorContext): TutorResponse {
  const execution = ctx.execution;
  const hasError = execution !== null && execution.status !== "ok";
  const kind = execution?.kind;
  const where = execution?.file
    ? `${execution.file}${typeof execution.line === "number" ? ` at line ${execution.line}` : ""}`
    : "your code";
  const message = execution?.message?.trim();

  const summary = hasError
    ? `Your code stopped with${kind ? ` a ${kind}` : " an error"} in ${where}${message ? `: ${message}` : "."}`
    : ctx.failedTests.length > 0
      ? `The checks ran, but ${ctx.failedTests.length} named check${ctx.failedTests.length === 1 ? "" : "s"} failed.`
      : "No errors reported yet. Run the checks to get feedback on your current code.";

  const diagnosis: string[] = [];
  if (hasError) {
    if (message) diagnosis.push(`The reported error is: ${message}`);
    const guidance = errorGuidance(kind);
    if (guidance) diagnosis.push(guidance);
    else diagnosis.push("Read the traceback from the bottom up: the last line names the error, the lines above show where it happened.");
  }
  if (ctx.failedTests.length > 0) {
    diagnosis.push(`Failed checks: ${ctx.failedTests.join("; ")}. Each one maps to a requirement above; compare your output with the requirement text.`);
  }
  if (!ctx.code.trim()) {
    diagnosis.push("Your code editor is empty. Start from the starter code and fill in the missing logic.");
  }
  if (diagnosis.length === 0) {
    diagnosis.push("Nothing is failing yet. The checks are the source of truth: run them and read each named result.");
  }

  const nextSteps: string[] = [];
  const nextRung = ctx.hints.length === 0 ? 1 : Math.min(ctx.hintsUsed + 1, ctx.hints.length);
  if (hasError && typeof execution?.line === "number" && execution?.file) {
    nextSteps.push(`Open ${execution.file} at line ${execution.line} and read the exact expression that failed.`);
  }
  if (ctx.hints.length > 0) {
    nextSteps.push(`Hint ${nextRung} of ${ctx.hints.length}: ${ctx.hints[nextRung - 1]}`);
  }
  if (ctx.failedTests.length > 0) {
    nextSteps.push(`Pick the first failed check ("${ctx.failedTests[0]}") and write down what your code returns for that case versus what the requirement asks for.`);
  }
  nextSteps.push(
    `Review prompt: explain in your own words what your ${kind === "NameError" ? "undefined name" : "current approach"} does differently from the requirement, then change one thing and re-run.`,
  );

  const hintLevel = ctx.hints.length === 0 ? 0 : nextRung;

  return {
    summary,
    diagnosis,
    nextSteps,
    hintLevel,
    references: [{ label: `${ctx.taskTitle} — lesson`, url: ctx.taskUrl }],
  };
}
