# Contributing to PortMux

Thanks for your interest in improving PortMux! This guide outlines the development workflow and expectations for contributions.

## Repository Layout

- `packages/core`: Core library (ESM TypeScript). Tests live next to sources as `*.test.ts` under `src/`.
- `packages/cli`: CLI wrapper for the core library. Entry point is `src/index.ts`; `dist/index.js` is the published binary.
- Shared tooling (lint, prettier, scripts) lives at the repo root via pnpm workspaces.

## Prerequisites

- Node.js 24+
- pnpm 10.x

### Setup

1. Install dependencies: `pnpm install`
2. Build TypeScript outputs: `pnpm build` (or `pnpm -r build` for workspace builds)
3. Run the CLI locally after building: `pnpm dev:cli -- --help`

### Verification Commands

Run these after code changes and before opening a PR:

- Format: `pnpm format`
- Lint: `pnpm lint`
- Test: `pnpm test` (or `pnpm --filter @portmux/core test` for core only)
- Build: `pnpm build`

### Development Notes

- Behavior or user-facing changes should include an entry via `pnpm changeset`.
- Keep tests hermetic; avoid privileged ports and prefer mocks/fakes for filesystem and process state.
- Use kebab-case filenames and named exports for shared utilities. Favor early returns and concise logic.
- Update `README.md` when adding or changing CLI flags or user-facing behavior.
