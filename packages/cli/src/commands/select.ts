import { GroupManager, StateManager, type GroupSelection } from '@portmux/core';
import { Command } from 'commander';
import chalk from 'chalk';
import inquirer, { type ChoiceCollection } from 'inquirer';
import { runStartCommand } from './start.js';
import { runStopCommand } from './stop.js';

interface SelectOptions {
  all?: boolean;
}

interface GroupAnswer {
  repositoryName: string;
  worktreePath: string;
  branchLabel?: string;
}

interface RunningWorktree {
  groupId: string;
  worktreePath?: string;
  branch?: string;
  groupLabel?: string;
}

function buildChoices(selections: GroupSelection[]): ChoiceCollection<GroupAnswer> {
  const choices: ChoiceCollection<GroupAnswer> = [];
  let currentRepository: string | null = null;

  for (const selection of selections) {
    if (currentRepository !== selection.repositoryName) {
      currentRepository = selection.repositoryName;
      choices.push(new inquirer.Separator(`--- ${selection.repositoryName} ---`));
    }

    const runningLabel = selection.isRunning ? '[Running] ' : '';
    const branchLabel = selection.branchLabel ? `:${selection.branchLabel}` : '';
    const configSuffix = selection.hasConfig ? '' : ' [Missing config]';
    const choice = {
      name: `${runningLabel}${selection.repositoryName}${branchLabel} (${selection.worktreePath})${configSuffix}`,
      short: `${selection.repositoryName}${branchLabel}`,
      value: {
        repositoryName: selection.repositoryName,
        worktreePath: selection.worktreePath,
        branchLabel: selection.branchLabel,
      },
      ...(selection.hasConfig ? {} : { disabled: 'Missing portmux.config.json' }),
    };
    choices.push(choice);
  }

  return choices;
}

function findRunningWorktrees(repositoryName: string, targetWorktreePath: string): RunningWorktree[] {
  const states = StateManager.listAllStates();
  const running = new Map<string, RunningWorktree>();

  for (const state of states) {
    if (state.status !== 'Running') {
      continue;
    }
    if (state.repositoryName !== repositoryName) {
      continue;
    }

    const worktreePath = state.worktreePath ?? state.groupKey;
    if (!worktreePath || worktreePath === targetWorktreePath) {
      continue;
    }

    if (!running.has(state.group)) {
      const worktree: RunningWorktree = {
        groupId: state.group,
        worktreePath,
      };
      if (state.branch !== undefined) {
        worktree.branch = state.branch;
      }
      if (state.groupLabel !== undefined) {
        worktree.groupLabel = state.groupLabel;
      }
      running.set(state.group, worktree);
    }
  }

  return Array.from(running.values());
}

function formatRunningWorktreeLabel(worktree: RunningWorktree): string {
  const pathLabel = worktree.worktreePath ?? 'unknown worktree';
  if (worktree.branch) {
    return `${pathLabel} [${worktree.branch}]`;
  }
  if (worktree.groupLabel) {
    return `${pathLabel} [${worktree.groupLabel}]`;
  }
  return pathLabel;
}

export const selectCommand: ReturnType<typeof createSelectCommand> = createSelectCommand();

function createSelectCommand(): Command {
  return new Command('select')
    .description('Select a group and start its processes')
    .option('--all', 'Show all groups, including those outside git worktrees')
    .action(async (options: SelectOptions) => {
      try {
        const includeAll = options.all === true;
        const selections = GroupManager.buildSelectableGroups({ includeAll });

        if (selections.length === 0) {
          console.log(chalk.yellow('No selectable groups. Please check your global config.'));
          return;
        }

        const choices = buildChoices(selections);
        const { group } = await inquirer.prompt<{ group: GroupAnswer }>([
          {
            type: 'list',
            name: 'group',
            message: 'Select a group to start',
            choices,
          },
        ]);

        const runningWorktrees = findRunningWorktrees(group.repositoryName, group.worktreePath);
        for (const running of runningWorktrees) {
          console.log(chalk.yellow(`Stopping running worktree: ${formatRunningWorktreeLabel(running)}`));
          await runStopCommand(running.groupId);
        }

        const startOptions: { worktreePath?: string; worktreeLabel?: string } = {
          worktreePath: group.worktreePath,
        };
        if (group.branchLabel !== undefined) {
          startOptions.worktreeLabel = group.branchLabel;
        }

        await runStartCommand(group.repositoryName, undefined, startOptions);
      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
      }
    });
}
