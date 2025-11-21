import { GroupManager, type GroupSelection } from '@portmux/core';
import { Command } from 'commander';
import chalk from 'chalk';
import inquirer, { type ChoiceCollection } from 'inquirer';
import { runStartCommand } from './start.js';

interface SelectOptions {
  all?: boolean;
}

interface GroupAnswer {
  repositoryName: string;
  worktreePath: string;
  branchLabel?: string;
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
        const answers = await inquirer.prompt<GroupAnswer>([
          {
            type: 'list',
            name: 'group',
            message: 'Select a group to start',
            choices,
          },
        ]);

        const startOptions: { worktreePath?: string; worktreeLabel?: string } = {
          worktreePath: answers.worktreePath,
        };
        if (answers.branchLabel !== undefined) {
          startOptions.worktreeLabel = answers.branchLabel;
        }

        await runStartCommand(answers.repositoryName, undefined, startOptions);
      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
      }
    });
}
