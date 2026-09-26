import { tutorResponseSchema, type TutorContext, type TutorResponse } from "./tutor";

/** SERVER-ONLY. This module reads OPENROUTER_API_KEY and must never be
 *  imported by client components (tests assert the client tutor panel does
 *  not import it). The key is used for one outbound request and never
 *  logged, stored, or returned. */

export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_RESPONSE_BYTES = 65536;
const MAX_CODE_CHARS = 4000;

export type FallbackReason =
  | "no_key"
  | "timeout"
  | "rate_limited"
  | "unauthorized"
  | "provider_error"
  | "malformed"
  | "oversized"
  | "network_error";

export interface ProviderResult {
  tutor: TutorResponse | null;
  reason: FallbackReason | null;
}

export interface ProviderOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxBytes?: number;
  fetchFn?: typeof fetch;
}

const SYSTEM_PROMPT = `You are a patient Python tutor for a self-study coding app. Explain errors, suggest next steps, and personalize hints.
Rules: never write the full solution; give at most one hint rung at a time; be concise.
Respond with ONLY a JSON object matching this schema:
{"summary": "string (one or two sentences)", "diagnosis": ["strings"], "nextSteps": ["strings"], "hintLevel": 1, "references": [{"label": "string", "url": "string"}]}
hintLevel is an integer: the 1-based index of the next hint rung. Keep references to the lesson itself.`;

function buildUserPrompt(ctx: TutorContext): string {
  const lines = [
    `Task: ${ctx.taskTitle}`,
    `Requirements:`,
    ...ctx.requirements.map((r) => `- ${r}`),
    `Hints authored for this task (the learner has used ${ctx.hintsUsed} of ${ctx.hints.length}):`,
    ...ctx.hints.map((h, i) => `${i + 1}. ${h}`),
    `Learner code (truncated):`,
    ctx.code.slice(0, MAX_CODE_CHARS),
  ];
  if (ctx.execution && ctx.execution.status !== "ok") {
    lines.push(
      `Latest run: ${[ctx.execution.kind, ctx.execution.file ? `in ${ctx.execution.file}` : "", typeof ctx.execution.line === "number" ? `line ${ctx.execution.line}` : "", ctx.execution.message].filter(Boolean).join(" ")}`,
    );
  }
  if (ctx.failedTests.length > 0) lines.push(`Failed checks: ${ctx.failedTests.join("; ")}`);
  return lines.join("\n");
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : fallback;
}

/** References rendered by the client stay inside this app.
 *  Fragment-only (#...) links never navigate away, so inner content is safe.
 *  Slash paths must start with a single "/" and contain no control chars or
 *  backslashes: WHATWG URL parsing strips tabs/newlines before resolving, so
 *  "/\n/evil" would otherwise normalize to "//evil" (external). */
export function isSafeAppReference(url: string): boolean {
  if (url.startsWith("#")) return true;
  if (!/^\/(?![\\/])/.test(url)) return false;
  return !/[\t\r\n\\]/.test(url);
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; oversized: false } | { text: null; oversized: true }> {
  const rawLength = response.headers.get("content-length");
  const contentLength = rawLength === null ? Number.NaN : Number(rawLength);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { text: null, oversized: true };
  }
  if (!response.body) return { text: "", oversized: false };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { text: null, oversized: true };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { text, oversized: false };
  } finally {
    reader.releaseLock();
  }
}

/** Ask OpenRouter for tutor help. Returns {tutor: null, reason} on ANY
 *  failure (no key, timeout, 429/401/5xx, oversized or malformed body,
 *  network error) so the caller can fall back to the deterministic tutor.
 *  The API key never leaves this function except in the Authorization
 *  header of the single outbound request. */
export async function requestOpenRouterTutor(
  ctx: TutorContext,
  opts: ProviderOptions = {},
): Promise<ProviderResult> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { tutor: null, reason: "no_key" };
  const model = opts.model ?? process.env.TUTOR_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = positiveInteger(opts.timeoutMs, envInt("TUTOR_TIMEOUT_MS", DEFAULT_TIMEOUT_MS));
  const maxBytes = positiveInteger(opts.maxBytes, envInt("TUTOR_MAX_RESPONSE_BYTES", DEFAULT_MAX_RESPONSE_BYTES));
  const fetchFn = opts.fetchFn ?? fetch;
  if (!isSafeAppReference(ctx.taskUrl)) return { tutor: null, reason: "malformed" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://localhost",
        "X-Title": "Coding School Tutor",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(ctx) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 800,
      }),
      signal: controller.signal,
    });
    if (response.status === 429) return { tutor: null, reason: "rate_limited" };
    if (response.status === 401) return { tutor: null, reason: "unauthorized" };
    if (!response.ok) return { tutor: null, reason: "provider_error" };
    const body = await readBoundedText(response, maxBytes);
    if (body.oversized) return { tutor: null, reason: "oversized" };
    const text = body.text;
    let content: unknown;
    try {
      const envelope = JSON.parse(text) as { choices?: { message?: { content?: unknown } }[] };
      content = envelope.choices?.[0]?.message?.content;
    } catch {
      return { tutor: null, reason: "malformed" };
    }
    let parsed: unknown = content;
    if (typeof content === "string") {
      try {
        parsed = JSON.parse(content);
      } catch {
        return { tutor: null, reason: "malformed" };
      }
    }
    const validated = tutorResponseSchema.safeParse(parsed);
    if (!validated.success) return { tutor: null, reason: "malformed" };
    if (validated.data.references.some(reference => !isSafeAppReference(reference.url))) {
      return { tutor: null, reason: "malformed" };
    }
    return { tutor: validated.data, reason: null };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { tutor: null, reason: "timeout" };
    return { tutor: null, reason: "network_error" };
  } finally {
    clearTimeout(timer);
  }
}
