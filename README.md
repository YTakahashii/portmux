# PortMux

Tired of `Error: listen EADDRINUSE: address already in use :::3000`?

PortMux is a developer-focused CLI for running and coordinating background processes. It solves the chronic problem of port conflicts in projects with multiple services, especially when working across several Git branches.

It reserves ports for your process groups before they start, and **automatically isolates port reservations for each Git worktree**. This means you can run the same application stack on different branches simultaneously without collisions—perfect for parallel feature development, running review environments, or powering agentic coding workflows.

While tools like `pm2` or `systemd` are excellent for managing production services, PortMux is purpose-built for the development inner loop, prioritizing simplicity and eliminating common frustrations.

## Why PortMux?

PortMux is built on a few core principles to streamline the developer experience:

- **Frictionless Parallelism with Git Worktrees**: The core feature. PortMux maps port reservations to individual Git worktrees. Clone your repository into multiple worktrees (`git worktree add ...`), and `portmux` will handle the rest. Never again will you have to stop one server just to test another branch.

- **Predictable by Default**: By reserving ports *before* launching your commands, PortMux fails fast and tells you exactly which port is unavailable. This avoids the pain of one service in a group failing mid-startup because another service took its port.

- **Developer-First Simplicity**: PortMux is a lightweight, daemon-less CLI. It manages state in a transparent file-based system within `~/.config/portmux/`, giving you full control and visibility without a persistent background process to manage.

## Features

- Git worktree–aware port isolation so each checkout can reuse the same port set without collisions
- Group-oriented process management with shared start/stop/restart flows
- Port reservation to avoid collisions before booting services
- Environment templating with `${VAR}` expansion from config or `process.env`
- Persistent state for PIDs, ports, and logs under `~/.config/portmux/`
- Git-aware group resolution so you can run commands from any subdirectory

## Prerequisites

- Node.js 18+
- pnpm 10.x (recommended)

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

1. `portmux init` in your project root to generate `portmux.config.json` and register the repo in `~/.config/portmux/config.json` (use `--force` to overwrite).
2. Edit the generated config. Example:
   ```json
   {
     "$schema": "node_modules/@portmux/cli/schemas/portmux.config.schema.json",
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
3. Start everything with `portmux start`.
4. Inspect running processes with `portmux ps`.
5. Follow logs with `portmux logs <group> <process>` and stop with `portmux stop [group] [process]`.

## Usage Examples

Multiple Git worktrees can run the same ports concurrently—PortMux scopes reservations by worktree so clones do not collide.

```bash
# Start a configured group (auto-resolves when only one exists)
portmux start

# Start a specific group or process
portmux start app
portmux start app web

# Restart or stop
portmux restart app web
portmux stop app

# Show running state
portmux ps

# Tail logs (default 50 lines, follow)
portmux logs app web
portmux logs app web -n 200 --no-follow

# Choose a registered project and start from the global config
portmux select --all
```

### Command Reference

- `portmux init [--force]`: Interactive setup for `portmux.config.json` and global registration.
- `portmux start [group] [process]`: Start processes with port reservation and env substitution.
- `portmux restart [group] [process]`: Stop then start using the same resolution rules as `start`.
- `portmux stop [group] [process]`: Stop processes; prompts when multiple groups are running.
- `portmux ps`: List group, process name, status, and PID.
- `portmux select [--all]`: Pick a registered repository and run `start`; `--all` includes entries outside Git worktrees.
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
- `portmux init` appends the current project; `start`/`restart`/`select` use this mapping for resolution.

### Group Resolution

- When `start`/`restart` omit the group, resolution checks the global config and Git worktree first.
- If auto-resolution fails, PortMux searches upward from the current directory for `portmux.config.json` and uses the first group definition.

### Logs and State

- `stdout`/`stderr` are written to `~/.config/portmux/logs/`; view with `portmux logs`.
- Process state, PIDs, and reserved ports persist in `~/.config/portmux/` for reuse by `ps` and `logs`.
- Log cleanup: `portmux stop` removes the associated log file, and `portmux ps` prunes log files not referenced by any recorded process state. No separate prune command is required.

## Development

- Install dependencies: `pnpm install`
- Format: `pnpm format` / `pnpm format:check`
- Lint: `pnpm lint`
- Test: `pnpm test`
- Build: `pnpm build`
- Run CLI locally: `pnpm dev:cli -- --help`
- Behavior changes: run `pnpm changeset` and commit the generated entry.

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
