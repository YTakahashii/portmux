import { GroupManager, StateManager, type GroupSelection } from '@portmux/core';
import { Command } from 'commander';
import { chalk } from '../lib/chalk.js';
import inquirer, { type ChoiceCollection } from 'inquirer';
import { runStartCommand } from './start.js';
import { runStopCommand } from './stop.js';
import { resolve } from 'path';

function normalizePath(path: string): string {
  try {
    return resolve(path);
  } catch {
    return path;
  }
}

interface SelectOptions {
  all?: boolean;
}

interface GroupAnswer {
  repositoryName: string;
  worktreePath: string;
  branchLabel?: string;
  repositoryPath: string;
}

interface RunningWorktree {
  groupId: string;
  worktreePath?: string;
  branch?: string;
  groupLabel?: string;
  groupDefinitionName?: string;
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
        repositoryPath: selection.repositoryPath,
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
  const normalizedTarget = normalizePath(targetWorktreePath);

  for (const state of states) {
    if (state.status !== 'Running') {
      continue;
    }
    if (state.repositoryName !== repositoryName) {
      continue;
    }

    const worktreePath = state.worktreePath ?? state.groupKey;
    if (!worktreePath || normalizePath(worktreePath) === normalizedTarget) {
      continue;
    }

    if (!running.has(state.group)) {
      const worktree: RunningWorktree = {
        groupId: state.group,
        worktreePath,
        ...(state.groupDefinitionName !== undefined && { groupDefinitionName: state.groupDefinitionName }),
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

        const resolved = GroupManager.resolveGroupByName(group.repositoryName, { worktreePath: group.worktreePath });

        const runningWorktrees = findRunningWorktrees(group.repositoryName, group.worktreePath);
        const groupsToRestart = new Set<string>();
        for (const running of runningWorktrees) {
          console.log(chalk.yellow(`Stopping running worktree: ${formatRunningWorktreeLabel(running)}`));
          await runStopCommand(running.groupId);
          if (running.groupDefinitionName) {
            groupsToRestart.add(running.groupDefinitionName);
          }
        }

        const targetGroups = groupsToRestart.size > 0 ? Array.from(groupsToRestart) : [resolved.groupDefinitionName];

        if (targetGroups.length === 0) {
          console.log(chalk.yellow('No groups defined in project config.'));
          return;
        }

        const missingGroups: string[] = [];
        for (const groupDefinitionName of targetGroups) {
          if (!resolved.projectConfig.groups[groupDefinitionName]) {
            missingGroups.push(groupDefinitionName);
          }
        }

        for (const missing of missingGroups) {
          console.log(
            chalk.yellow(
              `Group "${missing}" is not defined in the selected worktree config. Skipping restart of this group.`
            )
          );
        }

        const startOptions: { worktreePath?: string; worktreeLabel?: string; groupDefinitionNameOverride?: string } = {
          worktreePath: group.worktreePath,
        };
        if (group.branchLabel !== undefined) {
          startOptions.worktreeLabel = group.branchLabel;
        }

        for (const groupDefinitionName of targetGroups) {
          if (!resolved.projectConfig.groups[groupDefinitionName]) {
            continue;
          }

          await runStartCommand(group.repositoryName, undefined, {
            ...startOptions,
            groupDefinitionNameOverride: groupDefinitionName,
          });
        }
      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
      }
    });
}
