import {
  ConfigManager,
  ConfigNotFoundError,
  LockManager,
  LockTimeoutError,
  PortInUseError,
  ProcessManager,
  ProcessRestartError,
  ProcessStartError,
  WorkspaceManager,
  WorkspaceResolutionError,
  type ResolvedWorkspace,
} from '@portmux/core';
import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'path';

export const restartCommand: ReturnType<typeof createRestartCommand> = createRestartCommand();

function resolveWorkspaceOrFallback(workspaceName?: string): ResolvedWorkspace {
  try {
    if (workspaceName) {
      return WorkspaceManager.resolveWorkspaceByName(workspaceName);
    }
    return WorkspaceManager.resolveWorkspaceAuto();
  } catch (error) {
    if (error instanceof WorkspaceResolutionError) {
      // フォールバック: start と同じ挙動でプロジェクト設定を直接読む
      const configPath = ConfigManager.findConfigFile();
      const config = ConfigManager.loadConfig(configPath);
      const projectRoot = resolve(configPath, '..');

      const workspaceKeys = Object.keys(config.workspaces);
      const targetWorkspace = workspaceName ?? workspaceKeys[0];

      if (!targetWorkspace) {
        throw new WorkspaceResolutionError('ワークスペースが見つかりません');
      }

      const workspace = config.workspaces[targetWorkspace];
      if (!workspace) {
        throw new WorkspaceResolutionError(`ワークスペース "${targetWorkspace}" が見つかりません`);
      }

      return {
        name: targetWorkspace,
        path: projectRoot,
        projectConfig: config,
        projectConfigPath: configPath,
        workspaceDefinitionName: targetWorkspace,
      };
    }
    throw error;
  }
}

async function restartProcess(resolvedWorkspace: ResolvedWorkspace, processName?: string): Promise<void> {
  const targetWorkspace = resolvedWorkspace.workspaceDefinitionName;
  const workspaceDef = resolvedWorkspace.projectConfig.workspaces[targetWorkspace];

  if (!workspaceDef) {
    console.error(chalk.red(`エラー: ワークスペース "${targetWorkspace}" が見つかりません`));
    process.exit(1);
  }

  const processes = processName
    ? workspaceDef.commands.filter((cmd) => cmd.name === processName)
    : workspaceDef.commands;

  if (processes.length === 0) {
    console.error(
      chalk.red(
        processName ? `エラー: プロセス "${processName}" が見つかりません` : 'エラー: 再起動するプロセスがありません'
      )
    );
    process.exit(1);
  }

  await LockManager.withLock('workspace', resolvedWorkspace.name, async () => {
    for (const cmd of processes) {
      try {
        const resolvedEnv = cmd.env ? ConfigManager.resolveEnvObject(cmd.env) : {};
        const resolvedCommand = ConfigManager.resolveCommandEnv(cmd.command, cmd.env);

        console.log(chalk.yellow(`● プロセス "${cmd.name}" を再起動します`));

        await ProcessManager.restartProcess(targetWorkspace, cmd.name, resolvedCommand, {
          ...(cmd.cwd !== undefined && { cwd: cmd.cwd }),
          env: resolvedEnv,
          workspaceKey: resolvedWorkspace.path,
          projectRoot: resolvedWorkspace.path,
          ...(cmd.ports !== undefined && { ports: cmd.ports }),
        });

        console.log(chalk.green(`✓ プロセス "${cmd.name}" を再起動しました`));
      } catch (error) {
        if (
          error instanceof ProcessRestartError ||
          error instanceof ProcessStartError ||
          error instanceof PortInUseError
        ) {
          console.error(chalk.red(`エラー: プロセス "${cmd.name}" の再起動に失敗しました: ${error.message}`));
        } else {
          throw error;
        }
      }
    }
  });
}

export async function runRestartCommand(workspaceName?: string, processName?: string): Promise<void> {
  try {
    const resolvedWorkspace = resolveWorkspaceOrFallback(workspaceName);
    await restartProcess(resolvedWorkspace, processName);
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      console.error(chalk.red(`エラー: ${error.message}`));
      process.exit(1);
    } else if (error instanceof LockTimeoutError) {
      console.error(chalk.red(`エラー: ${error.message}`));
      process.exit(1);
    } else if (error instanceof WorkspaceResolutionError) {
      console.error(chalk.red(`エラー: ${error.message}`));
      process.exit(1);
    } else {
      console.error(chalk.red(`エラー: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  }
}

function createRestartCommand(): Command {
  return new Command('restart')
    .description('プロセスを再起動します')
    .argument('[workspace-name]', 'ワークスペース名（省略時はカレントディレクトリから設定を読む）')
    .argument('[process-name]', 'プロセス名（省略時はワークスペースの全プロセスを対象）')
    .action(async (workspaceName?: string, processName?: string) => {
      await runRestartCommand(workspaceName, processName);
    });
}
