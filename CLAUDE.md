# Claude Guidance

**Read the Cursor rules in `.cursor/rules/*.mdc` before making changes** — they are the project's working agreements and apply to all agents, not just Cursor:

- `testing-standards.mdc` — required tests for core math (Vitest) and UI (Playwright), and how to verify changes
- `single-file-architecture.mdc` — client-side only; everything builds to a single HTML file
- `tailwind-exclusivity.mdc` — Tailwind only for styling
- `financial-math-readability.mdc` — financial logic must be heavily commented
- `anti-thrashing.mdc` — ask the user for guidance after repeated failures
- `repo-hygiene.mdc`, `gitignore-maintenance.mdc`, `readme-updates.mdc` — keep root clean, .gitignore and README current

## Verifying changes

Do not run the app (dev server + ad-hoc browser driving/scripts) to check your work unless explicitly instructed. Instead, write or extend a Playwright spec in `tests/e2e/` and run it — see the verification rule in `.cursor/rules/testing-standards.mdc`. Unit-test core changes with Vitest in `tests/`.

- `npm test` — Vitest unit suite
- `npx playwright test <name>` — targeted e2e spec (auto-starts/reuses the Vite dev server)
