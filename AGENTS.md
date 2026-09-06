# Project agent rules

Applies throughout this repository, in addition to `../AGENTS.md`.

## Scope and decisions

- Read `README.md` before starting. Its "How the app works" and "The simulation engine" sections are the source of truth for the simulation contract and the app's data flow; there is no separate plan or spec document.
- For any UI work, follow the README's "Design principles" section: lead with the learning journey, reveal implementation details on demand, keep the overview uncluttered, compare modes fairly, and never imply pacing must win. Use amCharts 5 for time-series charts; preserve its branding unless appropriately licensed.
- Ask the human before crossing an undefined product boundary, changing simulation semantics, making an uncertain architectural choice, adding infrastructure, or expanding scope. Explain the ambiguity, recommend the smallest option, and state what it affects.
- Do not block on routine implementation details already covered by the contract. Record consequential decisions in the README section they affect.
- Do not add features, dependencies, or abstractions merely for hypothetical future needs. Local prototype first; production deployment is not part of this build.
- Preserve the educational distinctions: ranking is utility (bid times quality), not bid alone; quality gates participation while utility decides order; better quality buys the same position for less; all billing is per impression; only eligible auction participants support prices; and pacing does not guarantee more revenue.

## Incremental delivery

- Work in small, independently testable chunks. Deliver one logical chunk per turn, commit it, then stop and report so the human can test before the next chunk starts; do not chain several chunks in one go.
- Keep `README.md` current in the same chunk as the code: it must explain how the app works at that point (funnel, data flow, what exists so far), not only setup commands.
- Run focused checks and report exact commands and outcomes. Never claim unrun checks passed. Mark blocked or unavailable checks explicitly.
- Commit completed, validated logical chunks locally with descriptive messages. Do not wait until the entire app is finished. Never push without human authorization.
- Inspect `git status` and the staged diff before committing. Stage explicit paths; never sweep in another contributor's work, secrets, or generated artifacts. Do not amend, reset, or discard others' commits or changes.

## Parallel work

- Agree on task ownership and owned paths before editing. A coordinating agent assigns ownership and resolves overlapping work.
- Prefer separate worktrees for concurrent implementation. Sub-agents report their branch/commit, changed paths, checks, and unresolved issues to the coordinator.
- Agree on shared TypeScript contracts first. Changes to shared types, schema, package dependencies/lockfile, configuration, or API semantics require coordination before editing.
- In a shared checkout, only the coordinator performs Git staging/commits; workers must not commit or modify files owned by another worker.
- Do not call a chunk complete merely because isolated work is complete: it must pass typecheck, lint, tests, and build once integrated.

## Engineering boundaries

- Keep the engine pure TypeScript: no React, database, HTTP, wall-clock, or mutable global dependencies.
- Use immutable, versioned inputs, stable ordering/tie-breaking, integer money, and request–campaign keyed randomness. Pacing is the only experimental switch between comparable runs.
- Compute runs server-side; browser playback only reveals persisted results. Playback speed must not affect outcomes.
- Historical runs must remain interpretable after defaults change. Never mutate their inputs through reset.
- Keep credentials in ignored environment files; commit only safe examples.
- Follow the parent port registry rules before assigning or starting local services. Do not invent ports silently or rely on framework defaults.

### Determinism rules

The same snapshot and pacing mode must always produce byte-identical output, in this process and in any later one. These rules are enforced by the guard test in `src/lib/simulation/engine.test.ts`; extend that test rather than relying on review when you add a new rule.

- Banned inside `src/lib/simulation/**`: `Math.random`, `crypto.getRandomValues`, `Date.now`, `new Date`, `performance.now`, `process.env`, `setTimeout`, and imports of `react`, `next`, `pg`, or `drizzle`. Simulated time comes only from a request's `timestampMs`.
- Every random-looking value must be a pure function of its inputs. Inside request processing, derive it from `stableRandom(seed, requestId, campaignId, purpose)`; never advance a shared stream, and never let one candidate's draw depend on how many candidates were evaluated before it. Give each new use its own `purpose` string so adding one does not shift existing draws.
- Scenario generation may use the seeded `mulberry32` helper because it runs once, before the run; request processing may not.
- Do not introduce randomness that the lesson does not need. Prefer a fixed scenario parameter or a seeded per-campaign constant over sampling at simulation time. Noise, jitter, and sampled clicks or conversions are out of scope; ask before adding any.
- Order every collection you iterate or emit. Sort by an explicit key and break ties on campaign ID or request ID, never on insertion, `Object.keys`, or `Map` order. Requests run in `(timestampMs, id)` order.
- Keep money in integer microdollars. Fractional arithmetic is allowed for targets and probabilities only, and must never reach a balance or a charge.
- Changing any of the above changes historical results: bump `ENGINE_VERSION`, and treat runs with a different engine version or input hash as incomparable rather than overlaying them.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
