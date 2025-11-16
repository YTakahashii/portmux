import { WorkspaceManager, parseGitWorktreeList, type GitWorktreeInfo, type WorkspaceSelection } from '@portmux/core';
import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import inquirer, { type ChoiceCollection } from 'inquirer';
import { runStartCommand } from './start.js';

interface SelectOptions {
  all?: boolean;
}

interface WorkspaceAnswer {
  workspace: string;
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

function buildChoices(selections: WorkspaceSelection[]): ChoiceCollection<WorkspaceAnswer> {
  const choices: ChoiceCollection<WorkspaceAnswer> = [];
  let currentProject: string | null = null;

  for (const selection of selections) {
    if (currentProject !== selection.projectName) {
      currentProject = selection.projectName;
      choices.push(new inquirer.Separator(`--- ${selection.projectName} ---`));
    }

    const runningLabel = selection.isRunning ? '[Running] ' : '';
    choices.push({
      name: `${runningLabel}${selection.workspaceName} (${selection.path})`,
      value: selection.workspaceName,
      short: selection.workspaceName,
    });
  }

  return choices;
}

export const selectCommand: ReturnType<typeof createSelectCommand> = createSelectCommand();

function createSelectCommand(): Command {
  return new Command('select')
    .description('ワークスペースを選択してプロセスを起動します')
    .option('--all', 'すべてのワークスペースを表示します（Git worktree 以外も含む）')
    .action(async (options: SelectOptions) => {
      try {
        const includeAll = options.all === true;
        const worktrees = includeAll ? [] : getGitWorktrees();
        const selections = WorkspaceManager.buildSelectableWorkspaces(worktrees, { includeAll });

        if (selections.length === 0) {
          console.log(chalk.yellow('選択可能なワークスペースがありません。グローバル設定を確認してください。'));
          return;
        }

        const choices = buildChoices(selections);
        const answers = await inquirer.prompt<WorkspaceAnswer>([
          {
            type: 'list',
            name: 'workspace',
            message: '起動するワークスペースを選択してください',
            choices,
          },
        ]);

        await runStartCommand(answers.workspace);
      } catch (error) {
        console.error(chalk.red(`エラー: ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
      }
    });
}
