# @portmux/core

## 0.1.1

### Patch Changes

- [#5](https://github.com/YTakahashii/portmux/pull/5) [`3616ca1`](https://github.com/YTakahashii/portmux/commit/3616ca155635b66cb14afe685907246903ad5c7f) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Refresh stop logic so we can detect and kill exec'ed processes such as Ruby on Rails servers by capturing their true command line at start and refreshing it when verifying PIDs.

## 0.1.0

### Minor Changes

- [#2](https://github.com/YTakahashii/portmux/pull/2) [`c012159`](https://github.com/YTakahashii/portmux/commit/c0121595b44d412855b36fe0d5dd2e872d6aed09) Thanks [@YTakahashii](https://github.com/YTakahashii)! - Add git worktree aware selection plus per-worktree instance tracking so multiple checkouts can be started independently.
