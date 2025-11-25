# @portmux/core

## 0.1.6

### Patch Changes

- [#29](https://github.com/YTakahashii/portmux/pull/29) [`9f56b40`](https://github.com/YTakahashii/portmux/commit/9f56b4043903138d1eee470448633ca2ac9e072f) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Add sync guidance when the global config is missing and highlight `portmux sync --all` for multi-group projects.

## 0.1.5

### Patch Changes

- [#23](https://github.com/YTakahashii/portmux/pull/23) [`035c796`](https://github.com/YTakahashii/portmux/commit/035c796ced9c1b922889e857252435177d0f264c) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Shorten stop timeout to 3 seconds by default and allow configuring the stop timeout from the CLI flag.

## 0.1.4

### Patch Changes

- [#20](https://github.com/YTakahashii/portmux/pull/20) [`998efca`](https://github.com/YTakahashii/portmux/commit/998efcadddefeb006f4c73d368900f9e144eb51d) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Prioritize the current git repository when building selectable groups for `portmux select`.

## 0.1.3

### Patch Changes

- [#18](https://github.com/YTakahashii/portmux/pull/18) [`6859e85`](https://github.com/YTakahashii/portmux/commit/6859e85893c3b2dad74fbecc37a1f9cb0e7ff657) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Fix validation of the global config during init so only entries targeting the current project are checked.

## 0.1.2

### Patch Changes

- [#9](https://github.com/YTakahashii/portmux/pull/9) [`d378442`](https://github.com/YTakahashii/portmux/commit/d378442e2e6b29b4779da030353778d9ba341956) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Harden log path validation and tighten permissions for state and log storage

- [#13](https://github.com/YTakahashii/portmux/pull/13) [`77e123c`](https://github.com/YTakahashii/portmux/commit/77e123cf721c19dd390b3bf9bfdb68c3031fa1b8) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Prune orphaned log files when listing processes and document the automatic log cleanup behavior.

## 0.1.1

### Patch Changes

- [#5](https://github.com/YTakahashii/portmux/pull/5) [`3616ca1`](https://github.com/YTakahashii/portmux/commit/3616ca155635b66cb14afe685907246903ad5c7f) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Refresh stop logic so we can detect and kill exec'ed processes such as Ruby on Rails servers by capturing their true command line at start and refreshing it when verifying PIDs.

## 0.1.0

### Minor Changes

- [#2](https://github.com/YTakahashii/portmux/pull/2) [`c012159`](https://github.com/YTakahashii/portmux/commit/c0121595b44d412855b36fe0d5dd2e872d6aed09) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Add git worktree aware selection plus per-worktree instance tracking so multiple checkouts can be started independently.
