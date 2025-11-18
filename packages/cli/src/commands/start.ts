import {
  ConfigManager,
  ConfigNotFoundError,
  LockManager,
  LockTimeoutError,
  PortInUseError,
  ProcessManager,
  ProcessStartError,
  GroupManager,
  GroupResolutionError,
  type ResolvedGroup,
} from '@portmux/core';

import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'path';

export const startCommand: ReturnType<typeof createStartCommand> = createStartCommand();

export async function runStartCommand(groupName?: string, processName?: string): Promise<void> {
  try {
    // グループを解決
    let resolvedGroup: ResolvedGroup;
    try {
      if (groupName) {
        // グループ名が指定されている場合はグローバル設定から検索
        resolvedGroup = GroupManager.resolveGroupByName(groupName);
      } else {
        // 指定されていない場合は自動解決
        resolvedGroup = GroupManager.resolveGroupAuto();
      }
    } catch (error) {
      if (error instanceof GroupResolutionError) {
        // GroupManager で解決できない場合は従来の方法でフォールバック
        const configPath = ConfigManager.findConfigFile();
        const config = ConfigManager.loadConfig(configPath);
        const projectRoot = resolve(configPath, '..');

        const groupKeys = Object.keys(config.groups);
        const targetGroup = groupName ?? groupKeys[0];

        if (!targetGroup) {
          console.error(chalk.red('エラー: グループが見つかりません'));
          process.exit(1);
        }

        const group = config.groups[targetGroup];
        if (!group) {
          console.error(chalk.red(`エラー: グループ "${targetGroup}" が見つかりません`));
          process.exit(1);
        }

        resolvedGroup = {
          name: targetGroup,
          path: projectRoot,
          projectConfig: config,
          projectConfigPath: configPath,
          groupDefinitionName: targetGroup,
        };
      } else {
        throw error;
      }
    }

    const targetGroup = resolvedGroup.groupDefinitionName;
    const group = resolvedGroup.projectConfig.groups[targetGroup];
    const projectRoot = resolvedGroup.path;

    if (!group) {
      console.error(chalk.red(`エラー: グループ "${targetGroup}" が見つかりません`));
      process.exit(1);
    }

    // 起動するプロセスを決定
    const processesToStart = processName
      ? group.commands.filter((cmd) => cmd.name === processName)
      : group.commands;

    if (processesToStart.length === 0) {
      console.error(
        chalk.red(
          processName ? `エラー: プロセス "${processName}" が見つかりません` : 'エラー: 起動するプロセスがありません'
        )
      );
      process.exit(1);
    }

    // ロックを取得して各プロセスを起動
    await LockManager.withLock('group', resolvedGroup.name, async () => {
      for (const cmd of processesToStart) {
        try {
          // 環境変数を解決
          const resolvedEnv = cmd.env ? ConfigManager.resolveEnvObject(cmd.env) : {};
          const resolvedCommand = ConfigManager.resolveCommandEnv(cmd.command, cmd.env);

          // プロセスを起動（PortManager の予約 API は ProcessManager 内で使用される）
          await ProcessManager.startProcess(targetGroup, cmd.name, resolvedCommand, {
            ...(cmd.cwd !== undefined && { cwd: cmd.cwd }),
            env: resolvedEnv,
            groupKey: resolvedGroup.path,
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
    .argument('[group-name]', 'グループ名（省略時はカレントディレクトリから設定を読む）')
    .argument('[process-name]', 'プロセス名（省略時はグループの全プロセスを起動）')
    .action(async (groupName?: string, processName?: string) => {
      await runStartCommand(groupName, processName);
    });
}
