# @portmux/cli

## 0.8.0

### Minor Changes

- [#54](https://github.com/YTakahashii/portmux/pull/54) [`0ed20ee`](https://github.com/YTakahashii/portmux/commit/0ed20eeae0e2b232db25d21d1102aff78bf28785) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Add support for resolving port values from environment variable placeholders in config, updating schema validation and CLI start/restart handling.

### Patch Changes

- Updated dependencies [[`0ed20ee`](https://github.com/YTakahashii/portmux/commit/0ed20eeae0e2b232db25d21d1102aff78bf28785)]:
  - @portmux/core@0.4.0

## 0.7.0

### Minor Changes

- [#48](https://github.com/YTakahashii/portmux/pull/48) [`f71c6b8`](https://github.com/YTakahashii/portmux/commit/f71c6b8189e31cf77cb2a1e8bdad58506e96efb2) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Add support for tilde-expansion in global config paths and have `portmux sync` write paths with `~` by default.

### Patch Changes

- Updated dependencies [[`f71c6b8`](https://github.com/YTakahashii/portmux/commit/f71c6b8189e31cf77cb2a1e8bdad58506e96efb2)]:
  - @portmux/core@0.3.0

## 0.6.4

### Patch Changes

- [#45](https://github.com/YTakahashii/portmux/pull/45) [`59a7911`](https://github.com/YTakahashii/portmux/commit/59a79118d42b26d0a7259ca6435f7fbeecfaefc3) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Add repository label and worktree path to start logs for parity with stop output.

## 0.6.3

### Patch Changes

- [#42](https://github.com/YTakahashii/portmux/pull/42) [`5fe4ccb`](https://github.com/YTakahashii/portmux/commit/5fe4ccbda2990dfc1c04903c80a952826d658cc5) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Remove repository path from the `ps` table output while keeping paths in the summary lines.

## 0.6.2

### Patch Changes

- [#40](https://github.com/YTakahashii/portmux/pull/40) [`2c7e0d2`](https://github.com/YTakahashii/portmux/commit/2c7e0d271f603e7fa5c020f42c82a5b601ffe53b) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Write process logs directly to file descriptors and trim only at boundaries to avoid hanging `portmux select`, move the log size cap to global config for per-user control, and add a global `logs.disabled` switch to skip log output entirely.

- Updated dependencies [[`2c7e0d2`](https://github.com/YTakahashii/portmux/commit/2c7e0d271f603e7fa5c020f42c82a5b601ffe53b)]:
  - @portmux/core@0.2.2

## 0.6.1

### Patch Changes

- [#38](https://github.com/YTakahashii/portmux/pull/38) [`178182a`](https://github.com/YTakahashii/portmux/commit/178182a4684ad7d7fb3b8b9f1ccf30fc31190ae8) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Write process logs directly to file descriptors again and trim at boundaries to avoid `portmux select` hanging from open stdout/stderr pipes.

- Updated dependencies [[`178182a`](https://github.com/YTakahashii/portmux/commit/178182a4684ad7d7fb3b8b9f1ccf30fc31190ae8)]:
  - @portmux/core@0.2.1

## 0.6.0

### Minor Changes

- [#36](https://github.com/YTakahashii/portmux/pull/36) [`93d6075`](https://github.com/YTakahashii/portmux/commit/93d6075b175acb6af233131fe3262fe8174b2739) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Add configurable log size cap (default 10MB) with automatic trimming to keep the newest output.

### Patch Changes

- Updated dependencies [[`93d6075`](https://github.com/YTakahashii/portmux/commit/93d6075b175acb6af233131fe3262fe8174b2739)]:
  - @portmux/core@0.2.0

## 0.5.0

### Minor Changes

- [#33](https://github.com/YTakahashii/portmux/pull/33) [`aefa2d1`](https://github.com/YTakahashii/portmux/commit/aefa2d16d47c74df3a4d47bc5b91abee38c0a280) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Remove the start fallback that bypassed global config and instruct users to run `portmux sync` when repository resolution fails to avoid duplicate starts.

### Patch Changes

- [#35](https://github.com/YTakahashii/portmux/pull/35) [`3210bbe`](https://github.com/YTakahashii/portmux/commit/3210bbe36be2bfcf08afba1246591004b836d6ba) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Shorten home directory paths to `~` in CLI outputs

## 0.4.0

### Minor Changes

- [#31](https://github.com/YTakahashii/portmux/pull/31) [`45eefb7`](https://github.com/YTakahashii/portmux/commit/45eefb7e062f5b7ad40b152463a8169bc16138f5) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Add `--all` option to `start` to launch every group in the project config and to `restart` to restart all running processes in the current worktree.

### Patch Changes

- [#30](https://github.com/YTakahashii/portmux/pull/30) [`5551cf1`](https://github.com/YTakahashii/portmux/commit/5551cf16e198544ebcd5fe914fab63399b4d7ce4) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Ensure `portmux select` only starts the chosen group when no other worktrees are running.

## 0.3.0

### Minor Changes

- [#28](https://github.com/YTakahashii/portmux/pull/28) [`9e9ac68`](https://github.com/YTakahashii/portmux/commit/9e9ac6893d88f08bfc8344dd38578e7d900f1151) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Add `stop --all` to stop every running group without specifying a group name when multiple groups are active.

### Patch Changes

- [#29](https://github.com/YTakahashii/portmux/pull/29) [`9f56b40`](https://github.com/YTakahashii/portmux/commit/9f56b4043903138d1eee470448633ca2ac9e072f) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Add sync guidance when the global config is missing and highlight `portmux sync --all` for multi-group projects.

- [#26](https://github.com/YTakahashii/portmux/pull/26) [`f6ec3aa`](https://github.com/YTakahashii/portmux/commit/f6ec3aa2a9befac4b8344bf5af5d3fa43142ffed) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Ensure `portmux select` stops other worktrees for the same repository and restarts every running group definition in the newly selected worktree.

- Updated dependencies [[`9f56b40`](https://github.com/YTakahashii/portmux/commit/9f56b4043903138d1eee470448633ca2ac9e072f)]:
  - @portmux/core@0.1.6

## 0.2.1

### Patch Changes

- [#23](https://github.com/YTakahashii/portmux/pull/23) [`035c796`](https://github.com/YTakahashii/portmux/commit/035c796ced9c1b922889e857252435177d0f264c) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Shorten stop timeout to 3 seconds by default and allow configuring the stop timeout from the CLI flag.

- Updated dependencies [[`035c796`](https://github.com/YTakahashii/portmux/commit/035c796ced9c1b922889e857252435177d0f264c)]:
  - @portmux/core@0.1.5

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
