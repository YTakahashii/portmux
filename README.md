# PortMux

PortMux is a CLI for running multiple group processes in the background while keeping port reservations, logs, and process state simple. You describe processes in a config file, then start, stop, or restart them together with consistent port handling.

## Install

- Global install (recommended): `pnpm add -g @portmux/cli` or `npm install -g @portmux/cli`, then use the `portmux` command (you can also run it via `npx @portmux/cli`).
- From this repository:
  1. `pnpm install`
  2. `pnpm build`
  3. `pnpm dev:cli -- --help` to run the built CLI

## Quickstart

1. Run `portmux init` in your project root to generate `portmux.config.json` and update the global config (use `--force` to overwrite).
2. Edit the generated config or add commands. Example:
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
3. Start processes with `portmux start` (target a single process by name if needed).
4. Check running status with `portmux ps`, and tail logs with `portmux logs <group> <process>`.
5. Stop with `portmux stop [group] [process]`, or restart with `portmux restart [group] [process]`.

## Command Reference

- `portmux init [--force]`  
  Interactive generation of `portmux.config.json`, plus appending the repository entry to `~/.config/portmux/config.json`. Use `--force` to overwrite existing entries.
- `portmux start [group-name] [process-name]`  
  Starts processes in the target group (auto-resolves when omitted). Handles port reservations and environment variable substitution; starts all configured processes if no process is specified.
- `portmux restart [group-name] [process-name]`  
  Stops then restarts target processes, using the same group resolution rules as `start`.
- `portmux stop [group-name] [process-name]`  
  Stops processes. When the group is omitted, the running group is auto-selected; if multiple are running, an error prompts you to specify one.
- `portmux ps`  
  Lists current process states including group key, process name, status, and PID.
- `portmux select [--all]`  
  Lists selectable groups from the global config and runs `start` for the chosen entry. `--all` also shows non–Git worktree entries.
- `portmux logs <group-name> <process-name> [-n <lines>] [--no-follow] [-t]`  
  Shows logs for a process. Default tail is 50 lines; `--no-follow` disables streaming; `-t` prefixes lines with timestamps.

## Configuration Reference

### Project config: `portmux.config.json`

- `$schema` (optional): Point to `node_modules/@portmux/cli/schemas/portmux.config.schema.json` for editor IntelliSense.
- `runner.mode` (optional): Currently only `background` is supported.
- `groups` (required): Object keyed by group name.
  - `description`: Group description.
  - `commands`: Array of processes to run.
    - `name` / `command` (required): Process name and shell command.
    - `ports` (optional): Array of port numbers to reserve. Startup fails if a port is already in use.
    - `cwd` (optional): Working directory for the process. Defaults to the project root.
    - `env` (optional): String map of environment variables. `${VAR}` expands using `env` first, then `process.env` (missing vars are warned and replaced with an empty string).

### Global config: `~/.config/portmux/config.json`

- `repositories`: Map keyed by repository alias.
  - `path`: Absolute path to the project root.
  - `group`: Group name in `portmux.config.json`.
- Running `portmux init` registers the current project. `start`/`restart`/`select` use this mapping to resolve groups by name.

### Group Resolution

- When `start`/`restart` omit the group, resolution checks the global config and Git worktree info first.
- If auto-resolution fails, PortMux searches upward from the current directory for `portmux.config.json` and uses the first group definition in that file.

### Logs and State

- `stdout`/`stderr` are written to files under `~/.config/portmux/logs/`. Use `portmux logs` to view them.
- Process states, PIDs, and reserved ports are stored in a persistent state store and read by `ps` and `logs`.

## Release Workflow

- Every feature or bug-fix PR that modifies behavior must run `pnpm changeset` and commit the generated markdown. Those entries accumulate on `main`.
- The `Release` workflow (`.github/workflows/release.yml`) runs on every push to `main`. If there are pending changesets, `changesets/action@v1` opens/updates a “chore: release packages” PR against `main`. When no pending changesets remain (i.e., the release PR has been merged), the same workflow detects `hasChangesets == false` and continues to run `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm changeset publish`, and `git push --follow-tags`.
- Repository settings → Actions → General → Workflow permissions must enable “Allow GitHub Actions to create and approve pull requests” so the Release workflow can open PRs.
- npm Trusted Publishing is enabled. Link this GitHub repo to the `@portmux` org on npm so the workflow can publish without an `NPM_TOKEN`. The default `GITHUB_TOKEN` (with `contents: write`) pushes release tags.
