import {
  LockManager,
  LockTimeoutError,
  ProcessManager,
  ProcessStopError,
  StateManager,
  type ProcessState,
} from '@portmux/core';

import { Command } from 'commander';
import { chalk } from '../lib/chalk.js';

export const stopCommand: ReturnType<typeof createStopCommand> = createStopCommand();

interface RunStopOptions {
  timeout?: number;
  stopAll?: boolean;
}

function formatStateLabel(state: ProcessState): string {
  const label = state.groupLabel ?? state.repositoryName ?? state.group;
  const path = state.worktreePath ?? state.groupKey;
  if (path) {
    return `${label} (${path})`;
  }
  return label;
}

function filterStatesByIdentifier(states: ProcessState[], identifier: string): ProcessState[] {
  const directMatches = states.filter((state) => state.group === identifier || state.groupLabel === identifier);
  if (directMatches.length > 0) {
    return directMatches;
  }

  const repositoryMatches = states.filter((state) => state.repositoryName === identifier);
  if (repositoryMatches.length > 0) {
    return repositoryMatches;
  }

  const groupMatches = states.filter((state) => state.groupDefinitionName === identifier);
  if (groupMatches.length > 0) {
    return groupMatches;
  }

  const pathMatches = states.filter((state) => state.worktreePath === identifier || state.groupKey === identifier);
  if (pathMatches.length > 0) {
    return pathMatches;
  }

  return [];
}

export async function runStopCommand(
  groupName?: string,
  processName?: string,
  options: RunStopOptions = {}
): Promise<void> {
  try {
    const allStates = StateManager.listAllStates();
    const stopTimeout = options.timeout;
    const stopAll = options.stopAll === true;

    // When no group name is provided, read every process from the state store
    if (!groupName) {
      const groups = new Map<string, ProcessState>();
      for (const state of allStates) {
        if (!groups.has(state.group)) {
          groups.set(state.group, state);
        }
      }

      if (groups.size === 0) {
        console.log(chalk.yellow('No processes to stop'));
        return;
      }

      // Error if multiple groups are running unless explicitly stopping all
      if (groups.size > 1 && !stopAll) {
        console.error(chalk.red('Error: Multiple groups are running. Please specify a group name.'));
        console.error(
          chalk.red(
            `Available groups:\n${Array.from(groups.values())
              .map((state) => `  - ${formatStateLabel(state)} [${state.group}]`)
              .join('\n')}`
          )
        );
        process.exit(1);
        return;
      }

      const targets = stopAll ? Array.from(groups.keys()) : [...groups.keys()].slice(0, 1);
      const aggregatedStates: ProcessState[] = [];

      for (const target of targets) {
        const matching = filterStatesByIdentifier(allStates, target);
        if (matching.length === 0) {
          console.log(chalk.yellow(`No running processes found for group "${target}"`));
          continue;
        }
        aggregatedStates.push(...matching);
      }

      if (aggregatedStates.length === 0) {
        return;
      }

      allStates.length = 0;
      allStates.push(...aggregatedStates);
      groupName = targets.length === 1 ? targets[0] : undefined;
    }

    let matchingStates: ProcessState[] = [];
    if (groupName) {
      matchingStates = filterStatesByIdentifier(allStates, groupName);
    } else {
      matchingStates = allStates;
    }

    if (matchingStates.length === 0) {
      console.log(chalk.yellow(`No running processes found for group "${groupName ?? 'unknown'}"`));
      return;
    }

    // Determine which processes should be stopped
    const processesToStop = processName ? matchingStates.filter((s) => s.process === processName) : matchingStates;

    if (processesToStop.length === 0) {
      console.log(
        chalk.yellow(
          processName
            ? `Process "${processName}" is not running`
            : `No running processes found in group "${groupName ?? 'unknown'}"`
        )
      );
      return;
    }

    const groupedStates = new Map<string, ProcessState[]>();
    for (const state of processesToStop) {
      if (!groupedStates.has(state.group)) {
        groupedStates.set(state.group, []);
      }
      groupedStates.get(state.group)?.push(state);
    }

    // Acquire a lock and stop each process per group
    for (const [groupId, states] of groupedStates.entries()) {
      await LockManager.withLock('group', groupId, async () => {
        for (const state of states) {
          try {
            await ProcessManager.stopProcess(state.group, state.process, stopTimeout);

            console.log(chalk.green(`✓ Stopped process "${state.process}" (${formatStateLabel(state)})`));
          } catch (error) {
            if (error instanceof ProcessStopError) {
              console.error(chalk.red(`Error: Failed to stop process "${state.process}": ${error.message}`));
            } else {
              throw error;
            }
          }
        }
      });
    }
  } catch (error) {
    if (error instanceof LockTimeoutError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    } else {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  }
}

function createStopCommand(): Command {
  return new Command('stop')
    .description('Stop processes')
    .argument('[group-name]', 'Group name')
    .argument('[process-name]', 'Process name (stops all processes in the group when omitted)')
    .option('-t, --timeout <ms>', 'Timeout in milliseconds before force stop (default: 3000)')
    .option('--all', 'Stop all running groups')
    .action(async (groupName?: string, processName?: string, options?: { timeout?: string; all?: boolean }) => {
      let timeout: number | undefined;
      if (options?.timeout !== undefined) {
        const parsed = Number.parseInt(options.timeout, 10);
        if (Number.isNaN(parsed) || parsed < 0) {
          console.error(chalk.red('Error: Timeout must be a non-negative integer (milliseconds).'));
          process.exit(1);
          return;
        }
        timeout = parsed;
      }

      const stopOptions: RunStopOptions = {};
      if (timeout !== undefined) {
        stopOptions.timeout = timeout;
      }
      if (options?.all === true) {
        stopOptions.stopAll = true;
      }

      await runStopCommand(groupName, processName, stopOptions);
    });
}
