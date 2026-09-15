import { destinations, type Destination } from "./studio";

export type Route = {
  destination: Destination;
  runId?: string;
  taskId?: string;
  completedRunId?: string;
  diagnosticSessionId?: string;
};

/** Parse a location hash (e.g. "#diagnostic?session=abc") into a route. Unknown hashes fall back to Today. */
export function readRoute(hash: string): Route {
  const [name, search] = hash.slice(1).split("?");
  const params = new URLSearchParams(search);
  if (name === "summary" && params.get("run")) return { destination: "today", completedRunId: params.get("run")! };
  if (name === "workbench" && params.get("run")) return { destination: "today", runId: params.get("run")!, taskId: params.get("task") ?? undefined };
  if (name === "diagnostic" && params.get("session")) return { destination: "today", diagnosticSessionId: params.get("session")! };
  return { destination: destinations.some(d => d.id === name) ? name as Destination : "today" };
}

/** Serialize a route back to a location hash. Round-trips with readRoute. */
export function routeHash(route: Route): string {
  if (route.diagnosticSessionId) return `#diagnostic?session=${encodeURIComponent(route.diagnosticSessionId)}`;
  if (route.completedRunId) return `#summary?run=${encodeURIComponent(route.completedRunId)}`;
  if (!route.runId) return `#${route.destination}`;
  const params = new URLSearchParams({ run: route.runId });
  if (route.taskId) params.set("task", route.taskId);
  return `#workbench?${params}`;
}
