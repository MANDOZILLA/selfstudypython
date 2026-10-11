import { z } from "zod";
import { deterministicTutor, type TutorContext } from "../../../lib/tutor";

/** POST /api/tutor — deterministic, offline help for the current task. */
const text = (max: number) => z.string().max(max);
const tutorRequestSchema = z.object({
  taskId: text(200).min(1),
  taskTitle: text(300).min(1),
  requirements: z.array(text(2000)).max(50).default([]),
  hints: z.array(text(2000)).max(20).default([]),
  hintsUsed: z.number().int().nonnegative().default(0),
  code: z.string().max(40000).default(""),
  execution: z
    .object({
      status: text(100),
      kind: text(200).optional(),
      file: text(500).optional(),
      line: z.number().int().optional(),
      message: text(4000).optional(),
    })
    .nullable()
    .default(null),
  failedTests: z.array(text(500)).max(100).default([]),
  independentMode: z.boolean(),
  taskUrl: text(500).default("#"),
});

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = tutorRequestSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const input = parsed.data;

  // Server-side enforcement: independent mode never reaches the tutor.
  if (input.independentMode) {
    return Response.json({ error: "independent_mode" }, { status: 403 });
  }

  const ctx: TutorContext = {
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    requirements: input.requirements,
    hints: input.hints,
    hintsUsed: input.hintsUsed,
    code: input.code,
    execution: input.execution,
    failedTests: input.failedTests,
    taskUrl: input.taskUrl,
  };

  return Response.json({ source: "deterministic", tutor: deterministicTutor(ctx) });
}
