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

export async function runStopCommand(groupName?: string, processName?: string): Promise<void> {
  try {
    const allStates = StateManager.listAllStates();

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

      // Error if multiple groups are running
      if (groups.size > 1) {
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

      groupName = Array.from(groups.keys())[0];
    }

    let matchingStates: ProcessState[] = [];
    if (groupName) {
      matchingStates = filterStatesByIdentifier(allStates, groupName);
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
            await ProcessManager.stopProcess(state.group, state.process);

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
    .action(async (groupName?: string, processName?: string) => {
      await runStopCommand(groupName, processName);
    });
}
