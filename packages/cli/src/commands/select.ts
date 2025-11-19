import { GroupManager, parseGitWorktreeList, type GitWorktreeInfo, type GroupSelection } from '@portmux/core';
import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import inquirer, { type ChoiceCollection } from 'inquirer';
import { runStartCommand } from './start.js';

interface SelectOptions {
  all?: boolean;
}

interface GroupAnswer {
  group: string;
}

function getGitWorktrees(): GitWorktreeInfo[] {
  try {
    const output = execSync('git worktree list --porcelain', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseGitWorktreeList(output);
  } catch {
    // Fallback to config-only mode when git command is unavailable.
    return [];
  }
}

function buildChoices(selections: GroupSelection[]): ChoiceCollection<GroupAnswer> {
  const choices: ChoiceCollection<GroupAnswer> = [];
  let currentProject: string | null = null;

  for (const selection of selections) {
    if (currentProject !== selection.projectName) {
      currentProject = selection.projectName;
      choices.push(new inquirer.Separator(`--- ${selection.projectName} ---`));
    }

    const runningLabel = selection.isRunning ? '[Running] ' : '';
    choices.push({
      name: `${runningLabel}${selection.repositoryName} (${selection.path})`,
      value: selection.repositoryName,
      short: selection.repositoryName,
    });
  }

  return choices;
}

export const selectCommand: ReturnType<typeof createSelectCommand> = createSelectCommand();

function createSelectCommand(): Command {
  return new Command('select')
    .description('Select a group and start its processes')
    .option('--all', 'Show all groups, including those outside git worktrees')
    .action(async (options: SelectOptions) => {
      try {
        const includeAll = options.all === true;
        const worktrees = includeAll ? [] : getGitWorktrees();
        const selections = GroupManager.buildSelectableGroups(worktrees, { includeAll });

        if (selections.length === 0) {
          console.log(chalk.yellow('No selectable groups. Please check your global config.'));
          return;
        }

        const choices = buildChoices(selections);
        const answers = await inquirer.prompt<GroupAnswer>([
          {
            type: 'list',
            name: 'group',
            message: 'Select a group to start',
            choices,
          },
        ]);

        await runStartCommand(answers.group);
      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
      }
    });
}
