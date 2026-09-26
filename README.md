# Workbench School

A single-learner Python studio that runs on this computer. The application lives in `coding-school/`.

## Start locally

**Windows, no setup:** double-click `Start-Coding-School.bat`. It downloads
Node.js automatically if you don't have it, installs everything the app
needs, starts the school, and opens it. No manual installs.

From the repository root (needs Node.js 20.9+ on PATH):

```sh
npm run setup
npm run dev
```

Open http://127.0.0.1:3000. The server binds to this computer by default; it has no multi-user authentication.

For a production build, run `npm run build`, then `npm start`.

## Verify

```sh
npm test
npm run lint
npm run verify:product
```

The whole-product verifier runs tests, type checking, lint, a production build, and desktop/mobile browser journeys. It needs Playwright Chromium (`cd coding-school` then `npx playwright install chromium`) and a free port 3100. It uses a temporary database and checks that learner data remains unchanged.

## Saved work

Progress lives in `coding-school/.data/coding-school.db`, with browser storage as an offline cache. Back up this database before moving or restoring the application.
