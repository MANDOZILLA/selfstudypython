# Local learner data

Run the app on this computer with `npm run dev`. Learner state lives in
`coding-school/.data/coding-school.db`, with SQLite `-wal` and `-shm` sidecars
while open. This directory is gitignored. Windows uses the containing user's
filesystem permissions. Keep it outside shared/synced folders when possible.
The app is a single local learner tool, with no login or remote database.
The API accepts localhost/loopback requests only; do not expose it publicly.

`CODING_SCHOOL_DB_PATH` can select a different absolute local `.db` file. Paths
are resolved and validated before opening: URLs, network shares, URI options,
encoded names, alternate streams, symlinks and non-files are rejected. The
normal app needs no environment configuration. Tests always use new OS temp
directories. `CODING_SCHOOL_BUILD_DIR` isolates a test server's Next build.

## Records and migrations

`db/migrations/0001_learner.sql` is the schema source. `schema_migrations` records
version, name, SHA-256 checksum and application date. Startup runs pending
migrations transactionally. Repeated startup preserves every record; an edited
applied migration or unknown schema version fails closed. Do not edit an applied
migration: add a new version and a migration test. The initial migration only
creates tables. Before adding any destructive migration, implement and test a
consistent backup and explicit recovery path; there is no automatic destructive
rollback.

Tables: `learner_meta` (revision, import flag and UI preferences), `mission_runs`,
`mission_stages`, `mission_drafts`, `attempts`, `attempt_checks`,
`attempt_outcomes`, `review_schedules`, `portfolio_snapshots`,
`diagnostic_sessions`, `diagnostic_responses`, `save_receipts`. Diagnostic profile
and response fields are reserved placeholders until the diagnostic feature uses
them. Curriculum remains canonical files; these tables store stable IDs plus
learner-created source, responses and result snapshots. Mastery is re-derived
from validated evidence when loading. Drizzle parameterizes all learner values.

Foreign keys are enabled on the single pooled connection. SQLite uses WAL,
`synchronous=FULL`, and a 5-second busy timeout. A complete save uses a write
transaction; failures roll it all back. The revision rejects stale tabs. The
request ID and payload hash make an identical retry return its original receipt
without duplicating attempts. Changed payloads cannot reuse that ID. Integrity
checks run on demand, not on each keystroke. Indexes cover attempts by run/task,
check/outcome parents, skills, review due dates and portfolio project IDs.

## Back up

Use **Export backup** in the sidebar. JSON exports contain the current validated
state and revision. Before any restore, export the current state to a separate
file. If saving failed, **Export pending work** preserves the unacknowledged
request and any newer editor drafts. That file is a recovery artifact, not proof
that the work was committed. Do not close the page until a save succeeds or a
recovery copy is downloaded.

To make a complete physical backup (including reserved diagnostic fields and
request receipts), stop every app process using this database first. Copy the
whole `.data` directory to a new dated backup folder, including any remaining
`-wal` and `-shm` files. Never copy only a live `.db`: committed work may still
be in WAL. No automatic vacuum or database-file replacement runs in the app.

## Restore

For an exact physical restore, stop the app, move the current `.data` folder
to a dated recovery location, then copy the complete physical backup into a
new `.data` folder. Keep the old folder until startup and the integrity check
succeed. Do not overwrite an open database, and do not mix sidecars from
different backups.

For JSON restore, export the current database first. With the app running,
PowerShell can submit a validated backup as one atomic revision. Replace the
backup path below with the file you chose. This explicitly replaces learner
state; keep the pre-restore export. The API preserves request receipts and
reserved diagnostic fields. If the request response is lost, resend the same
`$restoreBody` unchanged, including its request ID.

```powershell
$backup = Get-Content -Raw -LiteralPath 'C:\Backups\coding-school-backup.json' | ConvertFrom-Json
if ($backup.format -ne 'coding-school-backup-v1') { throw 'Choose a normal JSON backup.' }
$headers = @{ 'X-Coding-School' = 'local'; Origin = 'http://localhost:3000' }
$current = Invoke-RestMethod 'http://localhost:3000/api/learner' -Headers $headers
$restoreBody = @{
  operation = 'save'; requestId = [guid]::NewGuid().ToString()
  revision = $current.revision; state = $backup.state; learningMode = $backup.learningMode
} | ConvertTo-Json -Depth 100 -Compress
Invoke-RestMethod 'http://localhost:3000/api/learner' -Method Put -Headers $headers -ContentType 'application/json' -Body ([System.Text.Encoding]::UTF8.GetBytes($restoreBody))
Invoke-RestMethod 'http://localhost:3000/api/learner?health=1' -Headers $headers
```

Reload all open tabs after restore. The API rejects malformed/corrupt data and
requests over 2,000,000 UTF-8 bytes without changing the database. Historical
curriculum/grader versions that cannot be validated fail closed for recovery;
they are never silently discarded into an empty learning record.

## Browser migration and failure behavior

An empty database offers to import a valid version-2 browser record. Nothing is
imported until **Import browser work** is selected. The original storage key and
`coding-school:sqlite-import-backup` remain recoverable, and the database records
the import once. Starting empty keeps the browser copy but initializes SQLite,
so another tab cannot later import over existing work. Corrupt browser state
opens the existing export/retry/backup-and-reset flow before learning claims.

The database must hydrate successfully before the UI shows learner evidence.
Drafts update immediately in the editor and save after 350 ms; the status says
**Saving draft…** until acknowledged. Navigation and stage advancement flush and
await saves. A failed write leaves the editor and exact retry request intact,
blocks advancement, and offers retry/export. A conflicting tab must export its
pending work and reload; it never auto-merges or overwrites newer evidence.

## Verification

`npm test` covers real temp SQLite databases, rollback, constraints, hostile
strings, migrations, revision conflicts, idempotence, HTTP validation, import
and adapter failure handling. Windows libSQL may retain native file handles
until the test worker exits; cleanup tolerates only `EBUSY` and leaves those
uniquely named temp folders for OS-temp cleanup, never a production DB.

Run `node scripts/verify-persistence.mjs` only against a fresh test server on
port 3401 with an isolated `CODING_SCHOOL_DB_PATH`. It checks actual browser
hydration, mission/attempt/draft saves, reload, offline protection and retry.
The check intentionally aborts API requests to exercise failure behavior.
