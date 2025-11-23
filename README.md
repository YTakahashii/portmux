# PortMux

PortMux is a CLI that keeps background process groups predictable: reserve ports up front, start and restart together, and keep logs and state in one place. It automatically isolates port reservations per Git worktree, so you can spin up multiple clones of the same repo—ideal for agentic coding workflows—without fighting over the same dev ports.

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

## Development

- Install dependencies: `pnpm install`
- Format: `pnpm format` / `pnpm format:check`
- Lint: `pnpm lint`
- Test: `pnpm test`
- Build: `pnpm build`
- Run CLI locally: `pnpm dev:cli -- --help`
- Behavior changes: run `pnpm changeset` and commit the generated entry.
