import { LockManager, LockTimeoutError, ProcessManager, ProcessStopError, StateManager } from '@portmux/core';

import { Command } from 'commander';
import chalk from 'chalk';

export const stopCommand: ReturnType<typeof createStopCommand> = createStopCommand();

export async function runStopCommand(workspaceName?: string, processName?: string): Promise<void> {
  try {
    // ワークスペース名が指定されていない場合は、状態ストアから全プロセスを取得
    if (!workspaceName) {
      const allStates = StateManager.listAllStates();
      const workspaces = new Set(allStates.map((s) => s.workspace));

      if (workspaces.size === 0) {
        console.log(chalk.yellow('停止するプロセスがありません'));
        return;
      }

      // 複数のワークスペースがある場合はエラー
      if (workspaces.size > 1) {
        console.error(chalk.red('エラー: 複数のワークスペースが実行中です。ワークスペース名を指定してください。'));
        process.exit(1);
        return;
      }

      workspaceName = Array.from(workspaces)[0];
    }

    // 停止するプロセスを決定
    const allStates = StateManager.listAllStates();
    const processesToStop = processName
      ? allStates.filter((s) => s.workspace === workspaceName && s.process === processName)
      : allStates.filter((s) => s.workspace === workspaceName);

    if (processesToStop.length === 0) {
      console.log(
        chalk.yellow(
          processName
            ? `プロセス "${processName}" は実行中ではありません`
            : `ワークスペース "${workspaceName ?? 'unknown'}" に実行中のプロセスがありません`
        )
      );
      return;
    }

    // ロックを取得して各プロセスを停止
    await LockManager.withLock('workspace', workspaceName ?? null, async () => {
      for (const state of processesToStop) {
        try {
          await ProcessManager.stopProcess(state.workspace, state.process);

          console.log(chalk.green(`✓ プロセス "${state.process}" を停止しました`));
        } catch (error) {
          if (error instanceof ProcessStopError) {
            console.error(chalk.red(`エラー: プロセス "${state.process}" の停止に失敗しました: ${error.message}`));
          } else {
            throw error;
          }
        }
      }
    });
  } catch (error) {
    if (error instanceof LockTimeoutError) {
      console.error(chalk.red(`エラー: ${error.message}`));
      process.exit(1);
    } else {
      console.error(chalk.red(`エラー: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  }
}

function createStopCommand(): Command {
  return new Command('stop')
    .description('プロセスを停止します')
    .argument('[workspace-name]', 'ワークスペース名')
    .argument('[process-name]', 'プロセス名（省略時はワークスペースの全プロセスを停止）')
    .action(async (workspaceName?: string, processName?: string) => {
      await runStopCommand(workspaceName, processName);
    });
}
