import { describe, expect, it } from "vitest";
import { GET } from "../app/api/scenarios/route";

const get = (query: string) => GET(new Request(`http://localhost/api/scenarios${query}`));

describe("scenario fixtures", () => {
  it("serves the success scenario", async () => {
    const res = await get("?scenario=success");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [{ id: "a" }, { id: "b" }], next: null });
  });
  it("serves invalid json as plain text", async () => {
    const res = await get("?scenario=invalid-json");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("this is not json{");
    await expect(res.json()).rejects.toThrow();
  });
  it("serves a malformed envelope", async () => {
    const res = await get("?scenario=missing-fields");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ wrong: "shape" });
  });
  it("serves 429 with a small retry-after", async () => {
    const res = await get("?scenario=status-429");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("2");
  });
  it("serves 429 with a retry-after above the client cap", async () => {
    const res = await get("?scenario=retry-after");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(60);
  });
  it("serves a 500", async () => {
    const res = await get("?scenario=status-500");
    expect(res.status).toBe(500);
  });
  it("delays the timeout scenario past a short client deadline", async () => {
    const winner = await Promise.race([
      get("?scenario=timeout").then(() => "responded"),
      new Promise((resolve) => setTimeout(() => resolve("deadline"), 500)),
    ]);
    expect(winner).toBe("deadline");
  });
  it("walks three paginated pages with same-origin next cursors", async () => {
    let query = "?scenario=paginated";
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await get(query);
      expect(res.status).toBe(200);
      const body = await res.json();
      seen.push(...body.items.map((item: { id: string }) => item.id));
      query = body.next ? new URL(body.next, "http://localhost").search : "";
      if (page < 3) expect(body.next.startsWith("/api/scenarios")).toBe(true);
    }
    expect(seen).toEqual(["p1a", "p1b", "p2a", "p2b", "p3a", "p3b"]);
    expect(query).toBe("");
  });
  it("rejects unknown scenarios", async () => {
    for (const query of ["?scenario=nope", "?", "?scenario="]) {
      const res = await get(query);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("unknown_scenario");
    }
  });
  it("rejects arbitrary url parameters", async () => {
    const res = await get("?scenario=success&url=https://evil.dev&foo=1");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unknown_parameter");
  });
  it("rejects page outside the paginated scenario", async () => {
    const res = await get("?scenario=success&page=2");
    expect(res.status).toBe(400);
  });
  it("rejects out-of-range pages", async () => {
    for (const query of ["?scenario=paginated&page=0", "?scenario=paginated&page=4", "?scenario=paginated&page=x"]) {
      expect((await get(query)).status).toBe(400);
    }
  });
});
