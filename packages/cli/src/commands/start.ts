import {
  ConfigManager,
  ConfigNotFoundError,
  LockManager,
  LockTimeoutError,
  PortInUseError,
  ProcessManager,
  ProcessStartError,
  WorkspaceManager,
  WorkspaceResolutionError,
  type ResolvedWorkspace,
} from '@portmux/core';

import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'path';

export const startCommand: ReturnType<typeof createStartCommand> = createStartCommand();

export async function runStartCommand(workspaceName?: string, processName?: string): Promise<void> {
  try {
    // ワークスペースを解決
    let resolvedWorkspace: ResolvedWorkspace;
    try {
      if (workspaceName) {
        // ワークスペース名が指定されている場合はグローバル設定から検索
        resolvedWorkspace = WorkspaceManager.resolveWorkspaceByName(workspaceName);
      } else {
        // 指定されていない場合は自動解決
        resolvedWorkspace = WorkspaceManager.resolveWorkspaceAuto();
      }
    } catch (error) {
      if (error instanceof WorkspaceResolutionError) {
        // WorkspaceManager で解決できない場合は従来の方法でフォールバック
        const configPath = ConfigManager.findConfigFile();
        const config = ConfigManager.loadConfig(configPath);
        const projectRoot = resolve(configPath, '..');

        const workspaceKeys = Object.keys(config.workspaces);
        const targetWorkspace = workspaceName ?? workspaceKeys[0];

        if (!targetWorkspace) {
          console.error(chalk.red('エラー: ワークスペースが見つかりません'));
          process.exit(1);
        }

        const workspace = config.workspaces[targetWorkspace];
        if (!workspace) {
          console.error(chalk.red(`エラー: ワークスペース "${targetWorkspace}" が見つかりません`));
          process.exit(1);
        }

        resolvedWorkspace = {
          name: targetWorkspace,
          path: projectRoot,
          projectConfig: config,
          projectConfigPath: configPath,
          workspaceDefinitionName: targetWorkspace,
        };
      } else {
        throw error;
      }
    }

    const targetWorkspace = resolvedWorkspace.workspaceDefinitionName;
    const workspace = resolvedWorkspace.projectConfig.workspaces[targetWorkspace];
    const projectRoot = resolvedWorkspace.path;

    if (!workspace) {
      console.error(chalk.red(`エラー: ワークスペース "${targetWorkspace}" が見つかりません`));
      process.exit(1);
    }

    // 起動するプロセスを決定
    const processesToStart = processName ? workspace.commands.filter((cmd) => cmd.name === processName) : workspace.commands;

    if (processesToStart.length === 0) {
      console.error(
        chalk.red(
          processName ? `エラー: プロセス "${processName}" が見つかりません` : 'エラー: 起動するプロセスがありません'
        )
      );
      process.exit(1);
    }

    // ロックを取得して各プロセスを起動
    await LockManager.withLock('workspace', resolvedWorkspace.name, async () => {
      for (const cmd of processesToStart) {
        try {
          // 環境変数を解決
          const resolvedEnv = cmd.env ? ConfigManager.resolveEnvObject(cmd.env) : {};
          const resolvedCommand = ConfigManager.resolveCommandEnv(cmd.command, cmd.env);

          // プロセスを起動（PortManager の予約 API は ProcessManager 内で使用される）
          await ProcessManager.startProcess(targetWorkspace, cmd.name, resolvedCommand, {
            ...(cmd.cwd !== undefined && { cwd: cmd.cwd }),
            env: resolvedEnv,
            workspaceKey: resolvedWorkspace.path,
            projectRoot,
            ...(cmd.ports !== undefined && { ports: cmd.ports }),
          });

          console.log(chalk.green(`✓ プロセス "${cmd.name}" を起動しました`));
        } catch (error) {
          if (error instanceof ProcessStartError || error instanceof PortInUseError) {
            console.error(chalk.red(`エラー: プロセス "${cmd.name}" の起動に失敗しました: ${error.message}`));
          } else {
            throw error;
          }
        }
      }
    });
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      console.error(chalk.red(`エラー: ${error.message}`));
      process.exit(1);
    } else if (error instanceof LockTimeoutError) {
      console.error(chalk.red(`エラー: ${error.message}`));
      process.exit(1);
    } else {
      console.error(chalk.red(`エラー: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  }
}

function createStartCommand(): Command {
  return new Command('start')
    .description('プロセスを起動します')
    .argument('[workspace-name]', 'ワークスペース名（省略時はカレントディレクトリから設定を読む）')
    .argument('[process-name]', 'プロセス名（省略時はワークスペースの全プロセスを起動）')
    .action(async (workspaceName?: string, processName?: string) => {
      await runStartCommand(workspaceName, processName);
    });
}
