# ads-marketplace-demo

Educational search-ads marketplace simulator: candidate generation, ranking,
second-price auctions, and budget pacing over a replayable six-hour session.

- [Implementation plan and progress](IMPLEMENTATION_PLAN.md)
- [Engine specification](docs/engine-spec.md)
- [Project agent rules](AGENTS.md)

## Local setup

Requires Node 22+ and npm. The app listens on `127.0.0.1:3002` (registered in the parent port registry).

```bash
npm install
npm run dev          # http://127.0.0.1:3002
npm run typecheck    # tsc --noEmit (run `npx next typegen` first on a fresh clone)
npm test             # vitest run
npm run lint
```

From the parent directory, `make run-ads-marketplace-demo` starts the app on its registered port.

Persistence (Neon Postgres) arrives in milestone M3; until then runs are held in server memory. Copy
`.env.example` to `.env.local` and fill in `DATABASE_URL` once M3 lands.

## Layout

- `src/lib/contracts/` shared types: scenario, campaigns, users, requests, traces, run summary, timeline, API shapes.
- `src/lib/simulation/` pure engine code (no React, database, HTTP, or wall-clock).
- `src/lib/fixtures/` hand-calculable tiny scenario used by unit tests.
- `src/app/` Next.js app router pages and API routes.

Status: M0 complete (scaffold and frozen contracts). Engine, seeded marketplace, API, and playback UI follow.
