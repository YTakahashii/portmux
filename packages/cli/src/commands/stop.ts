import { LockManager, LockTimeoutError, ProcessManager, ProcessStopError, StateManager } from '@portmux/core';

import { Command } from 'commander';
import chalk from 'chalk';

export const stopCommand: ReturnType<typeof createStopCommand> = createStopCommand();

export async function runStopCommand(groupName?: string, processName?: string): Promise<void> {
  try {
    // When no group name is provided, read every process from the state store
    if (!groupName) {
      const allStates = StateManager.listAllStates();
      const groups = new Set(allStates.map((s) => s.group));

      if (groups.size === 0) {
        console.log(chalk.yellow('No processes to stop'));
        return;
      }

      // Error if multiple groups are running
      if (groups.size > 1) {
        console.error(chalk.red('Error: Multiple groups are running. Please specify a group name.'));
        process.exit(1);
        return;
      }

      groupName = Array.from(groups)[0];
    }

    // Determine which processes should be stopped
    const allStates = StateManager.listAllStates();
    const processesToStop = processName
      ? allStates.filter((s) => s.group === groupName && s.process === processName)
      : allStates.filter((s) => s.group === groupName);

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

    // Acquire a lock and stop each process
    await LockManager.withLock('group', groupName ?? null, async () => {
      for (const state of processesToStop) {
        try {
          await ProcessManager.stopProcess(state.group, state.process);

          console.log(chalk.green(`✓ Stopped process "${state.process}"`));
        } catch (error) {
          if (error instanceof ProcessStopError) {
            console.error(chalk.red(`Error: Failed to stop process "${state.process}": ${error.message}`));
          } else {
            throw error;
          }
        }
      }
    });
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
