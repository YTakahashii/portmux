# PortMux

Tired of `Error: listen EADDRINUSE: address already in use :::3000`?

PortMux is a developer-focused CLI for running and coordinating background processes. It solves the chronic problem of port conflicts in projects with multiple services, especially when working across several Git branches.

It reserves ports for your process groups before they start and **ties each reservation to a Git worktree**. When another worktree already owns a port, PortMux fails fast and tells you which one; the `select` command will stop the old worktree and start the new one so you can reuse the same ports safely.

While tools like `pm2` or `systemd` are excellent for managing production services, PortMux is purpose-built for the development inner loop, prioritizing simplicity and eliminating common frustrations.

![demo](./images/portmux-cli-demo.gif)

## Why PortMux?

PortMux is built on a few core principles to streamline the developer experience:

- **Frictionless Parallelism with Git Worktrees**: The core feature. PortMux maps process state to individual Git worktrees. Clone your repository into multiple worktrees (`git worktree add ...`), and `portmux select` will stop whichever worktree is holding the ports before starting the one you choose—no manual cleanup required.

- **Predictable by Default**: By reserving ports _before_ launching your commands, PortMux fails fast and tells you exactly which port is unavailable. This avoids the pain of one service in a group failing mid-startup because another service took its port.

- **Developer-First Simplicity**: PortMux is a lightweight, daemon-less CLI. It manages state in a transparent file-based system within `~/.config/portmux/`, giving you full control and visibility without a persistent background process to manage.

## Features

- Git worktree–aware process tracking; if another worktree already holds a port, starts fail fast and `portmux select` can hand off the running group for you
- Group-oriented process management with shared start/stop/restart flows
- Port reservation to avoid collisions before booting services
- Environment templating with `${VAR}` expansion from config or `process.env`
- Persistent state for PIDs, ports, and logs under `~/.config/portmux/`
- Git-aware group resolution so you can run commands from any subdirectory

## Prerequisites

- Node.js 20+

## Supported OS

| OS      | Status           | Notes                                                                           |
| ------- | ---------------- | ------------------------------------------------------------------------------- |
| macOS   | Supported        | Actively maintained.                                                            |
| Linux   | Not yet verified | Expected to work on modern distributions; please report compatibility findings. |
| Windows | Experimental     | Uses `wmic` for process inspection; unverified and likely incomplete.           |

## Installation

- Global install: `pnpm add -g @portmux/cli` or `npm install -g @portmux/cli` (or run ad hoc via `npx @portmux/cli`)
- From source:
  1. `pnpm install`
  2. `pnpm build`
  3. `pnpm dev:cli -- --help` to run the built CLI locally

## Quick Start

1. `portmux init` in your project root to generate `portmux.config.json` and register the repo in `~/.config/portmux/config.json` (use `--force` to overwrite). If your repo already includes `portmux.config.json` (e.g., after cloning), run `portmux sync --all` for monorepos or any project with multiple groups to register everything without prompts.
2. Edit the generated config (or review the existing one) and keep your group definitions up to date. Example:
   ```json
   {
     "$schema": "https://raw.githubusercontent.com/YTakahashii/portmux/main/packages/cli/schemas/portmux.config.schema.json",
     "groups": {
       "app": {
         "description": "Demo group",
         "commands": [
           {
             "name": "web",
             "command": "pnpm dev",
             "ports": [3000],
             "cwd": "./apps/web",
             "env": {
               "API_URL": "http://localhost:3000"
             }
           }
         ]
       }
     }
   }
   ```
3. Ensure the repository is registered in the global config with `portmux sync` (prefer `--all` for monorepos or when multiple groups exist).
4. Start everything with `portmux start`.
5. Inspect running processes with `portmux ps`.
6. Follow logs with `portmux logs <group> <process>` and stop with `portmux stop [group] [process]`.

## Usage Examples

PortMux's core value shines when you're working on multiple features at once. Here’s how you can use it with Git worktrees to switch between two versions of your app without fighting over ports.

### Switching Between Worktrees with `select` (Recommended)

The `portmux select` command is the smoothest way to switch contexts. It automatically stops processes running in the current worktree and starts them in the one you select.

1.  **Create two worktrees for different features:**

    ```bash
    # Create a worktree for feature-a
    git worktree add ../project-feature-a feature-a

    # Create another for feature-b
    git worktree add ../project-feature-b feature-b
    ```

2.  **Start working on `feature-a`:**
    You can be in any directory of your project. `portmux select` will find all associated worktrees.

    ```bash
    # Select the first worktree to start its processes
    portmux select
    # ? Select a repository: (Use arrow keys)
    # > project (feature-a) [/path/to/project-feature-a]
    #   project (main) [/path/to/project]
    #   project (feature-b) [/path/to/project-feature-b]

    # After selecting, it starts automatically
    # ▶ Starting group 'app' in worktree 'project (feature-a)'...
    # ▶ web (PID: 12345) is running...
    ```

3.  **Switch to `feature-b` without changing directories:**
    When you need to work on the other feature, just run `select` again. You don't even need to `cd`. PortMux handles stopping the old environment and starting the new one.

    ```bash
    # Still in your original directory
    portmux select
    # ? Select a repository:
    #   project (feature-a) [/path/to/project-feature-a]
    #   project (main) [/path/to/project]
    # > project (feature-b) [/path/to/project-feature-b]

    # It gracefully stops the 'feature-a' processes before starting 'feature-b'
    # ▶ Stopping processes for group 'app' in worktree 'project (feature-a)'...
    # ▶ Starting group 'app' in worktree 'project (feature-b)'...
    # ▶ web (PID: 54321) is running...
    ```

### Basic Commands

The following examples assume you have a group named `app` with a process named `web`.

```bash
# Start a configured group (auto-resolves when only one exists)
portmux start

# Start a specific group or process
portmux start app
portmux start app web

# Restart or stop
portmux restart app web
portmux stop app
# When multiple groups are running and you want to stop everything at once
portmux stop --all

# Show running state for all worktrees
portmux ps

# Tail logs (default 50 lines, follow)
portmux logs app web
portmux logs app web -n 200 --no-follow

# Choose a registered project and start from the global config
portmux select --all

# Register an existing project config into the global config
portmux sync
portmux sync --all
```

### Command Reference

- `portmux init [--force]`: Interactive setup for `portmux.config.json` and global registration.
- `portmux start [group] [process] [--all]`: Start processes with port reservation and env substitution. `--all` starts every group defined in the project config for the current worktree.
- `portmux restart [group] [process] [--all]`: Stop then start using the same resolution rules as `start`. `--all` restarts every running process in the current worktree.
- `portmux stop [group] [process] [--all] [-t, --timeout <ms>]`: Stop processes; errors when multiple groups are running unless `--all`, and `--timeout` controls the wait before SIGKILL (default: 3000 ms).
- `portmux ps`: List group, process name, status, and PID.
- `portmux select [--all]`: Pick a registered repository and run `start`; `--all` includes entries outside Git worktrees.
- `portmux sync [--all] [--group <name>] [--name <alias>] [--dry-run] [--force] [--prune]`: Register the current project config in `~/.config/portmux/config.json`. When multiple groups exist you must pass `--group <name>` or `--all`; otherwise the command exits with an error.
- `portmux logs <group> <process> [-n <lines>] [--no-follow] [-t]`: Tail logs with optional timestamps.

## Security note

- PortMux executes `command` values via your shell (e.g., to allow pipes/redirects). Use configs you trust and review shared `portmux.config.json` files before running them.

## Configuration

### Project config: `portmux.config.json`

- `$schema` (optional): Point to `node_modules/@portmux/cli/schemas/portmux.config.schema.json` for editor IntelliSense.
- `runner.mode` (optional): Currently only `background` is supported.
- `groups` (required): Object keyed by group name.
  - `description`: Group description.
  - `commands`: Array of processes.
    - `name` / `command` (required): Process name and shell command.
    - `ports` (optional): Port numbers to reserve; startup fails if a port is in use.
    - `cwd` (optional): Working directory for the process. Defaults to the project root.
    - `env` (optional): String map of environment variables; `${VAR}` expands from `env` then `process.env` (missing values warn and resolve to an empty string).

### Global config: `~/.config/portmux/config.json`

- `repositories`: Map keyed by repository alias.
  - `path`: Absolute path to the project root.
  - `group`: Group name in `portmux.config.json`.
- `logs` (optional): Global log settings applied for this user.
  - `maxBytes`: Per-user log cap in bytes (defaults to 10MB when omitted).
  - `disabled`: When true, suppresses all process log output.
- `portmux init` appends the current project; `start`/`restart`/`select` use this mapping for resolution.
- `portmux sync` is the quickest way to register a repo that already ships with `portmux.config.json` (e.g., after cloning). When only one group exists it registers that group by default; otherwise pass `--group <name>` or `--all` (and `--prune` to drop stale entries that no longer exist on disk).

### Group Resolution

- When `start`/`restart` omit the group, resolution checks the global config and Git worktree first.
- If auto-resolution fails, PortMux searches upward from the current directory for `portmux.config.json` and uses the first group definition.

### Logs and State

- `stdout`/`stderr` are written to `~/.config/portmux/logs/`; view with `portmux logs`.
- Process state, PIDs, and reserved ports persist in `~/.config/portmux/` for reuse by `ps` and `logs`.
- Log files are automatically trimmed to the newest content when they exceed 10MB by default; set a per-user cap via `logs.maxBytes` in `~/.config/portmux/config.json`.
- Trimming runs at process start and when listing processes (`portmux ps`), keeping only the tail within the configured limit.
- Disable logging globally by adding `"logs": { "disabled": true }` to `~/.config/portmux/config.json` (stdout/stderr are ignored when disabled).
- Log cleanup: `portmux stop` removes the associated log file, and `portmux ps` prunes log files not referenced by any recorded process state. No separate prune command is required.

## Troubleshooting

### `portmux start` / `restart` fails with a global-config error

Run `portmux sync --all` (or `--group <name>` for a single group) in the repo so it registers in `~/.config/portmux/config.json`.

### `portmux select` shows “No selectable groups”

The repository is not registered. Run `portmux sync --all` in the worktree you want to use.

### “The repository for this git worktree is not defined in the global config”

Run `portmux sync --all` in that worktree to register it.

### Port is already reserved / start fails mid-way

Use `portmux select` to hand off to the active worktree, or `portmux stop --all` to clear running groups, then retry.

### Config not found

Ensure `portmux.config.json` exists in the project root (re-run `portmux init` if needed).

## Uninstall

To remove PortMux from your system, first uninstall the global package:

- **Using pnpm:**
  ```bash
  pnpm remove -g @portmux/cli
  ```
- **Using npm:**
  ```bash
  npm uninstall -g @portmux/cli
  ```

This will remove the `portmux` command. To completely remove all associated data (including repository history, logs, and process state), delete the configuration directory:

```bash
rm -rf ~/.config/portmux
```

> **Warning:** This action is irreversible and will delete all PortMux settings and log files.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for development setup, verification commands, and contribution guidelines.
