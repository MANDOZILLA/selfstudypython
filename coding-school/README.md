# Coding School

A self-study Python school that runs entirely in the browser: an adaptive
placement diagnostic, ten guided missions (30–60 minutes each), three
checkpoint assessments, four portfolio projects, a multi-file browser IDE
with a real Python runtime, an offline-first AI tutor, and an adaptive skill
graph. No account, no server-side learner tracking — your work stays in
your browser.

## Requirements

- **Node.js 18+** (developed and verified on Node 24)
- **npm** (ships with Node)
- A modern browser with WebAssembly (Chrome, Edge, Firefox, Safari)
- No Python installation needed: Python runs in the browser via Pyodide

## Installation

```bash
git clone <repo-url> selfstudypython
cd selfstudypython/app/coding-school
npm install
```

This downloads the vendored Python runtime (`public/pyodide/`, ~22 MB) and
the offline pandas wheels used by the data missions.

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app is a Next.js
App Router project; the studio UI lives in `app/studio/`.

## Production

```bash
npm run build
npm run start
```

`npm run build` compiles the production bundle into `.next/` (gitignored,
never committed). `npm run start` serves it on port 3000
(`next start --port <n>` for another port). All Python execution still
happens client-side in the browser; the server only serves static assets
plus the tutor API route (see below).

## Where your data lives

**Learner state is durably stored in SQLite** at `.data/coding-school.db`
(override with `CODING_SCHOOL_DB_PATH`), served through `GET`/`PUT
/api/state` with revision-based optimistic concurrency. This includes
diagnostic sessions, mission drafts and attempts, skill evidence,
assessment results, and portfolio snapshots. The database file is
gitignored and never committed.

**The browser keeps a write-through localStorage cache** under the key
`coding-school:learner-state`, plus an offline fallback: if the server is
unreachable, the app keeps working locally and retries the sync (the nav
shows "Offline — saved in this browser, will retry"). On boot the server
copy normally wins; a differing local copy is stashed under
`coding-school:learner-state:backup:<timestamp>` instead of being dropped.
The browser also records the revision it last synced under
`coding-school:learner-state:synced-revision`, so boot can tell provably
newer local work apart from a stale server: if the server copy is *older*
than the last synced revision (e.g. restored from an older backup), your
newer work stays on screen behind the conflict banner instead of being
visibly reset; if the server is *unchanged* since the last sync, the local
difference is newer offline work and is pushed up rather than superseded.
If another tab or device writes first, you get a conflict banner — your
copy is preserved and you choose **Keep my work**, **Use the other copy**
(your tab's work is backed up first), or **Export my work** as JSON.

### Backup and restore

- If stored data ever becomes unreadable, the app refuses to overwrite it
  and offers **Export recovery copy**, which downloads
  `coding-school-recovery.txt` containing the raw saved payload.
- To back up manually, copy `.data/coding-school.db`, or copy the value of
  the `coding-school:learner-state` localStorage key (DevTools →
  Application → Local Storage).
- **There is currently no in-app import for a state backup** — restoring
  means writing the saved value back into localStorage under the same key
  with DevTools. This gap is tracked under "Known limitations".

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OPENROUTER_API_KEY` | No | — | Server-side key for the optional online tutor. **Never** put this in client code or a `NEXT_PUBLIC_` variable; the key is read only in `app/api/tutor/route.ts` and `lib/tutor-provider.ts` (server-only). |
| `TUTOR_MODEL` | No | `openai/gpt-4o-mini` | Model sent to OpenRouter's chat-completions endpoint. |
| `TUTOR_TIMEOUT_MS` | No | `20000` | Provider request timeout. |
| `TUTOR_MAX_RESPONSE_BYTES` | No | `65536` | Maximum provider response body size. |
| `CODING_SCHOOL_DB_PATH` | No | `<repo>/.data/coding-school.db` | Filesystem path for the durable learner-state SQLite database. The server only; never read from the request. |

### The tutor and OpenRouter

Tutor help is a **progressive enhancement**, not a dependency:

- With **no API key** (the default), `POST /api/tutor` answers with the
  deterministic built-in tutor (`lib/tutor.ts`), which diagnoses failed
  checks and suggests the next hint rung from authored content. The app
  works fully offline this way.
- With `OPENROUTER_API_KEY` set, the server tries
  `https://openrouter.ai/api/v1/chat/completions` once per request; on
  **any** failure (no key, 401/429/5xx, timeout, oversized or malformed
  response, network error) it falls back to the deterministic tutor. The
  key is used for one outbound request and is never logged, stored, or
  returned to the client.
- **Learning (independent) Mode** hides the tutor and hints entirely, and
  the API route rejects `independentMode: true` requests with **403** before
  any provider call — a client bypass cannot reach the provider.
- Asking the tutor permanently records AI assistance on the attempt.

### Offline limitations

- Python execution is fully offline: Pyodide and the pandas wheels are
  vendored in `public/pyodide/`.
- The **online** tutor (OpenRouter) is the only feature that needs the
  network; without a key everything else works, including the built-in
  tutor.
- Monaco editor assets are served from `/monaco/vs` by the app itself.

## Grading

Every coding task is graded by **real Python code running in your browser**,
not by pattern matching:

- **Python grader suites** (`public/grading/`): each task ships a named
  suite of checks (boundary values, empty/invalid inputs, type strictness,
  output shape). The worker runs your code against the suite in an
  isolated Pyodide runtime with a timeout.
- **Written (explain/reflect) tasks** use semantic graders
  (`lib/assessment-grading.ts`): your explanation must cover the required
  concepts; keyword stuffing without understanding fails.
- **Mutation-tested**: the verification suite proves each sampled grader
  passes a correct submission and fails a deliberately broken one
  (`tests/grader-mutation.test.ts`).
- A submission that cannot run (crash, timeout, worker failure) is graded
  as an infrastructure outcome, never as a wrong answer.

## Completion vs mastery

- **Completion** is per-task: all required checks pass and any written
  reflection is saved. Completing a mission marks it Complete in Lessons.
- **Mastery** is per-skill and qualitative — never a percentage. Status
  comes only from **independent evidence**: project work done without
  assistance, retrieval of the skill in new contexts, and spaced reviews.
  Placement, guided practice, hints, and tutor use never grant mastery.
- The skill graph (`Skill graph` on the dashboard) shows one qualitative
  status per skill with the evidence behind it, plus prerequisites. The
  recommender suggests what to do next: resume an active mission, repair
  weak prerequisites, due reviews, checkpoints, or the next lesson —
  at most two review tasks per mission.

## Portfolio export

Each of the four portfolio projects collects **immutable, hashed
snapshots** of your finished components. From the Portfolio tab,
**Download ZIP** produces a GitHub-ready archive:

- Deterministic: building the same snapshots twice yields byte-identical
  ZIPs (fixed timestamps, sorted entries).
- Rejects secrets and path traversal in file names.
- Verified by `tests/zip-export.test.ts` (determinism, extraction, and
  rejection cases).

## Verification

One command runs the whole product gate:

```bash
npm run verify:product
```

Fourteen stages, in order, with per-stage PASS/FAIL and fail-fast:

1. Unit tests (`npx vitest run`)
2. Curriculum validation (`tests/curriculum-validation.test.ts`: 10 missions,
   4 portfolio projects, 3 checkpoints, acyclic prerequisites, every grader
   reference resolves, starters cannot pass their own grader)
3. Grader mutation tests (`tests/grader-mutation.test.ts`)
4. SQLite repository/migration/security (`tests/sqlite.test.ts`)
5. TypeScript (`npx tsc --noEmit`)
6. ESLint (`npx eslint`)
7. Production build (`npm run build`)
8. Runtime-boundary trace (`tests/runtime-boundary.test.ts`: server-only
   modules and secrets never reach client code)
9. Diagnostic browser flow (`scripts/verify-diagnostic.mjs`)
10. Mission browser flow (`scripts/verify-missions.mjs`)
11. Portfolio export / ZIP inspection (`tests/zip-export.test.ts`)
12. Tutor fallback + Learning Mode (`scripts/verify-tutor.mjs`)
13. Desktop 1280×720 journey (`scripts/verify-desktop.mjs`)
14. Mobile 375×812 journey (`scripts/verify-mobile.mjs`)

Browser stages share one production server (`next start`) and fail on any
console error, page error, or horizontal overflow. The learner database
(`.data/coding-school.db`) is fingerprinted before stage 1 and after stage
14 — **any change fails the run**. The server is started without
`OPENROUTER_API_KEY` so stage 12 exercises the deterministic fallback.

Individual stages can also run standalone, e.g.
`npm run verify:diagnostic`, `npm run verify:tutor`, `npm run verify:mobile`.

## Known limitations

- **No in-app state import.** You can export a recovery copy of unreadable
  state, but restoring a backup currently requires DevTools.
- The built-in tutor is deterministic and hint-rung based — it does not
  reason about arbitrary code the way the online model does.
- Written-answer grading is semantic but heuristic; it checks concept
  coverage, not deep understanding.
- Browser support assumes WebAssembly; very old browsers cannot run the
  Python worker.
