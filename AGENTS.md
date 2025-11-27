# Repository Guidelines

## Repository Language Rules

- Code comments and Commit Messages must be written in English.

## Project Structure & Module Organization

- Root uses pnpm workspaces (`pnpm-workspace.yaml`); shared tooling lives at the top-level `package.json`, `eslint.config.mjs`, and prettier config via scripts.
- `packages/core`: core library logic (ESM TypeScript). Tests live alongside sources as `*.test.ts` under `src/`. Build artifacts output to `dist/` (do not hand-edit).
- `packages/cli`: executable wrapper around the core. Entry point is `src/index.ts`; `dist/index.js` is the published binary for `portmux`.
- Example workspace config is in `portmux.config.json`; adjust per environment but avoid committing secrets or machine-specific paths.

## Build, Test, and Development Commands

- `pnpm install`: install workspace dependencies (pnpm 10.x recommended).
- `pnpm build`: run TypeScript builds for all packages (tsc via `pnpm -r build`).
- `pnpm dev:cli`: run the built CLI (`packages/cli/dist/index.js`); rebuild first if sources changed.
- `pnpm test`: run all package-level tests; `pnpm --filter @portmux/core test` targets only the core Vitest suite.
- `pnpm lint` / `pnpm lint:fix`: eslint checks and auto-fixes across the repo.
- `pnpm format` / `pnpm format:check`: prettier write/check for common text and code files.

## Implementation Verification Checklist

- Run `pnpm lint`.
- Run `pnpm test`.
- Run `pnpm build`.
- Run `pnpm format`
- After every implementation change, run `pnpm format`, `pnpm lint`, `pnpm test`, and `pnpm build` before considering the work complete.
- Run `pnpm install` when dependencies were added or updated.
- Do not ask the user to run verification commands on your behalf. If you mention a command (e.g., `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm format`), you must run it yourself unless the user explicitly forbids it or sandbox restrictions prevent it. Avoid suggesting that the user “run when you have time”; either run it or explain why it could not be run.

## Coding Style & Naming Conventions

- Language: ESM TypeScript; prefer named exports for shared utilities and kebab-case filenames (e.g., `port-manager.ts`).
- Indentation: 2 spaces; keep lines focused and favor early returns.
- Tests mirror implementation names (e.g., `process-manager.test.ts` beside `process-manager.ts`).
- Run `pnpm lint` and `pnpm format:check` before pushing; JSX not expected in this repo.

## Testing Guidelines

- Framework: Vitest (configured in `packages/core/vitest.config.ts`); tests sit next to source files with `.test.ts`.
- Keep tests hermetic: avoid binding privileged ports; prefer mocks/fakes for filesystem and process state.
- Add coverage for new branches; when adding features in the CLI, add integration-style checks in core where possible to keep CLI thin.

## Commit & Pull Request Guidelines

- Commit messages follow short imperative phrases (see `git log`, e.g., “Adds process manager tests”); keep scope focused.
- Include in PRs: what changed, why, and how to reproduce (commands). Link issues when available and note any port or environment assumptions.
- Attach screenshots or examples if PR affects CLI output; otherwise paste sample command output in the description.
- Ensure `pnpm test` and `pnpm lint` are green before requesting review; mention any skipped tests or known gaps.

## Docs sync reminder

- When you add or change user-facing behavior or flags, update `README.md` to reflect the new or changed specification.
