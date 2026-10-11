# SNAKEPIT

A self-study Python school built like a training console. Run real Python in
your browser, work through missions and checkpoints, build portfolio projects,
and track qualitative skill evidence. `snakepit_` Progress stays on your
computer; the deterministic tutor works offline.

## Requirements

- Node.js 20.9+ (developed and verified on Node 24)
- npm
- A modern browser with WebAssembly (Chrome, Edge, Firefox, Safari)
- No Python installation needed; Python runs in the browser via Pyodide

## Installation

**Windows:** double-click `Start-Coding-School.bat` in the downloaded folder.
It uses an installed Node.js 20.9+ or downloads a portable Node, prepares the
app dependencies, starts the school, and opens your browser.

**Terminal:** install Node.js 20.9+ from [nodejs.org](https://nodejs.org), then:

```bash
git clone <repo-url> selfstudypython
cd selfstudypython/coding-school
npm run setup
npm run dev
```

`npm run setup` installs dependencies and prepares the editor. Add
`-- --with-browsers` to download Playwright Chromium for browser verification.

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The studio UI lives in
`app/studio/`.

## Production

```bash
npm run build
npm run start
```

Python execution runs client-side. Learner state is stored in the local
SQLite database at `.data/coding-school.db` (override with
`CODING_SCHOOL_DB_PATH`) and cached in browser local storage for offline use.

## Grading and progress

Coding tasks run real Python against named checks in an isolated Pyodide
runtime. Written tasks use semantic checks. Skill status is qualitative and
based on independent evidence; it is never displayed as a percentage. XP
tracks effort and does not affect access to lessons.

## Verification

Run `npm run verify:product` for the product verification stages. Individual
checks are available through the `verify:*` scripts and Vitest test files.

## Known limitations

- There is no in-app state import. Export a recovery copy of unreadable state;
  restoring a backup currently requires browser developer tools.
- Written-answer grading checks concept coverage but cannot assess deep
  understanding.
- Browser support requires WebAssembly.
