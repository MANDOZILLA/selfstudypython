import { z } from "zod";
import { deterministicTutor, type TutorContext } from "../../../lib/tutor";
import { requestOpenRouterTutor } from "../../../lib/tutor-provider";

/** POST /api/tutor — tutor help for the current task.
 *
 *  The OpenRouter key lives ONLY here on the server: it is read from
 *  process.env per request, used for a single outbound call, and never
 *  sent to the client, logged, or persisted. With no key (or any provider
 *  failure: 401/429/5xx, timeout, oversized or malformed response) the
 *  deterministic local tutor answers instead, so the endpoint works fully
 *  offline. Independent (Learning) Mode requests are rejected before any
 *  provider call, so a client bypass cannot reach the provider. */
const tutorRequestSchema = z.object({
  taskId: z.string().min(1),
  taskTitle: z.string().min(1),
  requirements: z.array(z.string()).default([]),
  hints: z.array(z.string()).default([]),
  hintsUsed: z.number().int().nonnegative().default(0),
  code: z.string().max(40000).default(""),
  execution: z
    .object({
      status: z.string(),
      kind: z.string().optional(),
      file: z.string().optional(),
      line: z.number().int().optional(),
      message: z.string().optional(),
    })
    .nullable()
    .default(null),
  failedTests: z.array(z.string()).default([]),
  independentMode: z.boolean(),
  taskUrl: z.string().default("#"),
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

  // Server-side enforcement: Learning (independent) Mode never reaches the tutor.
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

  const provider = await requestOpenRouterTutor(ctx);
  if (provider.tutor) {
    return Response.json({ source: "openrouter", tutor: provider.tutor });
  }
  const tutor = deterministicTutor(ctx);
  return Response.json({ source: "deterministic", tutor, fallbackReason: provider.reason ?? "no_key" });
}
