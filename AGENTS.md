# Project agent rules

Applies throughout this repository, in addition to `../AGENTS.md`.

## Scope and decisions

- Read `IMPLEMENTATION_PLAN.md` before starting. Treat its simulation contract and milestone gates as the source of truth.
- Ask the human before crossing an undefined product boundary, changing simulation semantics, making an uncertain architectural choice, adding infrastructure, or expanding scope. Explain the ambiguity, recommend the smallest option, and state what it affects.
- Do not block on routine implementation details already covered by the contract. Record consequential decisions in the plan.
- Do not add features, dependencies, or abstractions merely for hypothetical future needs. Local prototype first; production deployment is not part of this build.
- Preserve the educational distinctions: score is not bid, all billing is per impression, only eligible auction participants support prices, and pacing does not guarantee more revenue.

## Incremental delivery

- Work in small, independently testable chunks. Pass the relevant milestone gate before dependent integration work. Deliver one chunk (typically one milestone) per turn, commit it, then stop and report so the human can test before the next chunk starts; do not chain milestones in one go.
- Keep `README.md` current in the same chunk as the code: it must explain how the app works at that point (funnel, data flow, what exists so far), not only setup commands.
- Update the plan's task status, validation evidence, decisions, and handoff notes in the same chunk as implementation.
- Run focused checks and report exact commands and outcomes. Never claim unrun checks passed. Mark blocked or unavailable checks explicitly.
- Commit completed, validated logical chunks locally with descriptive messages. Do not wait until the entire app is finished. Never push without human authorization.
- Inspect `git status` and the staged diff before committing. Stage explicit paths; never sweep in another contributor's work, secrets, or generated artifacts. Do not amend, reset, or discard others' commits or changes.

## Parallel work

- Claim a task and its owned paths in the plan before editing. A coordinating agent assigns ownership and resolves overlapping work.
- Prefer separate worktrees for concurrent implementation. Sub-agents report their branch/commit, changed paths, checks, and unresolved issues to the coordinator; the coordinator updates the canonical progress table.
- Agree on shared TypeScript contracts first. Changes to shared types, schema, package dependencies/lockfile, configuration, or API semantics require coordination before editing.
- In a shared checkout, only the coordinator performs Git staging/commits; workers must not commit or modify files owned by another worker.
- Do not mark a milestone complete merely because isolated work is complete: its integration gate must pass.

## Engineering boundaries

- Keep the engine pure TypeScript: no React, database, HTTP, wall-clock, or mutable global dependencies.
- Use immutable, versioned inputs, stable ordering/tie-breaking, integer money, and request–campaign keyed randomness. Pacing is the only experimental switch between comparable runs.
- Compute runs server-side; browser playback only reveals persisted results. Playback speed must not affect outcomes.
- Historical runs must remain interpretable after defaults change. Never mutate their inputs through reset.
- Keep credentials in ignored environment files; commit only safe examples.
- Follow the parent port registry rules before assigning or starting local services. Do not invent ports silently or rely on framework defaults.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
