import { z } from "zod";

/** Deterministic same-origin HTTP fixtures for the http-resilience mission.
 *  The scenario parameter is enum-only: unknown scenarios and any query
 *  parameter outside the allowlist are rejected with 400. Nothing here
 *  leaves the origin; graders use injected fake transports instead. */
const scenarioSchema = z.enum([
  "success",
  "invalid-json",
  "missing-fields",
  "status-429",
  "retry-after",
  "status-500",
  "timeout",
  "paginated",
]);
const ALLOWED_PARAMS = new Set(["scenario", "page"]);
const PAGE_COUNT = 3;
const TIMEOUT_MS = 2500;

export async function GET(request: Request) {
  const url = new URL(request.url);
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key)) {
      return Response.json({ error: "unknown_parameter", parameter: key }, { status: 400 });
    }
  }
  const parsed = scenarioSchema.safeParse(url.searchParams.get("scenario"));
  if (!parsed.success) return Response.json({ error: "unknown_scenario" }, { status: 400 });
  const scenario = parsed.data;
  if (scenario !== "paginated" && url.searchParams.has("page")) {
    return Response.json({ error: "page_only_for_paginated" }, { status: 400 });
  }
  switch (scenario) {
    case "success":
      return Response.json({ items: [{ id: "a" }, { id: "b" }], next: null });
    case "invalid-json":
      return new Response("this is not json{", { headers: { "content-type": "text/plain" } });
    case "missing-fields":
      return Response.json({ wrong: "shape" });
    case "status-429":
      return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "2" } });
    case "retry-after":
      return Response.json({ error: "slow_down" }, { status: 429, headers: { "Retry-After": "120" } });
    case "status-500":
      return Response.json({ error: "boom" }, { status: 500 });
    case "timeout":
      await new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS));
      return Response.json({ items: [], next: null });
    case "paginated": {
      const page = Number(url.searchParams.get("page") ?? "1");
      if (!Number.isInteger(page) || page < 1 || page > PAGE_COUNT) {
        return Response.json({ error: "unknown_page" }, { status: 400 });
      }
      return Response.json({
        items: [{ id: `p${page}a` }, { id: `p${page}b` }],
        next: page < PAGE_COUNT ? `/api/scenarios?scenario=paginated&page=${page + 1}` : null,
      });
    }
  }
}
