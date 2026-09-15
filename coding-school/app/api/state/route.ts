import { closeServerDatabase, getServerDatabase, readServerSnapshot, trySaveStateWithRevision } from "../../../db/client";
import { migrateState } from "../../../lib/state";

/** GET + PUT /api/state — the durable learner-state store.
 *
 *  SQLite is the durable source of truth; the browser keeps a write-through
 *  localStorage cache and an offline fallback. Writes use optimistic
 *  concurrency: the client sends the revision it last read, and a stale
 *  writer gets 409 with the current server copy so no tab's work is ever
 *  silently overwritten. Payloads are re-normalized through migrateState on
 *  the server, so only valid learner state is ever stored.
 *
 *  The database path comes only from process.env.CODING_SCHOOL_DB_PATH or the
 *  default <repo>/.data/coding-school.db — never from the request. No
 *  secrets are involved and state payloads are never logged. */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function GET() {
  const { client } = await getServerDatabase();
  const snapshot = await readServerSnapshot(client);
  return Response.json({ revision: snapshot.revision, state: snapshot.state, updatedAt: snapshot.updatedAt });
}

function invalid() {
  return Response.json({ error: "invalid_request" }, { status: 400 });
}

export async function PUT(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return invalid();
  }
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return invalid();
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const { revision, state } = raw as { revision?: unknown; state?: unknown };
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) return invalid();
  // migrateState normalizes but never rejects garbage; require an object
  // shape first so a malformed payload cannot wipe the store into defaults.
  if (!state || typeof state !== "object" || Array.isArray(state)) return invalid();

  const { client } = await getServerDatabase();
  let result: Awaited<ReturnType<typeof trySaveStateWithRevision>>;
  try {
    result = await trySaveStateWithRevision(client, migrateState(state), revision);
  } catch (error) {
    // Another server process holds the write lock (BEGIN IMMEDIATE failed).
    // The client is unusable for further transactions after this (driver
    // quirk), so drop it — the next request reopens fresh — and tell the
    // browser to retry. The sync layer treats 5xx as transient offline.
    if (isBusyError(error)) {
      closeServerDatabase();
      return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
    }
    throw error;
  }
  if (result.ok) return Response.json({ revision: result.revision });
  return Response.json(
    { error: "revision_conflict", revision: result.revision, state: result.state },
    { status: 409 },
  );
}

/** Structured SQLITE_BUSY check — never message matching. */
function isBusyError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "SQLITE_BUSY"
  );
}
