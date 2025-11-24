# @portmux/cli

## 0.2.0

### Minor Changes

- [#21](https://github.com/YTakahashii/portmux/pull/21) [`cbbad65`](https://github.com/YTakahashii/portmux/commit/cbbad65e19c4c71c7300858739f752c7d6c03fee) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Add `portmux sync` to register existing project configs into the global config, including docs and tests.

### Patch Changes

- Updated dependencies [[`998efca`](https://github.com/YTakahashii/portmux/commit/998efcadddefeb006f4c73d368900f9e144eb51d)]:
  - @portmux/core@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [[`6859e85`](https://github.com/YTakahashii/portmux/commit/6859e85893c3b2dad74fbecc37a1f9cb0e7ff657)]:
  - @portmux/core@0.1.3

## 0.1.2

### Patch Changes

- [#9](https://github.com/YTakahashii/portmux/pull/9) [`d378442`](https://github.com/YTakahashii/portmux/commit/d378442e2e6b29b4779da030353778d9ba341956) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Harden log path validation and tighten permissions for state and log storage

- [#7](https://github.com/YTakahashii/portmux/pull/7) [`2b95ae3`](https://github.com/YTakahashii/portmux/commit/2b95ae3b65a86b0d0df56f99ce739841eba57d25) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Use the published package version for the CLI version output and expose it via `-v`/`--version`.

- [#13](https://github.com/YTakahashii/portmux/pull/13) [`77e123c`](https://github.com/YTakahashii/portmux/commit/77e123cf721c19dd390b3bf9bfdb68c3031fa1b8) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Prune orphaned log files when listing processes and document the automatic log cleanup behavior.

- [`1428351`](https://github.com/YTakahashii/portmux/commit/14283516e8a84dd5d11541c23ce5f90fb8081a66) Thanks [@YTakahashii](https://github.com/YTakahashii)! - - Stop running processes in other worktrees when selecting a new worktree via `portmux select`, reducing manual stop steps.

- Updated dependencies [[`d378442`](https://github.com/YTakahashii/portmux/commit/d378442e2e6b29b4779da030353778d9ba341956), [`77e123c`](https://github.com/YTakahashii/portmux/commit/77e123cf721c19dd390b3bf9bfdb68c3031fa1b8)]:
  - @portmux/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [[`3616ca1`](https://github.com/YTakahashii/portmux/commit/3616ca155635b66cb14afe685907246903ad5c7f)]:
  - @portmux/core@0.1.1

## 0.1.0

### Minor Changes

- [#2](https://github.com/YTakahashii/portmux/pull/2) [`c012159`](https://github.com/YTakahashii/portmux/commit/c0121595b44d412855b36fe0d5dd2e872d6aed09) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Add git worktree aware selection plus per-worktree instance tracking so multiple checkouts can be started independently.

### Patch Changes

- Updated dependencies [[`c012159`](https://github.com/YTakahashii/portmux/commit/c0121595b44d412855b36fe0d5dd2e872d6aed09)]:
  - @portmux/core@0.1.0
