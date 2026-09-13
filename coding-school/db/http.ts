import "server-only";
import { z } from "zod";
import { MAX_STATE_BYTES, PersistenceError, errorSchema, receiptSchema, saveRequestSchema, snapshotSchema } from "../lib/persistence-contract";
import type { LearnerRepository } from "./repository";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json") || Number(request.headers.get("content-length")) > MAX_STATE_BYTES) throw new PersistenceError("invalid");
  const reader = request.body?.getReader();
  if (!reader) throw new PersistenceError("invalid");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0, text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_STATE_BYTES) { await reader.cancel(); throw new PersistenceError("invalid"); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch { throw new PersistenceError("invalid"); }
  finally { reader.releaseLock(); }
}
export async function handleLearnerRequest(request: Request, repository: () => Promise<LearnerRepository>) {
  try {
    const url = new URL(request.url);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || request.headers.get("x-coding-school") !== "local" || request.headers.get("sec-fetch-site") === "cross-site" || (request.headers.has("origin") && request.headers.get("origin") !== url.origin)) throw new PersistenceError("forbidden");
    if (request.method !== "GET" && request.method !== "PUT") throw new PersistenceError("method");
    if (request.method === "PUT") {
      if (request.headers.get("origin") !== url.origin) throw new PersistenceError("forbidden");
      const payload = saveRequestSchema.parse(await readBody(request));
      const result = receiptSchema.parse(await (await repository()).save(payload));
      return Response.json(result, { headers });
    }
    const repo = await repository();
    if (url.searchParams.get("export") === "1") return new Response(await repo.exportJson(), { headers: { ...headers, "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="coding-school-backup.json"' } });
    if (url.searchParams.get("health") === "1") {
      const result = z.object({ ok: z.boolean(), schemaVersion: z.number().int(), journalMode: z.string(), foreignKeys: z.boolean() }).parse(await repo.health());
      return Response.json(result, { status: result.ok ? 200 : 503, headers });
    }
    return Response.json(snapshotSchema.parse(await repo.load()), { headers });
  } catch (error) {
    const safe = error instanceof PersistenceError ? error : error instanceof z.ZodError ? new PersistenceError("invalid") : new PersistenceError("unavailable");
    return Response.json(errorSchema.parse({ code: safe.code, message: safe.message }), { status: { invalid: 400, conflict: 409, unavailable: 503, forbidden: 403, method: 405 }[safe.code], headers: { ...headers, ...(safe.code === "method" ? { Allow: "GET, PUT" } : {}) } });
  }
}
